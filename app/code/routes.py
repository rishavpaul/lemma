"""HTTP API for the coding vertical (/api/code/...)."""
import asyncio
import json
import time
from collections import Counter, defaultdict
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, WebSocket
from pydantic import BaseModel

from .. import auth, config, db, jobs, providers
from . import handlers, judge, lsp, runner

router = APIRouter(prefix="/api/code")
_run_slots = asyncio.Semaphore(2)  # each run starts a JVM; keep a burst of clicks from starting dozens
MAX_CODE_BYTES = 200_000


# ---------- helpers ----------

def _problem(slug: str) -> dict:
    p = db.one("SELECT * FROM problems WHERE slug=?", (slug,))
    if not p:
        raise HTTPException(404, "problem not found")
    return p


def _attempt(aid: int) -> dict:
    a = db.one("SELECT * FROM attempts WHERE id=?", (aid,))
    if not a:
        raise HTTPException(404, "attempt not found")
    return a


def _rating(a: dict) -> str:
    return "solution" if a["solution_viewed"] else "hints" if a["hints_used"] else "clean"


BUILD_JOBS = "('code_spec','code_spec_batch')"  # the problem the user opened, and the bulk "build tests" action


def _code_job(problem_id: int) -> dict | None:
    return db.one(f"SELECT id,status,attempts,error_kind,error FROM jobs WHERE type IN {BUILD_JOBS} AND ref_id=? ORDER BY id DESC LIMIT 1", (problem_id,))


def _spec_for(a: dict) -> dict:
    """The tests an attempt runs against. An attempt can start from the statement alone; it picks up the tests as soon as they exist."""
    if a["spec_id"] is None:
        sp = handlers.latest_spec(a["problem_id"])
        if not sp:
            raise HTTPException(409, "The tests are still being built. Keep reading and coding; Run unlocks when they are ready.")
        db.execute("UPDATE attempts SET spec_id=? WHERE id=?", (sp["id"], a["id"]))
        a["spec_id"] = sp["id"]
    return a


def spec_state(problem_id: int, spec_status: str | None, job: dict | None) -> str:
    if job and job["status"] in ("queued", "running"):
        return "generating"
    if spec_status:
        return "ready" if spec_status == "validated" else "partial"
    if job and job["status"] in ("failed", "pending_retry"):
        return "failed"
    return "none"


def roadmap_rows() -> list[dict]:
    """Every problem with its generation state and the learner's progress on it."""
    specs = {r["problem_id"]: r for r in db.rows("SELECT problem_id, status, MAX(id) id FROM problem_specs GROUP BY problem_id")}
    jobs_by = {r["ref_id"]: r for r in db.rows(f"SELECT ref_id, status, error_kind, error, MAX(id) id FROM jobs WHERE type IN {BUILD_JOBS} GROUP BY ref_id")}
    attempts: dict[int, list[dict]] = defaultdict(list)
    for a in db.rows("SELECT * FROM attempts ORDER BY id"):
        attempts[a["problem_id"]].append(a)
    last_run = {r["attempt_id"]: r for r in db.rows(
        "SELECT attempt_id, passed, total, status, kind, created_at FROM runs WHERE id IN (SELECT MAX(id) FROM runs GROUP BY attempt_id)")}
    out = []
    for p in db.rows("SELECT * FROM problems ORDER BY ord"):
        mine = attempts.get(p["id"], [])
        solved = [a for a in mine if a["status"] == "solved"]
        last = mine[-1] if mine else None
        best = solved[-1] if solved else None
        status = "done" if best else "attempted" if mine else "todo"
        rating = _rating(best) if best else (_rating(last) if last and last["solution_viewed"] else None)
        spec = specs.get(p["id"])
        levels = json.loads(p["levels_json"]) if p["levels_json"] else None
        # the last time the learner touched it: typing, running, hints or finishing (not merely when the tests finished building)
        touched = [max(x for x in (a["started_at"], a["updated_at"], a["finished_at"], (last_run.get(a["id"]) or {}).get("created_at")) if x) for a in mine]
        lr = last_run.get(last["id"]) if last else None
        out.append({
            "id": p["id"], "slug": p["slug"], "num": p["num"], "title": p["title"], "phase": p["phase"], "track": p["track"],
            "difficulty": p["difficulty"], "premium": bool(p["premium"]), "tags": json.loads(p["tags_json"]), "note": p["note"],
            "is_build": bool(p["is_build"]), "levels": len(levels) if levels else None,
            "spec": spec_state(p["id"], spec["status"] if spec else None, jobs_by.get(p["id"])),
            "spec_error": (jobs_by.get(p["id"]) or {}).get("error") if (jobs_by.get(p["id"]) or {}).get("status") in ("failed", "pending_retry") else None,
            "status": status, "rating": rating, "attempts": len(mine), "solved_at": best["finished_at"] if best else None,
            "level_cleared": (max((a["level"] - 1 + (1 if a["status"] == "solved" else 0) for a in mine), default=0) if levels else None),
            "needs_review": bool((best and rating != "clean") or (not best and last and last["solution_viewed"])),
            "last_attempt_id": last["id"] if last else None, "last_attempt_status": last["status"] if last else None,
            "last_worked": max(touched) if touched else None,
            "last_run": {"passed": lr["passed"], "total": lr["total"], "status": lr["status"], "kind": lr["kind"]} if lr else None,
        })
    return out


# ---------- status and roadmap ----------

@router.get("/status")
async def status():
    tools = await asyncio.to_thread(runner.find_java)
    return {"java_ok": tools["ok"], "java_version": tools["version"], "java_error": tools["error"]}


@router.get("/roadmap")
async def roadmap():
    data = config.load_problems_yaml()
    rows = roadmap_rows()
    phases = [dict(p, problems=[r for r in rows if r["phase"] == p["num"]]) for p in data["phases"]]
    builds = [r for r in rows if r["is_build"]]
    if builds:
        phases.append({"num": max(p["num"] for p in data["phases"]) + 1, "track": "practical", "name": "Multi-level builds",
                       "why": "The CodeSignal-style round: one class, requirements added in levels. Do one build per sitting without restarting between levels.",
                       "problems": builds})
    return {"phases": phases, "topics": data["topics"], "stats": _stats(rows)}


def _stats(rows: list[dict]) -> dict:
    plain = [r for r in rows if not r["is_build"]]
    done = [r for r in plain if r["status"] == "done"]
    by_diff = {d: {"done": sum(1 for r in done if r["difficulty"] == d), "total": sum(1 for r in plain if r["difficulty"] == d)} for d in ("Easy", "Medium", "Hard")}
    builds = [r for r in rows if r["is_build"]]
    return {"total": len(plain), "done": len(done), "clean": sum(1 for r in done if r["rating"] == "clean"),
            "by_difficulty": by_diff, "builds_total_levels": sum(r["levels"] or 0 for r in builds),
            "builds_levels_cleared": sum(r["level_cleared"] or 0 for r in builds),
            "ready": sum(1 for r in rows if r["spec"] in ("ready", "partial")), "generating": sum(1 for r in rows if r["spec"] == "generating"),
            "failed": sum(1 for r in rows if r["spec"] == "failed")}


class GenerateBody(BaseModel):
    slugs: list[str] | None = None
    phase: int | None = None
    only_missing: bool = True


@router.post("/generate")
async def generate_many(body: GenerateBody):
    """Queue problem generation for a phase or a list of slugs (skips ones that are ready or already queued)."""
    rows = roadmap_rows()
    if body.slugs:
        wanted = [r for r in rows if r["slug"] in set(body.slugs)]
    elif body.phase is not None:
        wanted = [r for r in rows if r["phase"] == body.phase]
    else:
        wanted = rows
    queued = 0
    for r in wanted:
        if body.only_missing and r["spec"] in ("ready", "partial", "generating"):
            continue
        jobs.enqueue("code_spec_batch", r["id"])
        queued += 1
    return {"queued": queued}


@router.post("/problems/{slug}/generate")
async def generate_one(slug: str):
    """Build now: this is the problem the user has open, so it jumps ahead of any bulk batch."""
    p = _problem(slug)
    if db.one("SELECT 1 FROM jobs WHERE type IN ('code_spec','code_spec_batch') AND ref_id=? AND status='running'", (p["id"],)):
        return {"job_id": None}  # already being built
    db.execute("DELETE FROM jobs WHERE type='code_spec_batch' AND ref_id=? AND status='queued'", (p["id"],))
    return {"job_id": jobs.enqueue("code_spec", p["id"])}


# ---------- one problem ----------

def _visible_cases(cases: list[dict]) -> list[dict]:
    return [{"id": c["id"], "kind": c["kind"], "name": c["name"], "level": c["level"], "input": judge.dumps(c["input"]), "expected": judge.dumps(c["expected"])}
            for c in cases if c["kind"] in ("example", "edge")]


@router.get("/problems/{slug}")
async def get_problem(slug: str):
    p = _problem(slug)
    row = next(r for r in roadmap_rows() if r["id"] == p["id"])
    sp = handlers.latest_spec(p["id"])
    out = {"problem": row, "job": _code_job(p["id"]), "spec": None, "brief": handlers.latest_brief(p["id"]), "levels_text": json.loads(p["levels_json"]) if p["levels_json"] else None}
    if sp:
        spec = sp["spec"]
        out["spec"] = {**spec, "id": sp["id"], "status": sp["status"], "model": sp["model"], "created_at": sp["created_at"],
                       "cases": _visible_cases(sp["cases"]), "hidden_cases": sum(1 for c in sp["cases"] if c["kind"] in ("random", "perf")),
                       "hint_count": len(sp["secrets"].get("hints", [])),
                       "report": {k: sp["report"].get(k) for k in ("rounds", "kept", "dropped", "unverified", "clean", "issues")}}
    attempts = db.rows("SELECT id,status,level,hints_used,solution_viewed,started_at,finished_at,active_sec FROM attempts WHERE problem_id=? ORDER BY id DESC", (p["id"],))
    out["attempts"] = [dict(a, rating=_rating(a)) for a in attempts]
    return out


# ---------- attempts ----------

class NewAttempt(BaseModel):
    restart: bool = False


@router.post("/problems/{slug}/attempts")
async def start_attempt(slug: str, body: NewAttempt):
    p = _problem(slug)
    sp = handlers.latest_spec(p["id"])
    brief = handlers.latest_brief(p["id"])
    if not sp and not brief:
        raise HTTPException(409, "The problem is still being written. It takes about 20 seconds.")
    if not body.restart:
        cur = db.one("SELECT id FROM attempts WHERE problem_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1", (p["id"],))
        if cur:
            return {"id": cur["id"]}
    aid = db.execute("INSERT INTO attempts(problem_id,spec_id,code,level,started_at) VALUES(?,?,?,1,?)",
                     (p["id"], sp["id"] if sp else None, (brief or sp["spec"])["starter_code"], time.time()))
    return {"id": aid}


def _latest_run(aid: int, kind: str | None = None) -> dict | None:
    r = db.one(f"SELECT * FROM runs WHERE attempt_id=?{' AND kind=?' if kind else ''} ORDER BY id DESC LIMIT 1", (aid, kind) if kind else (aid,))
    if not r:
        return None
    return {"id": r["id"], "kind": r["kind"], "status": r["status"], "passed": r["passed"], "total": r["total"], "level": r["level"],
            "duration_ms": r["duration_ms"], "created_at": r["created_at"], "verdict": json.loads(r["result_json"]) if r["result_json"] else None,
            "code": r["code"]}


def attempt_payload(a: dict) -> dict:
    p = db.one("SELECT slug,title FROM problems WHERE id=?", (a["problem_id"],))
    reviews = db.rows("SELECT id,status,model,created_at,explanation,run_id,result_json FROM code_reviews WHERE attempt_id=? ORDER BY id DESC", (a["id"],))
    hints = db.rows("SELECT id,question,status,text,created_at FROM code_hints WHERE attempt_id=? ORDER BY id", (a["id"],))
    for h in hints:
        h["job"] = db.one("SELECT id,status,error_kind,error FROM jobs WHERE type='code_hint' AND ref_id=? ORDER BY id DESC LIMIT 1", (h["id"],))
    for r in reviews:
        r["result"] = json.loads(r.pop("result_json")) if r["result_json"] else None
        r["job"] = db.one("SELECT id,status,error_kind,error FROM jobs WHERE type='code_review' AND ref_id=? ORDER BY id DESC LIMIT 1", (r["id"],))
    canned = []
    if (a["hints_used"] or a["solution_viewed"]) and a["spec_id"]:
        sp = db.one("SELECT secrets_json FROM problem_specs WHERE id=?", (a["spec_id"],))
        canned = json.loads(sp["secrets_json"]).get("hints", [])[:min(a["hints_used"], 3)]
    return {**{k: a[k] for k in ("id", "problem_id", "spec_id", "code", "level", "status", "hints_used", "solution_viewed", "explanation", "started_at", "finished_at", "active_sec")},
            "problem": p, "rating": _rating(a), "canned_hints": canned, "coach_hints": hints, "reviews": reviews,
            "last_run": _latest_run(a["id"]), "last_submit": _latest_run(a["id"], "submit")}


@router.get("/attempts/{aid}/lsp")
async def lsp_project(aid: int):
    """Where the editor's language server should look. `available` is false when jdtls is not installed; the editor then stays plain."""
    a = _attempt(aid)
    if not lsp.find_jdtls():
        return {"available": False, "reason": "Install the Java language server with `brew install jdtls` for completion and live errors."}
    sp = handlers.latest_spec(a["problem_id"])
    spec = sp["spec"] if sp else handlers.latest_brief(a["problem_id"])
    if not spec:
        return {"available": False, "reason": "The problem is still being written."}
    return {"available": True, **lsp.prepare_project(_problem_slug(a), spec["class_name"], spec["starter_code"], spec.get("support_code"))}


def _problem_slug(a: dict) -> str:
    return db.one("SELECT slug FROM problems WHERE id=?", (a["problem_id"],))["slug"]


@router.websocket("/lsp")
async def lsp_socket(ws: WebSocket):
    origin = urlparse(ws.headers.get("origin", "")).netloc  # a web page on another site must not be able to drive the server
    if not auth.is_authed(ws) or (origin and origin != ws.headers.get("host") and origin not in ("127.0.0.1:3000", "localhost:3000")):
        await ws.close(code=1008)
        return
    await lsp.bridge(ws)


@router.get("/attempts/{aid}")
async def get_attempt(aid: int):
    return attempt_payload(_attempt(aid))


class CodeBody(BaseModel):
    code: str
    active_sec: float | None = None
    explanation: str | None = None


def _check_code(code: str) -> None:
    if len(code.encode()) > MAX_CODE_BYTES:
        raise HTTPException(413, "That file is too large.")


@router.put("/attempts/{aid}/code")
async def save_code(aid: int, body: CodeBody):
    a = _attempt(aid)
    _check_code(body.code)
    active = max(a["active_sec"], min(body.active_sec, a["active_sec"] + 3600)) if body.active_sec is not None else a["active_sec"]
    db.execute("UPDATE attempts SET code=?, active_sec=?, explanation=COALESCE(?, explanation), updated_at=? WHERE id=?",
               (body.code, active, body.explanation, time.time(), aid))
    return {"ok": True}


class RunBody(BaseModel):
    code: str
    kind: str = "run"  # run = examples and edge cases; submit = every case
    active_sec: float | None = None


@router.post("/attempts/{aid}/run")
async def run_attempt(aid: int, body: RunBody):
    a = _attempt(aid)
    if body.kind not in ("run", "submit"):
        raise HTTPException(400, "kind must be run or submit")
    _check_code(body.code)
    db.execute("UPDATE attempts SET code=?, updated_at=? WHERE id=?", (body.code, time.time(), aid))  # keep the work even when the tests are not ready
    a = _spec_for(a)
    sp = db.one("SELECT * FROM problem_specs WHERE id=?", (a["spec_id"],))
    spec, secrets, cases = json.loads(sp["spec_json"]), json.loads(sp["secrets_json"]), json.loads(sp["cases_json"])
    n_levels = max(1, len(spec.get("levels") or []))
    chosen = [c for c in cases if c["level"] <= a["level"] and (body.kind == "submit" or c["kind"] in ("example", "edge"))]
    if not chosen:
        raise HTTPException(409, "This problem has no cases for the current level.")
    t0 = time.time()
    async with _run_slots:
        try:
            verdict = await judge.judge(body.code, spec, secrets, chosen)
        except RuntimeError as e:
            raise HTTPException(503, str(e))
    dur = int((time.time() - t0) * 1000)
    if verdict["status"] == "unavailable":
        raise HTTPException(503, verdict["compile"]["output"])
    now = time.time()
    run_id = db.execute("INSERT INTO runs(attempt_id,kind,status,passed,total,level,result_json,code,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                        (aid, body.kind, verdict["status"], verdict["passed"], verdict["total"], a["level"], json.dumps(verdict), body.code, dur, now))
    solved = body.kind == "submit" and verdict["status"] == "passed" and a["level"] >= n_levels
    active = max(a["active_sec"], min(body.active_sec, a["active_sec"] + 3600)) if body.active_sec is not None else a["active_sec"]
    if solved and a["status"] != "solved":
        db.execute("UPDATE attempts SET code=?, status='solved', finished_at=?, active_sec=? WHERE id=?", (body.code, now, active, aid))
    else:
        db.execute("UPDATE attempts SET code=?, active_sec=? WHERE id=?", (body.code, active, aid))
    return {"run_id": run_id, "kind": body.kind, "verdict": verdict, "duration_ms": dur, "solved": solved,
            "level_passed": body.kind == "submit" and verdict["status"] == "passed", "level": a["level"], "levels": n_levels}


@router.post("/attempts/{aid}/advance")
async def advance_level(aid: int):
    """Unlock the next level of a build, once a submission has passed the current one."""
    a = _spec_for(_attempt(aid))
    sp = db.one("SELECT spec_json FROM problem_specs WHERE id=?", (a["spec_id"],))
    n = max(1, len(json.loads(sp["spec_json"]).get("levels") or []))
    if a["level"] >= n:
        raise HTTPException(409, "There is no next level.")
    if not db.one("SELECT 1 FROM runs WHERE attempt_id=? AND kind='submit' AND status='passed' AND level=?", (aid, a["level"])):
        raise HTTPException(409, "Submit a passing solution for this level first.")
    db.execute("UPDATE attempts SET level=level+1 WHERE id=?", (aid,))
    return attempt_payload(_attempt(aid))


@router.delete("/attempts/{aid}")
async def delete_attempt(aid: int):
    _attempt(aid)
    db.execute("DELETE FROM jobs WHERE type='code_hint' AND ref_id IN (SELECT id FROM code_hints WHERE attempt_id=?) AND status!='running'", (aid,))
    db.execute("DELETE FROM jobs WHERE type='code_review' AND ref_id IN (SELECT id FROM code_reviews WHERE attempt_id=?) AND status!='running'", (aid,))
    db.execute("DELETE FROM attempts WHERE id=?", (aid,))
    return {"ok": True}


# ---------- hints, solution ----------

def _secrets(a: dict) -> dict:
    a = _spec_for(a)
    return json.loads(db.one("SELECT secrets_json FROM problem_specs WHERE id=?", (a["spec_id"],))["secrets_json"])


@router.post("/attempts/{aid}/hint")
async def next_hint(aid: int):
    """The next of the three prepared hints. Using one counts against a clean solve."""
    a = _attempt(aid)
    hints = _secrets(a).get("hints", [])[:3]
    if a["hints_used"] >= len(hints):
        raise HTTPException(409, "You have seen all the prepared hints. Ask the coach about your code instead.")
    db.execute("UPDATE attempts SET hints_used=hints_used+1, updated_at=? WHERE id=?", (time.time(), aid))
    return {"index": a["hints_used"], "hint": hints[a["hints_used"]], "remaining": len(hints) - a["hints_used"] - 1}


class CoachBody(BaseModel):
    question: str = ""
    code: str | None = None


@router.post("/attempts/{aid}/coach")
async def ask_coach(aid: int, body: CoachBody):
    """A hint written for this code and the latest failing case. Also counts as a hint used."""
    a = _spec_for(_attempt(aid))  # the coach reads the answer key, which exists once the tests do
    if body.code is not None:
        _check_code(body.code)
        db.execute("UPDATE attempts SET code=? WHERE id=?", (body.code, aid))
    hid = db.execute("INSERT INTO code_hints(attempt_id,question,created_at) VALUES(?,?,?)", (aid, body.question.strip()[:1000] or None, time.time()))
    db.execute("UPDATE attempts SET hints_used=hints_used+1, updated_at=? WHERE id=?", (time.time(), aid))
    return {"hint_id": hid, "job_id": jobs.enqueue("code_hint", hid), "hints_used": a["hints_used"] + 1}


@router.post("/attempts/{aid}/solution")
async def view_solution(aid: int):
    """Reveal the reference solution and write-up. Before the problem is solved this counts as giving up on a clean solve."""
    a = _attempt(aid)
    s = _secrets(a)
    if a["status"] != "solved" and not a["solution_viewed"]:
        db.execute("UPDATE attempts SET solution_viewed=1 WHERE id=?", (aid,))
    return {"reference_solution": s.get("reference_solution", ""), "approach_md": s.get("approach_md", ""), "time_complexity": s.get("time_complexity"),
            "space_complexity": s.get("space_complexity"), "pitfalls": s.get("pitfalls", []), "follow_ups": s.get("follow_ups", [])}


@router.get("/attempts/{aid}/writeup")
async def writeup(aid: int):
    """The teaching write-up without the code, available once the problem is solved."""
    a = _attempt(aid)
    if a["status"] != "solved" and not a["solution_viewed"]:
        raise HTTPException(403, "Solve the problem or view the solution first.")
    s = _secrets(a)
    return {"approach_md": s.get("approach_md", ""), "time_complexity": s.get("time_complexity"), "space_complexity": s.get("space_complexity"),
            "pitfalls": s.get("pitfalls", []), "follow_ups": s.get("follow_ups", [])}


@router.get("/hints/{hid}")
async def get_hint(hid: int):
    h = db.one("SELECT id,question,status,text FROM code_hints WHERE id=?", (hid,))
    if not h:
        raise HTTPException(404, "hint not found")
    h["job"] = db.one("SELECT id,status,error_kind,error FROM jobs WHERE type='code_hint' AND ref_id=? ORDER BY id DESC LIMIT 1", (hid,))
    return h


# ---------- reviews ----------

class ReviewBody(BaseModel):
    code: str | None = None
    explanation: str = ""
    model: str = "default"


def _review_row(r: dict) -> dict:
    job = db.one("SELECT id,status,error_kind,error FROM jobs WHERE type='code_review' AND ref_id=? ORDER BY id DESC LIMIT 1", (r["id"],))
    return {"id": r["id"], "attempt_id": r["attempt_id"], "status": r["status"], "model": r["model"] or r["requested_model"], "created_at": r["created_at"],
            "explanation": r["explanation"], "result": json.loads(r["result_json"]) if r["result_json"] else None, "job": job}


@router.post("/attempts/{aid}/review")
async def request_review(aid: int, body: ReviewBody):
    a = _attempt(aid)
    code = body.code if body.code is not None else a["code"]
    _check_code(code)
    if body.model != "default" and body.model not in config.MODEL_CHOICES and not body.model.startswith("claude-") and not providers.valid_model_setting(body.model):
        raise HTTPException(400, "unknown model")
    run = _latest_run(a["id"])
    if not run:
        raise HTTPException(409, "Run the tests at least once so the review has results to start from.")
    model = None if body.model == "default" else body.model
    explanation = body.explanation.strip()[:6000]
    same = db.one("SELECT * FROM code_reviews WHERE attempt_id=? AND code=? AND explanation=? AND status='done' AND run_id=? "
                  "AND COALESCE(requested_model,'')=? ORDER BY id DESC LIMIT 1", (aid, code, explanation, run["id"], model or ""))
    if same:  # the same code, notes, run and model were already reviewed: reuse it instead of paying again
        return _review_row(same)
    db.execute("UPDATE attempts SET explanation=? WHERE id=?", (explanation, aid))
    rid = db.execute("INSERT INTO code_reviews(attempt_id,run_id,code,explanation,requested_model,created_at) VALUES(?,?,?,?,?,?)",
                     (aid, run["id"], code, explanation, model, time.time()))
    jobs.enqueue("code_review", rid)
    return _review_row(db.one("SELECT * FROM code_reviews WHERE id=?", (rid,)))


@router.get("/reviews/{rid}")
async def get_review(rid: int):
    r = db.one("SELECT * FROM code_reviews WHERE id=?", (rid,))
    if not r:
        raise HTTPException(404, "review not found")
    return _review_row(r)


# ---------- progress ----------

@router.get("/progress")
async def progress():
    rows = roadmap_rows()
    data = config.load_problems_yaml()
    plain = [r for r in rows if not r["is_build"]]
    phases = []
    for p in data["phases"]:
        mine = [r for r in plain if r["phase"] == p["num"]]
        phases.append({"num": p["num"], "name": p["name"], "track": p["track"], "done": sum(1 for r in mine if r["status"] == "done"), "total": len(mine)})
    topics = []
    for key, label in data["topics"].items():
        mine = [r for r in plain if key in r["tags"]]
        topics.append({"key": key, "label": label, "done": sum(1 for r in mine if r["status"] == "done"), "total": len(mine)})
    weeks: Counter = Counter()
    now = time.time()
    for r in plain:
        if r["solved_at"]:
            ago = int((now - r["solved_at"]) // (7 * 86400))
            if ago < 8:
                weeks[ago] += 1
    nxt = {}
    for track in ("core", "practical"):
        todo = [r for r in plain if r["track"] == track and r["status"] != "done"]
        todo.sort(key=lambda r: (r["status"] != "attempted", r["id"]))
        nxt[track] = todo[:3]
    review = [r for r in rows if r["needs_review"]]
    gaps = db.rows("SELECT tag, COUNT(*) n, MAX(severity) sev FROM code_gaps GROUP BY tag ORDER BY n DESC LIMIT 10")
    for g in gaps:
        g["example"] = (db.one("SELECT description FROM code_gaps WHERE tag=? ORDER BY id DESC LIMIT 1", (g["tag"],)) or {}).get("description", "")
    timeline = []
    for r in db.rows("SELECT r.id, r.created_at, r.result_json, p.title, p.slug FROM code_reviews r JOIN attempts a ON a.id=r.attempt_id JOIN problems p ON p.id=a.problem_id "
                     "WHERE r.status='done' ORDER BY r.id DESC LIMIT 20"):
        res = json.loads(r["result_json"])
        timeline.append({"id": r["id"], "title": r["title"], "slug": r["slug"], "created_at": r["created_at"], "score": res["overall_score"], "level": res["overall_level"]})
    timeline.reverse()
    dims: dict[str, list[float]] = defaultdict(list)
    for r in db.rows("SELECT result_json FROM code_reviews WHERE status='done' ORDER BY id DESC LIMIT 10"):
        for k, d in json.loads(r["result_json"])["dimension_scores"].items():
            if d.get("assessed", True):
                dims[k].append(d["score"])
    recent = sorted((r for r in rows if r["last_worked"]), key=lambda r: -r["last_worked"])[:6]
    activity = [r["t"] for r in db.rows("SELECT started_at t FROM attempts UNION ALL SELECT created_at FROM runs")]  # for the shared streak on Today
    return {"stats": _stats(rows), "recent": recent, "activity": activity, "phases": phases, "topics": topics, "weekly": [weeks.get(i, 0) for i in range(7, -1, -1)], "next": nxt,
            "needs_review": review, "gaps": gaps, "timeline": timeline,
            "dimensions": {k: round(sum(v) / len(v), 2) for k, v in dims.items()}}
