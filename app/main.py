"""FastAPI app, routes and startup."""
import asyncio
import json
import logging
import os
import random
import re
import threading
import time
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import articles, config, db, export, grader, jobs, pipeline, progress, providers, transcribe
from . import diagram as diagram_mod

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
    swept = transcribe.sweep_audio()
    if swept:
        log.info("removed %d stale audio file(s)/folder(s)", swept)
    model = config.get_setting(db.connect(), "whisper_model")
    threading.Thread(target=transcribe.warm, args=(model,), daemon=True).start()
    health_task = asyncio.create_task(grader.check_health())
    stop = asyncio.Event()
    workers = jobs.start_workers(stop)
    yield
    stop.set()
    for t in workers + [health_task]:
        t.cancel()
    grader.kill_children()


app = FastAPI(title="Staff System Design Coach", lifespan=lifespan)


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
        sec["diagram"] = diagram_mod.normalize(json.loads(sec.pop("diagram_json"))) if sec.get("diagram_json") else None
        sec["title"] = fw.get(sec["key"], {}).get("title", sec["key"])
        sec["cover"] = fw.get(sec["key"], {}).get("cover", [])
        g = db.one("SELECT id,model,status,result_json,duration_s,created_at,raw_response FROM section_grades "
                   "WHERE section_id=? AND status='done' ORDER BY id DESC LIMIT 1", (sec["id"],))
        sec["cost"] = progress.section_costs(sec["id"], g["model"] if g else None, g["raw_response"] if g else None)
        sec["grade"] = json.loads(g["result_json"]) if g else None
        sec["grade_meta"] = {k: g[k] for k in ("id", "model", "duration_s", "created_at")} if g else None
        sec["transcribe_job"] = _latest_job("transcribe", sec["id"])
        sec["grade_job"] = _latest_job("grade_section", sec["id"])
        sec["probe"] = db.one("SELECT question,hint,answer,model,created_at,answered_at FROM probes WHERE section_id=?", (sec["id"],))
        sec["probe_job"] = _latest_job("probe", sec["id"])
    sg = db.one("SELECT id,model,status,result_json,duration_s,created_at,raw_response FROM session_grades "
                "WHERE session_id=? AND status='done' ORDER BY id DESC LIMIT 1", (sid,))
    return {
        "session": {k: v for k, v in ses.items() if k != "diagram_json"}, "question": q, "sections": secs,
        "diagram": diagram_mod.normalize(json.loads(ses["diagram_json"])) if ses.get("diagram_json") else diagram_mod.empty_diagram(),
        "study_plan": progress.study_plan(secs),
        "research": research_status(ses["question_id"]),
        "grade": json.loads(sg["result_json"]) if sg else None,
        "grade_meta": {k: sg[k] for k in ("id", "model", "duration_s", "created_at")} if sg else None,
        "grade_job": _latest_job("grade_session", sid),
        "usage": progress.session_usage(sid),
        "costs": progress.session_costs(sid, ses["question_id"], sg["model"] if sg else None, sg["raw_response"] if sg else None),
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
    live = int(config.get_setting(conn, "show_feedback_live") == "1")
    sid = db.execute("INSERT INTO sessions(question_id,status,model,started_at,show_feedback_live) "
                     "VALUES(?,'in_progress',NULL,?,?)", (qid, time.time(), live))
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
    diagram: dict | None = None  # canvas as of this save; snapshotted with the section
    defer_grading: bool = False  # the section is about to be probed: it is graded once the probe is answered


class DiagramBody(BaseModel):
    format: str = diagram_mod.FORMAT
    elements: list = []


@app.put("/api/sessions/{sid}/diagram")
async def save_diagram(sid: int, body: DiagramBody):
    """Autosave of the live canvas."""
    if not db.one("SELECT 1 FROM sessions WHERE id=?", (sid,)):
        raise HTTPException(404, "session not found")
    d = diagram_mod.normalize(body.model_dump())
    blob = json.dumps(d)
    if len(blob) > diagram_mod.MAX_SCENE_BYTES:
        raise HTTPException(413, "diagram is too large to save")
    db.execute("UPDATE sessions SET diagram_json=? WHERE id=?", (blob, sid))
    return {"ok": True, "elements": len(d["elements"])}


@app.put("/api/sessions/{sid}/sections/{key}/transcript")
async def save_transcript(sid: int, key: str, body: TranscriptBody):
    sec = _section(sid, key)
    dur = body.duration_sec if body.duration_sec and body.duration_sec > 0 else sec["duration_sec"]
    if body.diagram is not None:
        db.execute("UPDATE sessions SET diagram_json=? WHERE id=?", (json.dumps(diagram_mod.normalize(body.diagram)), sid))
    ses = db.one("SELECT diagram_json FROM sessions WHERE id=?", (sid,))
    db.execute("UPDATE sections SET transcript_edited=?, duration_sec=?, status='saved', diagram_json=? WHERE id=?",
               (body.text, dur, ses["diagram_json"], sec["id"]))
    transcribe.purge_audio(sec["id"])  # saved: the transcript is final, the recording is no longer needed
    if body.defer_grading:
        return {"job_id": None}
    return {"job_id": jobs.enqueue("grade_section", sec["id"])}


class ProbeAnswer(BaseModel):
    text: str


@app.post("/api/sessions/{sid}/sections/{key}/probe")
async def start_probe(sid: int, key: str):
    """Ask the interviewer to probe this (saved) section. One probe per section; needs the answer key."""
    sec = _section(sid, key)
    if sec["status"] != "saved":
        raise HTTPException(400, "save the section first")
    ses = db.one("SELECT question_id FROM sessions WHERE id=?", (sid,))
    if not pipeline.latest_brief(ses["question_id"]):
        raise HTTPException(409, "The answer key is still being prepared. Try again in a moment.")
    row = db.one("SELECT question FROM probes WHERE section_id=?", (sec["id"],))
    if row and row["question"]:
        raise HTTPException(409, "this section was already probed")
    if not row:
        db.execute("INSERT INTO probes(section_id,created_at) VALUES(?,?)", (sec["id"], time.time()))
    return {"job_id": jobs.enqueue("probe", sec["id"])}


@app.post("/api/sessions/{sid}/sections/{key}/probe/transcribe")
async def transcribe_probe_answer(sid: int, key: str, file: UploadFile = File(...)):
    """Transcribe a spoken probe answer and return the text; nothing is stored, the candidate edits then submits it."""
    import asyncio
    import tempfile
    from pathlib import Path
    _section(sid, key)
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty upload")
    ctype = (file.content_type or "").lower()
    ext = "mp4" if ("mp4" in ctype or "m4a" in ctype or "aac" in ctype) else "webm"
    with tempfile.TemporaryDirectory(dir=config.AUDIO_DIR if config.AUDIO_DIR.exists() else None) as tmp:
        audio, wav = Path(tmp) / f"probe.{ext}", Path(tmp) / "probe.wav"
        audio.write_bytes(data)
        try:
            await transcribe.convert_to_wav(audio, wav)
        except RuntimeError as e:
            raise HTTPException(400, str(e))
        model = config.get_setting(db.connect(), "whisper_model")
        result = await asyncio.to_thread(transcribe.transcribe_wav, wav, model, config.load_vocabulary())
    return {"text": result["text"]}


@app.put("/api/sessions/{sid}/sections/{key}/probe/answer")
async def answer_probe(sid: int, key: str, body: ProbeAnswer):
    sec = _section(sid, key)
    row = db.one("SELECT question FROM probes WHERE section_id=?", (sec["id"],))
    if not row or not row["question"]:
        raise HTTPException(400, "no probe to answer")
    if not body.text.strip():
        raise HTTPException(400, "answer is empty")
    db.execute("UPDATE probes SET answer=?, answered_at=? WHERE section_id=?", (body.text.strip(), time.time(), sec["id"]))
    return {"job_id": jobs.enqueue("grade_section", sec["id"])}  # the probed section is graded now, with the exchange


@app.delete("/api/sessions/{sid}/sections/{key}/probe")
async def skip_probe(sid: int, key: str):
    """Drop a probe that never produced a question (failed or stuck), so the candidate is not blocked."""
    sec = _section(sid, key)
    row = db.one("SELECT question FROM probes WHERE section_id=?", (sec["id"],))
    if row and row["question"]:
        raise HTTPException(409, "the probe is already asked: answer it")
    db.execute("DELETE FROM jobs WHERE type='probe' AND ref_id=? AND status!='running'", (sec["id"],))
    db.execute("DELETE FROM probes WHERE section_id=?", (sec["id"],))
    return {"job_id": jobs.enqueue("grade_section", sec["id"])}  # no probe after all: grade the section as usual


@app.post("/api/sessions/{sid}/finish")
async def finish_session(sid: int):
    session_payload(sid)
    if db.one("SELECT 1 FROM probes p JOIN sections s ON s.id=p.section_id WHERE s.session_id=? AND p.question IS NOT NULL "
              "AND p.answer IS NULL", (sid,)):
        raise HTTPException(400, "answer the open probe first")
    unsaved = db.one("SELECT COUNT(*) n FROM sections WHERE session_id=? AND status!='saved'", (sid,))["n"]
    if unsaved:
        raise HTTPException(400, f"{unsaved} section(s) not saved yet")
    db.execute("UPDATE sessions SET status='grading', finished_at=? WHERE id=?", (time.time(), sid))
    return {"job_id": jobs.enqueue("grade_session", sid)}


# ---- improvement areas -----------------------------------------------------------------

class ImprovementBody(BaseModel):
    session_ids: list[int] | None = None  # which graded sessions to review; default: the last k
    k: int = 5
    model: str = "default"
    force: bool = False


def _improvement_row(r: dict | None) -> dict | None:
    if not r:
        return None
    job = db.one("SELECT id, status, error, error_kind FROM jobs WHERE type='improvement' AND ref_id=? ORDER BY id DESC LIMIT 1", (r["id"],))
    return {"id": r["id"], "k": r["k"], "status": r["status"], "created_at": r["created_at"], "model": r["model"] or r["requested_model"],
            "session_ids": json.loads(r["session_ids_json"]), "result": json.loads(r["result_json"]) if r["result_json"] else None,
            "job": job}


@app.post("/api/improvements")
async def create_improvement(body: ImprovementBody):
    if body.model != "default" and body.model not in config.MODEL_CHOICES and not body.model.startswith("claude-") \
            and not providers.valid_model_setting(body.model):
        raise HTTPException(400, "unknown model")
    graded = [s["id"] for s in progress.graded_sessions()]
    if body.session_ids is None:
        if not 1 <= body.k <= 20:
            raise HTTPException(400, "k must be between 1 and 20")
        wanted = graded[-body.k:]
    else:
        wanted = [i for i in graded if i in set(body.session_ids)]
    if not wanted:
        raise HTTPException(400, "pick at least one graded session")
    if len(wanted) > 20:
        raise HTTPException(400, "pick at most 20 sessions")
    model = pipeline.improvement_model(None if body.model == "default" else body.model)
    if not body.force:  # same sessions and model already reviewed: reuse it instead of paying for another call
        cached = db.one("SELECT * FROM improvement_reports WHERE status='done' AND session_ids_json=? AND model=? ORDER BY id DESC LIMIT 1",
                        (json.dumps(wanted), model))
        if cached:
            return _improvement_row(cached)
    rid = db.execute("INSERT INTO improvement_reports(k,session_ids_json,status,requested_model,created_at) VALUES(?,?,'queued',?,?)",
                     (len(wanted), json.dumps(wanted), None if body.model == "default" else body.model, time.time()))
    jobs.enqueue("improvement", rid)
    return _improvement_row(db.one("SELECT * FROM improvement_reports WHERE id=?", (rid,)))


@app.get("/api/improvements/latest")
async def latest_improvement(session_id: int | None = None):
    """The newest report; with session_id, the newest one made for exactly that session (the report page)."""
    for r in db.rows("SELECT * FROM improvement_reports ORDER BY id DESC"):
        if session_id is None or json.loads(r["session_ids_json"]) == [session_id]:
            return _improvement_row(r)
    return None


@app.get("/api/improvements/{rid}")
async def get_improvement(rid: int):
    r = _improvement_row(db.one("SELECT * FROM improvement_reports WHERE id=?", (rid,)))
    if not r:
        raise HTTPException(404, "report not found")
    return r


@app.delete("/api/improvements/{rid}")
async def delete_improvement(rid: int):
    if not db.one("SELECT 1 FROM improvement_reports WHERE id=?", (rid,)):
        raise HTTPException(404, "report not found")
    if db.one("SELECT 1 FROM jobs WHERE type='improvement' AND ref_id=? AND status='running'", (rid,)):
        raise HTTPException(409, "This review is still running. Try again in a moment.")
    db.execute("DELETE FROM jobs WHERE type='improvement' AND ref_id=?", (rid,))
    db.execute("DELETE FROM improvement_reports WHERE id=?", (rid,))
    return {"ok": True}


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
    ph = ",".join("?" * len(secs)) or "NULL"
    if db.one(f"SELECT 1 FROM jobs WHERE status='running' AND ((type IN ('transcribe','grade_section','probe') AND ref_id IN ({ph})) "
              "OR (type='grade_session' AND ref_id=?))", (*secs, sid)):
        raise HTTPException(409, "A job for this session is still running. Try again in a moment.")
    for sec in secs:
        conn.execute("DELETE FROM jobs WHERE type IN ('transcribe','grade_section','probe') AND ref_id=?", (sec,))
    conn.execute("DELETE FROM jobs WHERE type='grade_session' AND ref_id=?", (sid,))
    conn.execute("DELETE FROM sessions WHERE id=?", (sid,))  # sections, grades, gaps cascade
    conn.commit()
    import shutil
    shutil.rmtree(config.AUDIO_DIR / str(sid), ignore_errors=True)
    (config.EXPORT_DIR / f"{sid}.md").unlink(missing_ok=True)
    return {"ok": True}


app.include_router(articles.router)


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
    override = None if body.model == "default" else body.model
    if override and override not in config.MODEL_CHOICES and not override.startswith("claude-") and not providers.valid_model_setting(override):
        raise HTTPException(400, "unknown model")
    # "default" clears the override so each task uses its own model setting
    db.execute("UPDATE sessions SET model=?, status='grading', finished_at=? WHERE id=?", (override, time.time(), sid))
    for sec in db.rows("SELECT id FROM sections WHERE session_id=? AND status='saved'", (sid,)):
        jobs.enqueue("grade_section", sec["id"])
    return {"job_id": jobs.enqueue("grade_session", sid)}


# ---- settings --------------------------------------------------------------------

@app.get("/api/settings")
async def get_settings():
    return config.all_settings(db.connect())


@app.put("/api/settings")
async def put_settings(body: dict):
    try:
        config.put_settings(db.connect(), body)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return config.all_settings(db.connect())


# ---- providers (API keys + model lists) ------------------------------------------------

def _provider(name: str) -> str:
    if name not in providers.PROVIDERS:
        raise HTTPException(404, "unknown provider")
    return name


class KeyBody(BaseModel):
    key: str


@app.get("/api/providers")
async def get_providers():
    return providers.key_status()


@app.put("/api/providers/{name}/key")
async def put_provider_key(name: str, body: KeyBody):
    name = _provider(name)
    key = body.key.strip()
    try:
        await providers.test_key(name, key)  # a bad paste must not overwrite a working key
        providers.set_key(name, key)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return providers.key_status()


@app.delete("/api/providers/{name}/key")
async def delete_provider_key(name: str):
    providers.delete_key(_provider(name))
    return providers.key_status()


@app.get("/api/providers/{name}/models")
async def provider_models(name: str):
    try:
        return await providers.list_models(_provider(name))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@app.post("/api/providers/{name}/use")
async def use_provider_for_grading(name: str):
    """One click for people without Claude: grade sections and the overall result with this provider's best free model."""
    name = _provider(name)
    if not providers.get_key(name):
        raise HTTPException(400, "Add an API key for this provider first.")
    try:
        models = await providers.list_models(name)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    chosen = providers.recommend(models)
    if not chosen:
        raise HTTPException(502, "No suitable model was found. Pick one in Settings.")
    config.put_settings(db.connect(), {"model_section": f"{name}:{chosen}", "model_holistic": f"{name}:{chosen}"})
    return {"model": f"{name}:{chosen}"}


# ---- UI --------------------------------------------------------------------------------

# The bundled app (and `STATIC_EXPORT=1 npm run build`) serves the exported UI from this same process.
WEB_DIR = Path(os.environ.get("SD_COACH_WEB") or Path(__file__).resolve().parent.parent / "web" / "out")

if (WEB_DIR / "index.html").exists():
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
else:
    @app.get("/")
    async def index():
        """In development the UI is the Next.js dev server; this API only serves /api."""
        return RedirectResponse(os.environ.get("WEB_URL", "http://127.0.0.1:3000"))
