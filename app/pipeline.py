"""Claude job handlers (research, grade_section, grade_session), validation and brief rendering."""
import json
import logging
import re
import time

from . import config, db, grader, jobs, prompts
from . import diagram as diagram_mod

log = logging.getLogger("coach.pipeline")

TIMEOUTS = {"research": 900, "grade_section": 600, "grade_session": 900, "probe": 240}


# ---------- validation ----------

def check_schema(obj, schema, path="$") -> str | None:
    """Tiny validator for the keyword subset used in our schemas: type, properties, required, items, enum."""
    t = schema.get("type")
    if t == "object":
        if not isinstance(obj, dict):
            return f"{path} must be an object"
        for k in schema.get("required", []):
            if k not in obj:
                return f"{path}.{k} is required"
        for k, sub in schema.get("properties", {}).items():
            if k in obj:
                err = check_schema(obj[k], sub, f"{path}.{k}")
                if err:
                    return err
    elif t == "array":
        if not isinstance(obj, list):
            return f"{path} must be an array"
        for i, it in enumerate(obj):
            err = check_schema(it, schema.get("items", {}), f"{path}[{i}]")
            if err:
                return err
    elif t == "string":
        if not isinstance(obj, str):
            return f"{path} must be a string"
    elif t == "number":
        if isinstance(obj, bool) or not isinstance(obj, (int, float)):
            return f"{path} must be a number"
    elif t == "boolean":
        if not isinstance(obj, bool):
            return f"{path} must be a boolean"
    if "enum" in schema and obj not in schema["enum"]:
        return f"{path} must be one of {schema['enum']}"
    return None


def level_for(score: float) -> str:
    return "below_senior" if score < 1.75 else "senior" if score < 2.75 else "staff" if score < 3.75 else "senior_staff_plus"


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:40] or "unknown"


def normalize_tag(tag: str, known: dict) -> str:
    if tag in known["tags"] or tag.startswith("other."):
        return tag
    return "other." + _slug(tag.split(".")[-1])


def _half(x: float) -> float:
    return max(1.0, min(4.0, round(x * 2) / 2))


def validate_section(res: dict, schema: dict) -> str | None:
    err = check_schema(res, schema)
    if err:
        return err
    if not 1 <= res["score"] <= 4:
        return "score must be between 1 and 4"
    if not res["evidence"]:
        return "evidence must contain at least one short transcript quote"
    return None


def normalize_section(res: dict, known: dict) -> dict:
    res["score"] = _half(res["score"])
    res["level_signal"] = level_for(res["score"])
    for g in res["gaps"]:
        g["tag"] = normalize_tag(g["tag"], known)
    return res


NO_WEB_NOTE = ("\n\nWeb tools are NOT available in this call. Ignore the instruction above to use WebSearch/WebFetch. Fact-check only "
               "against the reference brief and cite its URLs; if a claim cannot be checked against the brief, say it is unverified "
               "rather than asserting or correcting it.")


def grader_system(q: dict, brief: dict | None, known: dict) -> str:
    """System prompt shared by the section and session graders. Everything in it is identical for every call about this
    question, so the CLI's prompt cache serves it to all of them. Keep per-call text out of it."""
    return (config.load_text("grader_system_prompt.md") + "\n\n" + config.load_text("rubric.md").split("## Section anchors")[0]
            + "\n\n" + prompts.stable_context(q, brief, known))


def validate_holistic(res: dict, schema: dict) -> str | None:
    err = check_schema(res, schema)
    if err:
        return err
    for k, d in res["dimension_scores"].items():
        if not 1 <= d["score"] <= 4:
            return f"dimension_scores.{k}.score must be between 1 and 4"
    if not 1 <= res["overall_score"] <= 4:
        return "overall_score must be between 1 and 4"
    return None


def normalize_holistic(res: dict, known: dict) -> dict:
    res["overall_score"] = _half(res["overall_score"])
    res["overall_level"] = level_for(res["overall_score"])
    for d in res["dimension_scores"].values():
        d["score"] = _half(d["score"])
    res["top_gaps"] = res["top_gaps"][:3]
    for g in res["top_gaps"]:
        g["tag"] = normalize_tag(g["tag"], known)
    return res


def grounding_problem(brief: dict) -> str | None:
    srcs = brief.get("sources", [])
    urls = {s["url"] for s in srcs}
    prim = {s["url"] for s in srcs if s.get("type") == "primary"}
    if len(urls) < 5 or len(prim) < 3:
        return f"the brief has {len(urls)} distinct sources ({len(prim)} primary); need at least 5 with at least 3 primary"
    return None


# ---------- brief rendering ----------

def brief_to_md(q: dict, b: dict) -> str:
    L = [f"# Reference brief: {q['title']}", "", b["summary"], ""]
    L += ["## Real-world architectures"]
    for a in b["real_world_architectures"]:
        L += [f"### {a['company']}", a["approach"], ""] + [f"- {d}" for d in a["key_decisions"]] + [f"- Source: [{a['url']}]({a['url']})", ""]
    L += ["## Crux areas"]
    for c in b["crux_areas"]:
        L += [f"### {c['area']}", f"**Why it's hard:** {c['why_hard']}", "", f"**Staff-level expectation:** {c['staff_level_expectation']}", ""]
        L += [f"- [{u}]({u})" for u in c["source_urls"]] + [""]
    L += ["## Common senior-level mistakes"] + [f"- {m}" for m in b["common_senior_level_mistakes"]] + [""]
    L += ["## Key numbers"] + [f"- **{k['fact']}:** {k['value']} ([source]({k['url']}))" for k in b["key_numbers"]] + [""]
    L += ["## Tradeoffs"]
    for t in b["tradeoffs"]:
        L += [f"### {t['decision']}", "Options: " + "; ".join(t["options"]), "", t["guidance"], ""]
    L += ["## Staff-level answer outline"]
    fw = {s["key"]: s["title"] for s in config.load_framework()}
    for k, v in b["staff_level_answer_outline"].items():
        L += [f"### {fw.get(k, k)}", v, ""]
    L += ["## Sources"] + [f"- [{s['title']}]({s['url']}) ({s['type']}): {s['used_for']}" for s in b["sources"]]
    return "\n".join(L)


# ---------- helpers ----------

def _settings() -> tuple[str, str]:
    """(research model, claude path)."""
    conn = db.connect()
    return config.get_setting(conn, "model_research"), config.get_setting(conn, "claude_path")


def task_model(session: dict, task: str) -> str:
    """Per-task model: a session-level override (set by Re-grade) wins, else the setting for the task."""
    return session.get("model") or config.get_setting(db.connect(), "model_" + task)


def latest_brief(question_id: int) -> dict | None:
    r = db.one("SELECT brief_json FROM research WHERE question_id=? AND status='done' ORDER BY id DESC LIMIT 1", (question_id,))
    return json.loads(r["brief_json"]) if r and r["brief_json"] else None


def _load_diagram(raw: str | None) -> dict | None:
    try:
        return diagram_mod.normalize(json.loads(raw)) if raw else None
    except ValueError:
        return None


def _raise(res: dict) -> None:
    raise jobs.JobError(res["error_kind"] or "other", res["error"] or "unknown error")


def _raw(res: dict) -> str:
    return json.dumps(res["raw"])[:200000] if not isinstance(res["raw"], str) else res["raw"][:200000]


# ---------- handlers ----------

@jobs.register("research")
async def handle_research(job: dict) -> None:
    q = db.one("SELECT * FROM questions WHERE id=?", (job["ref_id"],))
    model, cpath = _settings()
    schema = config.load_schema("research")
    system = config.load_text("research_system_prompt.md")
    payload = prompts.research(q, config.load_framework())
    validator = lambda r: check_schema(r, schema)  # noqa: E731
    res = await grader.run_claude("research", system, payload, schema, model, TIMEOUTS["research"], cpath, validator, {"question_id": q["id"]})
    if not res["ok"]:
        _raise(res)
    brief, warning = res["structured"], None
    problem = grounding_problem(brief)
    if problem:
        retry = payload + f"\n\n<feedback>\nYour previous brief was insufficient: {problem}. Search more and return a complete brief.\n</feedback>"
        res2 = await grader.run_claude("research", system, retry, schema, model, TIMEOUTS["research"], cpath, validator, {"question_id": q["id"]})
        if res2["ok"] and not grounding_problem(res2["structured"]):
            brief, res = res2["structured"], res2
        else:
            warning = problem
            if res2["ok"] and len(res2["structured"].get("sources", [])) > len(brief.get("sources", [])):
                brief, res = res2["structured"], res2
            warning = grounding_problem(brief) or warning
    md = brief_to_md(q, brief)
    config.RESEARCH_DIR.mkdir(parents=True, exist_ok=True)
    (config.RESEARCH_DIR / f"{q['slug']}.md").write_text(md, encoding="utf-8")
    db.execute("INSERT INTO research(question_id,status,brief_json,brief_md,model,grounding_warning,created_at) VALUES(?,?,?,?,?,?,?)",
               (q["id"], "done", json.dumps(brief), md, model, warning, time.time()))


def _section_texts(session_id: int) -> list[dict]:
    fw = {s["key"]: s for s in config.load_framework()}
    out = []
    for s in db.rows("SELECT * FROM sections WHERE session_id=? ORDER BY ord", (session_id,)):
        g = db.one("SELECT result_json FROM section_grades WHERE section_id=? AND status='done' ORDER BY id DESC LIMIT 1", (s["id"],))
        p = db.one("SELECT question,hint,answer FROM probes WHERE section_id=? AND question IS NOT NULL AND answer IS NOT NULL", (s["id"],))
        out.append({"probe": p, "key": s["key"], "title": fw.get(s["key"], {}).get("title", s["key"]), "text": s["transcript_edited"] or "",
                    "duration_sec": s["duration_sec"], "budget_sec": s["budget_sec"], "grade": json.loads(g["result_json"]) if g else None,
                    "id": s["id"]})
    return out


def rebuild_section_gaps(session_id: int, section_key: str, result: dict) -> None:
    conn = db.connect()
    conn.execute("DELETE FROM gaps WHERE session_id=? AND section_key=? AND source='section'", (session_id, section_key))
    for g in result.get("gaps", []):
        conn.execute("INSERT INTO gaps(session_id,section_key,tag,description,severity,source) VALUES(?,?,?,?,?,'section')",
                     (session_id, section_key, g["tag"], g["description"], g["severity"]))
    conn.commit()


@jobs.register("grade_section")
async def handle_grade_section(job: dict) -> None:
    sec = db.one("SELECT * FROM sections WHERE id=?", (job["ref_id"],))
    ses = db.one("SELECT * FROM sessions WHERE id=?", (sec["session_id"],))
    q = db.one("SELECT * FROM questions WHERE id=?", (ses["question_id"],))
    fw = config.load_framework()
    fw_sec = next(s for s in fw if s["key"] == sec["key"])
    brief = latest_brief(q["id"])
    texts = _section_texts(ses["id"])
    probe = db.one("SELECT question,hint,answer FROM probes WHERE section_id=? AND question IS NOT NULL AND answer IS NOT NULL", (sec["id"],))
    # a probed section is graded once, on its own context (no earlier sections), with the probe exchange
    earlier = None if probe else [{"title": t["title"], "text": t["text"], "probe": t["probe"]} for t in texts[:sec["ord"] - 1]]
    this = {"title": fw_sec["title"], "text": sec["transcript_edited"] or "", "duration_sec": sec["duration_sec"], "budget_sec": sec["budget_sec"]}
    known = config.load_gap_tags()
    schema = config.load_schema("section")
    dg = _load_diagram(sec["diagram_json"])
    if not diagram_mod.is_empty(dg):
        schema = diagram_mod.augment_schema(schema)
    payload = prompts.section(fw_sec, config.rubric_section(sec["key"]), earlier, this, dg, probe)
    model = task_model(ses, "section")
    cpath = _settings()[1]
    res = await grader.run_claude("grade_section", grader_system(q, brief, known) + NO_WEB_NOTE,
                                  payload, schema, model, TIMEOUTS["grade_section"], cpath, lambda r: validate_section(r, schema),
                                  {"session_id": ses["id"], "question_id": q["id"], "section_id": sec["id"]}, web=False)
    if not res["ok"]:
        _raise(res)
    result = normalize_section(res["structured"], known)
    result["ungrounded"] = brief is None
    if brief is None:
        result["notes_for_candidate"] = ("[Ungrounded: no reference brief was available, so this grade used general knowledge only.] "
                                         + result.get("notes_for_candidate", ""))
    db.execute("INSERT INTO section_grades(section_id,model,status,result_json,raw_response,duration_s,created_at) VALUES(?,?,?,?,?,?,?)",
               (sec["id"], model, "done", json.dumps(result), _raw(res), res["duration_s"], time.time()))
    rebuild_section_gaps(ses["id"], sec["key"], result)


@jobs.register("grade_session")
async def handle_grade_session(job: dict) -> None:
    ses = db.one("SELECT * FROM sessions WHERE id=?", (job["ref_id"],))
    q = db.one("SELECT * FROM questions WHERE id=?", (ses["question_id"],))
    brief = latest_brief(q["id"])
    texts = _section_texts(ses["id"])
    prev = []
    for g in db.rows("SELECT g.result_json FROM session_grades g WHERE g.status='done' AND g.session_id!=? AND g.session_id IN "
                     "(SELECT id FROM sessions WHERE started_at < ?) ORDER BY g.id DESC LIMIT 3", (ses["id"], ses["started_at"])):
        r = json.loads(g["result_json"])
        prev.append({"overall_level": r["overall_level"], "overall_score": r["overall_score"],
                     "dimension_scores": {k: v["score"] for k, v in r["dimension_scores"].items()},
                     "top_gaps": [x["tag"] + ": " + x["description"] for x in r["top_gaps"]], "drill": r["drill_for_next_session"]})
    known = config.load_gap_tags()
    schema = config.load_schema("holistic")
    dg = _load_diagram(ses["diagram_json"])
    if not diagram_mod.is_empty(dg):
        schema = diagram_mod.augment_schema(schema)
    payload = prompts.holistic(texts, prev, dg)
    model = task_model(ses, "holistic")
    res = await grader.run_claude("grade_session", grader_system(q, brief, known),
                                  payload, schema, model, TIMEOUTS["grade_session"], _settings()[1], lambda r: validate_holistic(r, schema),
                                  {"session_id": ses["id"], "question_id": q["id"]})
    if not res["ok"]:
        _raise(res)
    result = normalize_holistic(res["structured"], known)
    conn = db.connect()
    conn.execute("INSERT INTO session_grades(session_id,model,status,result_json,raw_response,duration_s,created_at) VALUES(?,?,?,?,?,?,?)",
                 (ses["id"], model, "done", json.dumps(result), _raw(res), res["duration_s"], time.time()))
    conn.execute("DELETE FROM gaps WHERE session_id=? AND source='holistic'", (ses["id"],))
    for g in result["top_gaps"]:
        conn.execute("INSERT INTO gaps(session_id,section_key,tag,description,severity,source) VALUES(?,NULL,?,?,'high','holistic')",
                     (ses["id"], g["tag"], g["description"]))
    conn.execute("UPDATE sessions SET status='done' WHERE id=?", (ses["id"],))
    conn.commit()


def validate_probe(res: dict) -> str | None:
    if not str(res.get("question") or "").strip() or not str(res.get("hint") or "").strip():
        return "question and hint must both be non-empty"
    return None


@jobs.register("probe")
async def handle_probe(job: dict) -> None:
    sec = db.one("SELECT * FROM sections WHERE id=?", (job["ref_id"],))
    ses = db.one("SELECT * FROM sessions WHERE id=?", (sec["session_id"],))
    q = db.one("SELECT * FROM questions WHERE id=?", (ses["question_id"],))
    fw_sec = next(s for s in config.load_framework() if s["key"] == sec["key"])
    texts = [t for t in _section_texts(ses["id"]) if t["id"] is not None]
    mine = next(i for i, t in enumerate(texts) if t["id"] == sec["id"])
    # the window starts after the most recent earlier section that already got a probe
    start = 0
    for i in range(mine - 1, -1, -1):
        if texts[i]["probe"]:
            start = i + 1
            break
    earlier = [{"title": t["title"], "text": t["text"], "probe": t["probe"]} for t in texts[:start]]
    window = [{"title": t["title"], "text": t["text"]} for t in texts[start:mine + 1]]
    brief = latest_brief(q["id"])
    schema = config.load_schema("probe")
    payload = prompts.probe(fw_sec, earlier, window, _load_diagram(sec["diagram_json"]))
    model = task_model(ses, "section")
    res = await grader.run_claude("probe", config.load_text("probe_system_prompt.md") + "\n\n" + prompts.stable_context(q, brief), payload, schema, model, TIMEOUTS["probe"],
                                  _settings()[1], validate_probe, {"session_id": ses["id"], "question_id": q["id"], "section_id": sec["id"]})
    if not res["ok"]:
        _raise(res)
    r = res["structured"]
    db.execute("UPDATE probes SET question=?, hint=?, model=? WHERE section_id=?",
               (str(r["question"]).strip(), str(r["hint"]).strip(), model, sec["id"]))
