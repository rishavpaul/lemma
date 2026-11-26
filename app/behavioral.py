"""Behavioral and leadership rounds (/api/behavioral): a question bank grouped by competency, reusable stories, a draft per
question and attempts graded by a staff-level judge (job `behavioral_review`).

Answers are transcripts of the user's own speech or writing: they stay in the database and are never logged."""
import json
import time

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from . import config, db, grader, jobs, pipeline, transcribe

router = APIRouter(prefix="/api/behavioral")
TIMEOUT = 300
MAX_ANSWER = 20000


class DraftBody(BaseModel):
    text: str | None = None
    story_id: int | None = None


class AttemptBody(BaseModel):
    text: str
    story_id: int | None = None


class StoryBody(BaseModel):
    title: str
    notes: str = ""


def _question(qid: int) -> dict:
    q = db.one("SELECT * FROM behavioral_questions WHERE id=?", (qid,))
    if not q:
        raise HTTPException(404, "question not found")
    return q


def _story(sid: int) -> dict:
    s = db.one("SELECT * FROM behavioral_stories WHERE id=?", (sid,))
    if not s:
        raise HTTPException(404, "story not found")
    return s


def _score(a: dict) -> float | None:
    return json.loads(a["result_json"]).get("overall_score") if a.get("result_json") else None


def status_map() -> dict[str, dict]:
    """Per question id (as text): title and status. Done once an answer has been graded; attempted once drafted or submitted."""
    graded = {r["question_id"] for r in db.rows("SELECT DISTINCT question_id FROM behavioral_attempts WHERE status='done'")}
    tried = {r["question_id"] for r in db.rows("SELECT question_id FROM behavioral_attempts UNION SELECT question_id FROM behavioral_drafts WHERE text != ''")}
    return {str(q["id"]): {"title": q["title"], "status": "done" if q["id"] in graded else "attempted" if q["id"] in tried else "todo"}
            for q in db.rows("SELECT id, title FROM behavioral_questions WHERE active=1")}


def competencies() -> list[dict]:
    return config.load_behavioral_yaml().get("competencies", [])


@router.get("")
async def overview():
    status = status_map()
    drafts = {d["question_id"]: d for d in db.rows("SELECT question_id, story_id FROM behavioral_drafts")}
    latest = {}
    for a in db.rows("SELECT question_id, result_json FROM behavioral_attempts WHERE status='done' ORDER BY id"):
        latest[a["question_id"]] = _score(a)
    counts = {r["question_id"]: r["n"] for r in db.rows("SELECT question_id, COUNT(*) n FROM behavioral_attempts GROUP BY question_id")}
    questions = [{"id": q["id"], "slug": q["slug"], "competency": q["competency"], "title": q["title"], "prompt": q["prompt"],
                  "status": status[str(q["id"])]["status"], "story_id": (drafts.get(q["id"]) or {}).get("story_id"),
                  "last_score": latest.get(q["id"]), "attempts": counts.get(q["id"], 0)}
                 for q in db.rows("SELECT * FROM behavioral_questions WHERE active=1 ORDER BY ord")]
    stories = db.rows("SELECT id, title, notes, updated_at FROM behavioral_stories ORDER BY id")
    for s in stories:
        s["question_ids"] = [q["id"] for q in questions if q["story_id"] == s["id"]]
    return {"competencies": competencies(), "questions": questions, "stories": stories}


@router.get("/questions/{qid}")
async def get_question(qid: int):
    q = _question(qid)
    d = db.one("SELECT text, story_id FROM behavioral_drafts WHERE question_id=?", (qid,)) or {"text": "", "story_id": None}
    attempts = db.rows("SELECT * FROM behavioral_attempts WHERE question_id=? ORDER BY id DESC", (qid,))
    for a in attempts:
        a["result"] = json.loads(a.pop("result_json")) if a.get("result_json") else None
        a["job"] = db.one("SELECT id, status, error_kind, error FROM jobs WHERE type='behavioral_review' AND ref_id=? ORDER BY id DESC LIMIT 1", (a["id"],))
    comp = next((c for c in competencies() if c["key"] == q["competency"]), None)
    return {**q, "competency_name": comp["name"] if comp else q["competency"], "competency_why": comp["why"] if comp else "",
            "draft": d["text"], "story_id": d["story_id"], "attempts": attempts,
            "stories": db.rows("SELECT id, title, notes FROM behavioral_stories ORDER BY id")}


@router.put("/questions/{qid}/draft")
async def save_draft(qid: int, body: DraftBody):
    """Autosave the answer being written and the story it uses. Only the fields sent are changed."""
    _question(qid)
    if body.story_id is not None:
        _story(body.story_id)
    cur = db.one("SELECT text, story_id FROM behavioral_drafts WHERE question_id=?", (qid,)) or {"text": "", "story_id": None}
    sent = body.model_fields_set
    text = (body.text or "")[:MAX_ANSWER] if "text" in sent else cur["text"]
    story = body.story_id if "story_id" in sent else cur["story_id"]
    db.execute("INSERT INTO behavioral_drafts(question_id, story_id, text, updated_at) VALUES(?,?,?,?) "
               "ON CONFLICT(question_id) DO UPDATE SET story_id=excluded.story_id, text=excluded.text, updated_at=excluded.updated_at",
               (qid, story, text, time.time()))
    return {"ok": True}


@router.post("/questions/{qid}/attempts")
async def submit(qid: int, body: AttemptBody):
    """Submit an answer to the judge. The draft is kept so the next try can start from it."""
    _question(qid)
    text = body.text.strip()
    if len(text.split()) < 20:
        raise HTTPException(400, "answer the question first (at least a few sentences)")
    if body.story_id is not None:
        _story(body.story_id)
    aid = db.execute("INSERT INTO behavioral_attempts(question_id, story_id, text, created_at) VALUES(?,?,?,?)",
                     (qid, body.story_id, text[:MAX_ANSWER], time.time()))
    return {"attempt_id": aid, "job_id": jobs.enqueue("behavioral_review", aid)}


@router.delete("/attempts/{aid}")
async def delete_attempt(aid: int):
    if not db.one("SELECT 1 FROM behavioral_attempts WHERE id=?", (aid,)):
        raise HTTPException(404, "attempt not found")
    db.execute("DELETE FROM jobs WHERE type='behavioral_review' AND ref_id=? AND status!='running'", (aid,))
    db.execute("DELETE FROM behavioral_attempts WHERE id=?", (aid,))
    return {"ok": True}


@router.post("/transcribe")
async def transcribe_answer(file: UploadFile = File(...)):
    """Transcribe a spoken answer and return the text; nothing is stored until the user saves or submits it."""
    try:
        return {"text": await transcribe.transcribe_upload(await file.read(), file.content_type or "")}
    except ValueError as e:
        raise HTTPException(400, str(e))


def _story_fields(body: StoryBody) -> tuple[str, str]:
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "title required")
    return title[:120], body.notes[:MAX_ANSWER]


@router.post("/stories")
async def create_story(body: StoryBody):
    title, notes = _story_fields(body)
    now = time.time()
    return {"id": db.execute("INSERT INTO behavioral_stories(title, notes, created_at, updated_at) VALUES(?,?,?,?)", (title, notes, now, now))}


@router.patch("/stories/{sid}")
async def update_story(sid: int, body: StoryBody):
    _story(sid)
    title, notes = _story_fields(body)
    db.execute("UPDATE behavioral_stories SET title=?, notes=?, updated_at=? WHERE id=?", (title, notes, time.time(), sid))
    return {"ok": True}


@router.delete("/stories/{sid}")
async def delete_story(sid: int):
    _story(sid)
    db.execute("DELETE FROM behavioral_stories WHERE id=?", (sid,))
    return {"ok": True}


def _validate(r: dict) -> str | None:
    s = r.get("overall_score")
    if not isinstance(s, (int, float)) or not 1 <= s <= 4:
        return "overall_score must be between 1 and 4"
    if not str(r.get("summary", "")).strip():
        return "summary must not be empty"
    return None


@jobs.register("behavioral_review")
async def handle_review(job: dict) -> None:
    a = db.one("SELECT * FROM behavioral_attempts WHERE id=?", (job["ref_id"],))
    if not a:
        return  # deleted while queued
    q = _question(a["question_id"])
    comp = next((c for c in competencies() if c["key"] == q["competency"]), {"name": q["competency"], "why": ""})
    story = db.one("SELECT title, notes FROM behavioral_stories WHERE id=?", (a["story_id"],)) if a["story_id"] else None
    payload = "\n\n".join([
        f"<competency>\n{comp['name']}: {comp['why']}\n</competency>",
        f"<question>\n{q['prompt']}\n</question>",
        f"<look_for>\n{q['look_for']}\n</look_for>",
        (f"<story_notes note=\"the candidate's private prep notes for the story they chose; background only, grade the answer\">\n"
         f"{story['title']}\n{story['notes']}\n</story_notes>") if story else "<story_notes>(none)</story_notes>",
        f"<answer words=\"{len(a['text'].split())}\">\n{a['text']}\n</answer>",
        "<task>\nJudge this answer at the staff bar per the system rules. Return the structured output only.\n</task>",
    ])
    model = config.get_setting(db.connect(), "model_behavioral")
    db.execute("UPDATE behavioral_attempts SET status='running' WHERE id=?", (a["id"],))
    res = await grader.run_claude("behavioral_review", config.load_text("behavioral/review_system_prompt.md"), payload,
                                  config.load_schema("behavioral_review"), model, TIMEOUT, pipeline._settings()[1], _validate,
                                  web=False)
    if not res["ok"]:
        db.execute("UPDATE behavioral_attempts SET status='failed' WHERE id=?", (a["id"],))
        pipeline._raise(res)
    r = res["structured"]
    if not r.get("answers_the_question", True):
        r["overall_score"] = min(r["overall_score"], 2.0)  # the rubric's cap, enforced in code so a generous model cannot lift it
    db.execute("UPDATE behavioral_attempts SET status='done', result_json=?, model=? WHERE id=?", (json.dumps(r), model, a["id"]))
