"""Job handlers for the coding vertical: code_spec (generate and validate a problem), code_review, code_hint."""
import json
import logging
import re
import time

from .. import config, db, grader, jobs, pipeline
from . import generate, judge

log = logging.getLogger("coach.code")

TIMEOUTS = {"code_brief": 240, "code_spec": 900, "code_review": 600, "code_hint": 240}
HIRE = ((1.5, "strong_no"), (2.5, "lean_no"), (3.25, "lean_hire"))


def _model(setting: str) -> str:
    return config.get_setting(db.connect(), setting)


def latest_spec(problem_id: int) -> dict | None:
    """The newest generated spec for a problem with its parts decoded, or None."""
    r = db.one("SELECT * FROM problem_specs WHERE problem_id=? ORDER BY id DESC LIMIT 1", (problem_id,))
    if not r:
        return None
    return {"id": r["id"], "status": r["status"], "spec": json.loads(r["spec_json"]), "secrets": json.loads(r["secrets_json"]),
            "cases": json.loads(r["cases_json"]), "report": json.loads(r["report_json"] or "{}"), "model": r["model"], "created_at": r["created_at"]}


def latest_brief(problem_id: int) -> dict | None:
    """The statement and starter file, which exist well before the tests do."""
    r = db.one("SELECT brief_json FROM problem_briefs WHERE problem_id=?", (problem_id,))
    return json.loads(r["brief_json"]) if r else None


async def ensure_brief(problem: dict, phase: dict, topics: dict, model: str, cpath: str) -> dict:
    """Write the statement and starter (about 20 seconds) and store it at once, so the candidate can start reading and typing while the
    tests are still being built. Kept across rebuilds: a rebuild must not change the signature somebody is already coding against."""
    existing = latest_brief(problem["id"])
    if existing:
        return existing
    schema = config.load_schema("code_brief")
    system = config.load_text("code/brief_system_prompt.md")
    payload = generate.brief_payload(problem, phase, topics)
    for attempt in (1, 2):
        res = await grader.run_claude("code_brief", system, payload, schema, model, TIMEOUTS["code_brief"], cpath,
                                      lambda r: generate.validate_brief(r, schema, problem), {}, web=False)
        if not res["ok"]:
            pipeline._raise(res)
        brief = res["structured"]
        brief["inplace_param"] = int(brief["inplace_param"])
        comp = await judge.compile_starter(brief)
        if comp is None:
            break
        if attempt == 2:
            raise jobs.JobError("schema", f"the starter file does not compile: {comp}"[:600])
        payload += f"\n\n<validation_error>\nYour starter file did not compile:\n{comp}\nFix it and answer again.\n</validation_error>"
    db.execute("INSERT OR REPLACE INTO problem_briefs(problem_id,brief_json,model,created_at) VALUES(?,?,?,?)",
               (problem["id"], json.dumps(brief), model, time.time()))
    return brief


# ---------- code_spec ----------

async def handle_code_spec(job: dict) -> None:
    problem = db.one("SELECT * FROM problems WHERE id=?", (job["ref_id"],))
    if not problem:
        raise jobs.JobError("other", "unknown problem")
    if db.one("SELECT 1 FROM problem_specs WHERE problem_id=? AND created_at>?", (problem["id"], job["created_at"])):
        return  # another job built it while this one waited
    data = config.load_problems_yaml()
    phase = next((p for p in data["phases"] if p["num"] == problem["phase"]), {"name": "Builds", "why": "Multi-level builds: one class, requirements added in levels."})
    model, cpath = _model("model_code_gen"), pipeline._settings()[1]
    brief = await ensure_brief(problem, phase, data["topics"], model, cpath)
    schema = generate.load_schema()
    system = config.load_text("code/spec_system_prompt.md")
    base = generate.request_payload(problem, phase, data["topics"], brief)
    payload, best, history = base, None, []
    for round_no in range(1, generate.MAX_ROUNDS + 1):
        res = await grader.run_claude("code_spec", system, payload, schema, model, TIMEOUTS["code_spec"], cpath,
                                      lambda r: generate.validate_spec(r, schema, problem, brief), {}, web=False)
        if not res["ok"]:
            if best:
                break  # keep what an earlier round validated rather than fail the whole job
            pipeline._raise(res)
        spec = res["structured"]
        spec["inplace_param"] = int(spec["inplace_param"])
        # what the candidate is already working against is authoritative
        spec.update(starter_code=brief["starter_code"], levels=brief["levels"], constraints=brief["constraints"])
        cases, report, issues = await generate.build_cases(spec)
        history.append({"round": round_no, "kept": len(cases), "issues": len(issues)})
        log.info("code_spec %s round %d: %d cases kept, %d issues", problem["slug"], round_no, len(cases), len(issues))
        if best is None or (len(cases), -len(issues)) > (len(best["cases"]), -len(best["issues"])):
            best = {"spec": spec, "cases": cases, "report": report, "issues": issues}
        if not issues:
            break
        payload = generate.retry_payload(base, spec, issues)
    if not best or not any(c["kind"] == "example" for c in best["cases"]):
        why = "; ".join(best["issues"][:3]) if best else "no usable response"
        raise jobs.JobError("schema", f"could not produce a validated problem: {why}"[:1500])
    report = dict(best["report"], rounds=history, issues=best["issues"][:10], clean=not best["issues"])
    public, secrets = generate.split_spec(best["spec"])
    db.execute("INSERT INTO problem_specs(problem_id,status,spec_json,secrets_json,cases_json,report_json,model,created_at) VALUES(?,?,?,?,?,?,?,?)",
               (problem["id"], "validated" if report["clean"] else "partial", json.dumps(public), json.dumps(secrets), json.dumps(best["cases"]),
                json.dumps(report), model, time.time()))


jobs.register("code_spec")(handle_code_spec)
jobs.register("code_spec_batch")(handle_code_spec)


# ---------- code_review ----------

def _half(x: float) -> float:
    return max(1.0, min(4.0, round(float(x) * 2) / 2))


def _hire(score: float) -> str:
    for limit, label in HIRE:
        if score < limit:
            return label
    return "strong_hire"


def review_schema() -> dict:
    return generate.inline_refs(config.load_schema("code_review"))


def validate_review(res: dict, schema: dict) -> str | None:
    err = pipeline.check_schema(res, schema)
    if err:
        return err
    if not 1 <= res["overall_score"] <= 4:
        return "overall_score must be between 1 and 4"
    for k, d in res["dimension_scores"].items():
        if not 1 <= d["score"] <= 4:
            return f"dimension_scores.{k}.score must be between 1 and 4"
    if not res["summary"].strip():
        return "summary must not be empty"
    if len(res["improvements"]) > 4:
        return "at most 4 improvements"
    return None


def apply_caps(res: dict, ctx: dict) -> dict:
    """The rubric's caps, applied in code so an over-generous model cannot lift a solution past them."""
    caps = []
    score = _half(res["overall_score"])
    if ctx["status"] != "passed":
        caps.append(("The solution does not pass all tests", 2.0))
    if ctx["solution_viewed"]:
        caps.append(("You read the reference solution", 2.0))
    elif ctx["hints_used"]:
        caps.append(("You used hints", 3.0))
    if res["verdict_kind"] == "correct_slow":
        caps.append(("Correct but slower than the expected approach", 2.5))
    applied = [c for c in caps if score > c[1]]
    if applied:
        score = min(c[1] for c in applied)
    res["overall_score"] = score
    res["overall_level"] = pipeline.level_for(score)
    res["hire_signal"] = _hire(score)
    res["caps_applied"] = [{"reason": r, "cap": c} for r, c in applied]
    for d in res["dimension_scores"].values():
        d["score"] = _half(d["score"])
    return res


def normalize_gaps(res: dict, ctx: dict) -> None:
    known = config.load_code_gap_tags()["tags"]
    for g in res["gaps"]:
        t = g["tag"]
        g["tag"] = t if t in known or t.startswith("other.") else "other." + re.sub(r"[^a-z0-9]+", "_", t.split(".")[-1].lower()).strip("_")[:40]
    if (ctx["solution_viewed"] or ctx["hints_used"] >= 2) and not any(g["tag"] == "process.leaned_on_hints" for g in res["gaps"]):
        res["gaps"].append({"tag": "process.leaned_on_hints", "severity": "medium",
                            "description": "Read the solution" if ctx["solution_viewed"] else f"Used {ctx['hints_used']} hints"})


def review_context(attempt: dict, problem: dict, spec: dict, secrets: dict, run: dict | None) -> tuple[str, dict]:
    """The user-turn payload for a review, plus the facts the caps need."""
    verdict = json.loads(run["result_json"]) if run and run["result_json"] else None
    n_runs = db.one("SELECT COUNT(*) n FROM runs WHERE attempt_id=?", (attempt["id"],))["n"]
    n_failed_submits = db.one("SELECT COUNT(*) n FROM runs WHERE attempt_id=? AND kind='submit' AND status!='passed'", (attempt["id"],))["n"]
    status = verdict["status"] if verdict else "not_run"
    past = db.rows("SELECT g.tag, COUNT(*) n FROM code_gaps g JOIN code_reviews r ON r.id=g.review_id WHERE r.id!=? GROUP BY g.tag ORDER BY n DESC LIMIT 6",
                   (attempt.get("review_id") or 0,))
    mins = round((attempt["active_sec"] or 0) / 60, 1)
    parts = [
        f"<problem>\ntitle: {problem['title']}\ndifficulty: {problem['difficulty']}\nroadmap note (interviewer's intent): {problem['note']}\n\n{spec['statement_md']}\n</problem>",
        f"<reference>\nExpected complexity: time {secrets.get('time_complexity')}, space {secrets.get('space_complexity')}\n{secrets.get('approach_md', '')}\n"
        f"Common pitfalls: {'; '.join(secrets.get('pitfalls', []))}\nInterviewer follow-ups: {'; '.join(secrets.get('follow_ups', []))}\n"
        f"Reference solution (the candidate has {'SEEN' if attempt['solution_viewed'] else 'NOT seen'} it):\n{secrets.get('reference_solution', '')}\n</reference>",
        f"<candidate_code>\n{attempt['review_code']}\n</candidate_code>",
        "<judge_results>\n" + (judge.summarize(verdict) if verdict else "The candidate never ran the tests.") +
        f"\nRuns so far: {n_runs}; failed submissions before this one: {n_failed_submits}.\n</judge_results>",
        f"<process>\nhints used: {attempt['hints_used']} of 3 graded hints plus coach questions\nreference solution viewed: {'yes' if attempt['solution_viewed'] else 'no'}\n"
        f"active time: {mins} minutes (a staff-level target for this difficulty is about {25 if problem['difficulty'] != 'Hard' else 35} minutes)\n</process>",
        f"<candidate_explanation>\n{(attempt['review_explanation'] or '').strip() or '(none written: mark communication as not assessed)'}\n</candidate_explanation>",
        "<recurring_gaps note=\"tags from earlier reviews, most frequent first; call out a repeat by name\">\n" + (", ".join(f"{p['tag']} x{p['n']}" for p in past) or "(none yet)") + "\n</recurring_gaps>",
        "<task>\nReview this solution as a staff interviewer would, per the system rules and the structured schema. Start from what the judge proved, "
        "then judge the code against the rubric. Return the structured output only.\n</task>",
    ]
    return "\n\n".join(parts), {"status": status, "hints_used": attempt["hints_used"], "solution_viewed": bool(attempt["solution_viewed"])}


@jobs.register("code_review")
async def handle_code_review(job: dict) -> None:
    rev = db.one("SELECT * FROM code_reviews WHERE id=?", (job["ref_id"],))
    attempt = db.one("SELECT * FROM attempts WHERE id=?", (rev["attempt_id"],))
    problem = db.one("SELECT * FROM problems WHERE id=?", (attempt["problem_id"],))
    sp = db.one("SELECT * FROM problem_specs WHERE id=?", (attempt["spec_id"],))
    spec, secrets = json.loads(sp["spec_json"]), json.loads(sp["secrets_json"])
    run = db.one("SELECT * FROM runs WHERE id=?", (rev["run_id"],)) if rev["run_id"] else None
    attempt.update(review_code=rev["code"] or attempt["code"], review_explanation=rev["explanation"], review_id=rev["id"])
    payload, ctx = review_context(attempt, problem, spec, secrets, run)
    schema = review_schema()
    tags = "\n".join(f"- {t}: {d}" for t, d in config.load_code_gap_tags()["tags"].items())
    system = (config.load_text("code/review_system_prompt.md") + "\n\n" + config.load_text("code/review_rubric.md")
              + f"\n\n<gap_tags>\nUse these tags (or other.<short_slug> if none fits):\n{tags}\n</gap_tags>")
    model = rev["requested_model"] or _model("model_code_review")
    res = await grader.run_claude("code_review", system, payload, schema, model, TIMEOUTS["code_review"], pipeline._settings()[1],
                                  lambda r: validate_review(r, schema), {}, web=False)
    if not res["ok"]:
        db.execute("UPDATE code_reviews SET status='failed' WHERE id=?", (rev["id"],))
        pipeline._raise(res)
    result = apply_caps(res["structured"], ctx)
    normalize_gaps(result, ctx)
    conn = db.connect()
    conn.execute("DELETE FROM code_gaps WHERE review_id=?", (rev["id"],))
    for g in result["gaps"]:
        conn.execute("INSERT INTO code_gaps(review_id,problem_id,tag,description,severity) VALUES(?,?,?,?,?)",
                     (rev["id"], problem["id"], g["tag"], g["description"], g["severity"]))
    conn.execute("UPDATE code_reviews SET status='done', result_json=?, model=? WHERE id=?", (json.dumps(result), model, rev["id"]))
    conn.commit()


# ---------- code_hint ----------

@jobs.register("code_hint")
async def handle_code_hint(job: dict) -> None:
    h = db.one("SELECT * FROM code_hints WHERE id=?", (job["ref_id"],))
    attempt = db.one("SELECT * FROM attempts WHERE id=?", (h["attempt_id"],))
    problem = db.one("SELECT * FROM problems WHERE id=?", (attempt["problem_id"],))
    sp = db.one("SELECT * FROM problem_specs WHERE id=?", (attempt["spec_id"],))
    spec, secrets = json.loads(sp["spec_json"]), json.loads(sp["secrets_json"])
    run = db.one("SELECT * FROM runs WHERE attempt_id=? ORDER BY id DESC LIMIT 1", (attempt["id"],))
    earlier = db.rows("SELECT question, text FROM code_hints WHERE attempt_id=? AND status='done' AND id<? ORDER BY id", (attempt["id"], h["id"]))
    shown = attempt["hints_used"]
    payload = "\n\n".join([
        f"<problem>\n{problem['title']}\n{spec['statement_md']}\n</problem>",
        f"<answer_key note=\"for your eyes only; never reveal\">\nApproach: {secrets.get('approach_md', '')}\nReference solution:\n{secrets.get('reference_solution', '')}\n</answer_key>",
        f"<candidate_code>\n{attempt['code'] or '(nothing written yet)'}\n</candidate_code>",
        "<latest_judge_results>\n" + (judge.summarize(json.loads(run["result_json"])) if run and run["result_json"] else "No run yet.") + "\n</latest_judge_results>",
        "<hints_already_given>\n" + ("\n".join(f"Q: {e['question'] or '(general hint)'}\nA: {e['text']}" for e in earlier) or "(none)") + f"\n({shown} hint(s) used in total)\n</hints_already_given>",
        f"<candidate_question>\n{h['question'] or 'I am stuck. Give me the next nudge.'}\n</candidate_question>",
        "<task>\nGive the next nudge per the system rules. Return the structured output only.\n</task>",
    ])
    schema = config.load_schema("code_hint")
    model = _model("model_code_hint")
    res = await grader.run_claude("code_hint", config.load_text("code/hint_system_prompt.md"), payload, schema, model, TIMEOUTS["code_hint"],
                                  pipeline._settings()[1], lambda r: None if str(r.get("hint", "")).strip() else "hint must not be empty", {}, web=False)
    if not res["ok"]:
        db.execute("UPDATE code_hints SET status='failed' WHERE id=?", (h["id"],))
        pipeline._raise(res)
    db.execute("UPDATE code_hints SET status='done', text=?, model=? WHERE id=?", (res["structured"]["hint"].strip(), model, h["id"]))
