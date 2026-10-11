"""FastAPI app, routes and startup."""
import asyncio
import logging
import threading
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

import json
import random
import re
import time

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from pydantic import BaseModel

from . import config, db, export, grader, jobs, pipeline, progress, transcribe

log = logging.getLogger("coach")


def setup_logging() -> None:
    config.LOG_DIR.mkdir(parents=True, exist_ok=True)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    fh = RotatingFileHandler(config.LOG_DIR / "app.log", maxBytes=2_000_000, backupCount=3)
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root.addHandler(fh)


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    setup_logging()
    copied = config.seed_config()
    if copied:
        log.info("seeded config files: %s", copied)
    version = db.migrate()
    db.sync_questions()
    log.info("db ready, schema version %s", version)
    model = config.get_setting(db.connect(), "whisper_model")
    threading.Thread(target=transcribe.warm, args=(model,), daemon=True).start()
    health_task = asyncio.create_task(grader.check_health())
    stop = asyncio.Event()
    workers = jobs.start_workers(stop)
    yield
    stop.set()
    for t in workers + [health_task]:
        t.cancel()


app = FastAPI(title="Staff System Design Coach", lifespan=lifespan)


@app.middleware("http")
async def no_cache_static(request, call_next):
    """Always revalidate the front-end files so edits show up on a normal reload."""
    resp = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/api/health")
async def health():
    c = grader.get_health()
    w = transcribe.whisper_state()
    return {
        "claude_ok": c["claude_ok"], "claude_version": c["version"], "claude_path": c["path"],
        "claude_error": c["error"],
        "ffmpeg_ok": transcribe.ffmpeg_ok(),
        "whisper_loaded": w["whisper_loaded"], "whisper_loading": w["whisper_loading"],
        "whisper_error": w["whisper_error"],
        "data_dir": str(config.DATA_DIR),
    }


@app.post("/api/health/recheck")
async def health_recheck():
    await grader.check_health()
    return await health()


@app.get("/api/framework")
async def framework():
    return {"sections": config.load_framework()}


# ---- helpers ---------------------------------------------------------------

def _question(qid: int) -> dict:
    q = db.one("SELECT * FROM questions WHERE id=?", (qid,))
    if not q:
        raise HTTPException(404, "question not found")
    q["stresses"] = json.loads(q.pop("stresses_json") or "[]")
    return q


def _latest_job(job_type: str, ref_id: int) -> dict | None:
    return db.one("SELECT id,type,ref_id,status,attempts,error_kind,error FROM jobs WHERE type=? AND ref_id=? "
                  "ORDER BY id DESC LIMIT 1", (job_type, ref_id))


def research_status(question_id: int) -> dict:
    done = db.one("SELECT id,created_at,model,grounding_warning FROM research WHERE question_id=? AND status='done' "
                  "ORDER BY id DESC LIMIT 1", (question_id,))
    job = _latest_job("research", question_id)
    if job and job["status"] in ("queued", "running"):
        state = "researching"
    elif done:
        state = "ready"
    elif job and job["status"] in ("failed", "pending_retry"):
        state = "failed"
    else:
        state = "none"
    return {"state": state, "job": job, "brief": done}


def ensure_research(question_id: int) -> None:
    if not db.one("SELECT 1 FROM research WHERE question_id=? AND status='done'", (question_id,)):
        jobs.enqueue("research", question_id)


def session_payload(sid: int) -> dict:
    ses = db.one("SELECT * FROM sessions WHERE id=?", (sid,))
    if not ses:
        raise HTTPException(404, "session not found")
    q = _question(ses["question_id"])
    q.pop("crux_hints", None)
    secs = db.rows("SELECT * FROM sections WHERE session_id=? ORDER BY ord", (sid,))
    fw = {x["key"]: x for x in config.load_framework()}
    for sec in secs:
        sec["segments"] = json.loads(sec.pop("segments_json") or "[]")
        sec["title"] = fw.get(sec["key"], {}).get("title", sec["key"])
        sec["cover"] = fw.get(sec["key"], {}).get("cover", [])
        g = db.one("SELECT id,model,status,result_json,duration_s,created_at FROM section_grades "
                   "WHERE section_id=? AND status='done' ORDER BY id DESC LIMIT 1", (sec["id"],))
        sec["grade"] = json.loads(g["result_json"]) if g else None
        sec["grade_meta"] = {k: g[k] for k in ("id", "model", "duration_s", "created_at")} if g else None
        sec["transcribe_job"] = _latest_job("transcribe", sec["id"])
        sec["grade_job"] = _latest_job("grade_section", sec["id"])
    sg = db.one("SELECT id,model,status,result_json,duration_s,created_at FROM session_grades "
                "WHERE session_id=? AND status='done' ORDER BY id DESC LIMIT 1", (sid,))
    return {
        "session": ses, "question": q, "sections": secs,
        "research": research_status(ses["question_id"]),
        "grade": json.loads(sg["result_json"]) if sg else None,
        "grade_meta": {k: sg[k] for k in ("id", "model", "duration_s", "created_at")} if sg else None,
        "grade_job": _latest_job("grade_session", sid),
        "usage": progress.session_usage(sid),
    }


# ---- questions ---------------------------------------------------------------

class NewQuestion(BaseModel):
    title: str
    prompt: str


@app.get("/api/questions")
async def list_questions(include_hints: bool = False):
    out = []
    for q in db.rows("SELECT * FROM questions ORDER BY is_custom, id"):
        q["stresses"] = json.loads(q.pop("stresses_json") or "[]")
        if not include_hints:
            q.pop("crux_hints", None)
        q["has_research"] = bool(db.one("SELECT 1 FROM research WHERE question_id=? AND status='done'", (q["id"],)))
        stats = db.one("SELECT COUNT(*) n, MAX(started_at) last FROM sessions WHERE question_id=?", (q["id"],))
        q["attempts"] = stats["n"]
        last = db.one("SELECT g.result_json FROM session_grades g JOIN sessions s ON s.id=g.session_id "
                      "WHERE s.question_id=? AND g.status='done' ORDER BY g.id DESC LIMIT 1", (q["id"],))
        q["last_score"] = json.loads(last["result_json"]).get("overall_score") if last else None
        out.append(q)
    return out


@app.post("/api/questions")
async def add_question(body: NewQuestion):
    title, prompt = body.title.strip(), body.prompt.strip()
    if not title or not prompt:
        raise HTTPException(400, "title and prompt required")
    slug = "custom-" + re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40]
    if db.one("SELECT 1 FROM questions WHERE slug=?", (slug,)):
        slug += f"-{int(time.time())}"
    qid = db.execute("INSERT INTO questions(slug,title,prompt,stresses_json,crux_hints,is_custom,created_at) "
                     "VALUES(?,?,?,?,'',1,?)", (slug, title, prompt, json.dumps(config.DIMENSIONS), time.time()))
    return _question(qid)


# ---- sessions ------------------------------------------------------------------

class NewSession(BaseModel):
    question_id: int | None = None
    mode: str | None = None


@app.post("/api/sessions")
async def create_session(body: NewSession):
    reason = None
    if body.question_id:
        qid = _question(body.question_id)["id"]
    elif body.mode == "suggested":
        sug = progress.suggest()
        qid, reason = sug["question_id"], sug["reason"]
    elif body.mode == "random":
        qid = random.choice(db.rows("SELECT id FROM questions"))["id"]
    else:
        raise HTTPException(400, "question_id or mode required")
    conn = db.connect()
    model = config.get_setting(conn, "model")
    live = int(config.get_setting(conn, "show_feedback_live") == "1")
    sid = db.execute("INSERT INTO sessions(question_id,status,model,started_at,show_feedback_live) "
                     "VALUES(?,'in_progress',?,?,?)", (qid, model, time.time(), live))
    for i, sec in enumerate(config.load_framework()):
        conn.execute("INSERT INTO sections(session_id,key,ord,budget_sec) VALUES(?,?,?,?)",
                     (sid, sec["key"], i + 1, sec["budget_sec"]))
    conn.commit()
    ensure_research(qid)
    return {"id": sid, "question_id": qid, "reason": reason}


@app.get("/api/sessions")
async def list_sessions():
    out = []
    for s in db.rows("SELECT s.*, q.title FROM sessions s JOIN questions q ON q.id=s.question_id ORDER BY s.id DESC"):
        g = db.one("SELECT result_json FROM session_grades WHERE session_id=? AND status='done' ORDER BY id DESC LIMIT 1",
                   (s["id"],))
        r = json.loads(g["result_json"]) if g else {}
        s["overall_score"], s["overall_level"] = r.get("overall_score"), r.get("overall_level")
        s["sections_saved"] = db.one("SELECT COUNT(*) n FROM sections WHERE session_id=? AND status='saved'",
                                     (s["id"],))["n"]
        out.append(s)
    return out


@app.get("/api/sessions/{sid}")
async def get_session(sid: int):
    return session_payload(sid)


def _section(sid: int, key: str) -> dict:
    sec = db.one("SELECT * FROM sections WHERE session_id=? AND key=?", (sid, key))
    if not sec:
        raise HTTPException(404, "section not found")
    return sec


@app.post("/api/sessions/{sid}/sections/{key}/audio")
async def upload_audio(sid: int, key: str, file: UploadFile = File(...)):
    sec = _section(sid, key)
    ctype = (file.content_type or "").lower()
    ext = "webm" if "webm" in ctype else "mp4" if ("mp4" in ctype or "m4a" in ctype or "aac" in ctype) else \
        (file.filename or "").rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "webm"
    if ext not in ("webm", "mp4", "m4a", "wav", "ogg", "mp3"):
        ext = "webm"
    folder = config.AUDIO_DIR / str(sid)
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f"{sec['ord']:02d}-{key}.*"):
        old.unlink()
    audio = folder / f"{sec['ord']:02d}-{key}.{ext}"
    wav = folder / f"{sec['ord']:02d}-{key}.wav"
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty upload")
    audio.write_bytes(data)
    try:
        await transcribe.convert_to_wav(audio, wav)
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    db.execute("UPDATE sections SET audio_path=?, wav_path=?, transcript_raw=NULL, transcript_edited=NULL, "
               "segments_json=NULL, status='recorded' WHERE id=?", (str(audio), str(wav), sec["id"]))
    return {"job_id": jobs.enqueue("transcribe", sec["id"])}


class TranscriptBody(BaseModel):
    text: str
    duration_sec: float | None = None


@app.put("/api/sessions/{sid}/sections/{key}/transcript")
async def save_transcript(sid: int, key: str, body: TranscriptBody):
    sec = _section(sid, key)
    dur = body.duration_sec if body.duration_sec and body.duration_sec > 0 else sec["duration_sec"]
    db.execute("UPDATE sections SET transcript_edited=?, duration_sec=?, status='saved' WHERE id=?",
               (body.text, dur, sec["id"]))
    return {"job_id": jobs.enqueue("grade_section", sec["id"])}


@app.post("/api/sessions/{sid}/finish")
async def finish_session(sid: int):
    session_payload(sid)
    unsaved = db.one("SELECT COUNT(*) n FROM sections WHERE session_id=? AND status!='saved'", (sid,))["n"]
    if unsaved:
        raise HTTPException(400, f"{unsaved} section(s) not saved yet")
    db.execute("UPDATE sessions SET status='grading', finished_at=? WHERE id=?", (time.time(), sid))
    return {"job_id": jobs.enqueue("grade_session", sid)}


@app.get("/api/jobs/{job_id}")
async def job_status(job_id: int):
    j = jobs.get_job(job_id)
    if not j:
        raise HTTPException(404, "job not found")
    return j


@app.post("/api/jobs/{job_id}/retry")
async def job_retry(job_id: int):
    if not jobs.get_job(job_id):
        raise HTTPException(404, "job not found")
    jobs.retry_job(job_id)
    return {"ok": True}


@app.get("/api/sessions/{sid}/export.md")
async def export_session(sid: int):
    _, md = export.write_export(session_payload(sid))
    return PlainTextResponse(md, media_type="text/markdown; charset=utf-8")


@app.delete("/api/sessions/{sid}")
async def delete_session(sid: int):
    session_payload(sid)
    conn = db.connect()
    secs = [r["id"] for r in db.rows("SELECT id FROM sections WHERE session_id=?", (sid,))]
    for sec in secs:
        conn.execute("DELETE FROM jobs WHERE type IN ('transcribe','grade_section') AND ref_id=?", (sec,))
    conn.execute("DELETE FROM jobs WHERE type='grade_session' AND ref_id=?", (sid,))
    conn.execute("DELETE FROM sessions WHERE id=?", (sid,))  # sections, grades, gaps cascade
    conn.commit()
    import shutil
    shutil.rmtree(config.AUDIO_DIR / str(sid), ignore_errors=True)
    (config.EXPORT_DIR / f"{sid}.md").unlink(missing_ok=True)
    return {"ok": True}


# ---- study queue ---------------------------------------------------------------------

class StudyItem(BaseModel):
    concept: str
    why: str = ""
    resource: str = ""
    source_session_id: int | None = None


def upsert_study_item(item: StudyItem) -> dict:
    concept = item.concept.strip()
    existing = db.one("SELECT * FROM study_items WHERE lower(concept)=lower(?)", (concept,))
    if existing:
        why = existing["why"] if item.why in (existing["why"] or "") else (existing["why"] + " | " + item.why if existing["why"] else item.why)
        res = existing["resource"] or item.resource
        db.execute("UPDATE study_items SET why=?, resource=? WHERE id=?", (why, res, existing["id"]))
        return db.one("SELECT * FROM study_items WHERE id=?", (existing["id"],))
    iid = db.execute("INSERT INTO study_items(concept,why,resource,source_session_id,created_at) VALUES(?,?,?,?,?)",
                     (concept, item.why, item.resource, item.source_session_id, time.time()))
    return db.one("SELECT * FROM study_items WHERE id=?", (iid,))


@app.get("/api/study_items")
async def list_study_items():
    return db.rows("SELECT * FROM study_items ORDER BY CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END, id DESC")


@app.post("/api/study_items")
async def add_study_item(item: StudyItem):
    if not item.concept.strip():
        raise HTTPException(400, "concept required")
    return upsert_study_item(item)


class StudyPatch(BaseModel):
    status: str


@app.patch("/api/study_items/{iid}")
async def patch_study_item(iid: int, body: StudyPatch):
    if body.status not in ("todo", "doing", "done"):
        raise HTTPException(400, "status must be todo|doing|done")
    if not db.one("SELECT 1 FROM study_items WHERE id=?", (iid,)):
        raise HTTPException(404, "not found")
    db.execute("UPDATE study_items SET status=? WHERE id=?", (body.status, iid))
    return db.one("SELECT * FROM study_items WHERE id=?", (iid,))


@app.get("/api/questions/suggest")
async def suggest_question():
    return progress.suggest()


@app.get("/api/usage")
async def get_usage():
    return progress.usage()


@app.get("/api/plan_usage")
async def get_plan_usage():
    return progress.plan_usage()


@app.post("/api/plan_usage/refresh")
async def refresh_plan_usage():
    """Run the tiny health call (a few tokens) to pull a fresh plan-limit snapshot."""
    await grader.check_health()
    return progress.plan_usage()


@app.get("/api/progress")
async def get_progress():
    return progress.progress()


# ---- research --------------------------------------------------------------------

@app.get("/api/questions/{qid}/research")
async def get_research(qid: int):
    q = _question(qid)
    st = research_status(qid)
    row = db.one("SELECT brief_json,brief_md,model,grounding_warning,created_at FROM research WHERE question_id=? "
                 "AND status='done' ORDER BY id DESC LIMIT 1", (qid,))
    brief = json.loads(row["brief_json"]) if row else None
    return {"question": q["title"], "state": st["state"], "job": st["job"], "brief": brief,
            "brief_md": row["brief_md"] if row else None, "model": row["model"] if row else None,
            "grounding_warning": row["grounding_warning"] if row else None,
            "created_at": row["created_at"] if row else None}


@app.post("/api/questions/{qid}/research/refresh")
async def refresh_research(qid: int):
    _question(qid)
    return {"job_id": jobs.enqueue("research", qid)}


class Regrade(BaseModel):
    model: str


@app.post("/api/sessions/{sid}/regrade")
async def regrade(sid: int, body: Regrade):
    session_payload(sid)
    if body.model not in ("opus", "sonnet", "fable", "haiku") and not body.model.startswith("claude-"):
        raise HTTPException(400, "unknown model")
    db.execute("UPDATE sessions SET model=?, status='grading', finished_at=? WHERE id=?", (body.model, time.time(), sid))
    for sec in db.rows("SELECT id FROM sections WHERE session_id=? AND status='saved'", (sid,)):
        jobs.enqueue("grade_section", sec["id"])
    return {"job_id": jobs.enqueue("grade_session", sid)}


# ---- settings --------------------------------------------------------------------

@app.get("/api/settings")
async def get_settings():
    return config.all_settings(db.connect())


@app.put("/api/settings")
async def put_settings(body: dict):
    config.put_settings(db.connect(), body)
    return config.all_settings(db.connect())


@app.get("/")
async def index():
    return FileResponse(config.STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=config.STATIC_DIR), name="static")
