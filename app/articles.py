"""Explainer articles for concepts you studied, grouped by the design problem they came up in.

Explain flow: send the concept plus a compressed article list to the model, which picks an existing article or says none
fits; if none fits, a second call writes a new one."""
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import db, grader, pipeline

router = APIRouter(prefix="/api/articles")

MODELS = {"sonnet": "sonnet", "opus": "opus", "free": "openrouter:nvidia/nemotron-3-super-120b-a12b:free"}
MAX_ARTICLES = 300

PICK_SYSTEM = ("You route a learner's concept to an existing article in their library. Each line is `[id] Title: summary`. "
               "Pick the article that already explains the concept well enough to read. If none covers it, answer null. "
               "Do not pick an article that is only loosely related.")
PICK_SCHEMA = {"type": "object", "properties": {"article_id": {"type": ["integer", "null"]}, "reason": {"type": "string"}},
               "required": ["article_id", "reason"], "additionalProperties": False}
WRITE_SYSTEM = ("You are a staff-level system design mentor writing one knowledge-base article for an engineer preparing for staff interviews. "
                "Cover what the concept is, why it matters, how it works with a concrete example, tradeoffs and failure modes, and what to say "
                "out loud in an interview. Write markdown with short sections, under 700 words. The summary is one sentence under 160 characters. "
                "Mention related existing articles in the body by title.")
WRITE_SCHEMA = {"type": "object", "properties": {"title": {"type": "string"}, "summary": {"type": "string"}, "body": {"type": "string"}},
                "required": ["title", "summary", "body"], "additionalProperties": False}
ASK_SYSTEM = ("You answer a learner's question about the article below. Ground the answer in the article, add what is missing, and say so "
              "when the article is wrong or incomplete. Be concise, in markdown.")
ASK_SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"], "additionalProperties": False}


def _model(key: str) -> str:
    m = MODELS.get(key)
    if not m:
        raise HTTPException(400, f"model must be one of {', '.join(MODELS)}")
    return m


async def _call(kind: str, system: str, payload: str, schema: dict, model: str, validator=None) -> dict:
    res = await grader.run_claude(kind, system, payload, schema, model, 300, pipeline._settings()[1], validator, {}, web=False)
    if not res["ok"]:
        raise HTTPException(502, res["error"] or "the model call failed")
    return res["structured"]


def article_list() -> str:
    """One line per article, newest first, capped so the prompt stays small."""
    return "\n".join(f"[{a['id']}] {a['title']}: {a['summary'][:120]}"
                     for a in db.rows("SELECT id,title,summary FROM articles ORDER BY updated_at DESC LIMIT ?", (MAX_ARTICLES,)))


def article(aid: int) -> dict:
    a = db.one("SELECT * FROM articles WHERE id=?", (aid,))
    if not a:
        raise HTTPException(404, "no such article")
    a["questions"] = db.rows("SELECT q.id,q.title FROM article_questions k JOIN questions q ON q.id=k.question_id WHERE k.article_id=? ORDER BY q.title", (aid,))
    return a


class ExplainRequest(BaseModel):
    concept: str
    why: str = ""
    key_ideas: list[str] = []
    model: str = "sonnet"
    session_ids: list[int] = []  # sessions where the concept showed up; their design problems group the article


def _tag_questions(aid: int, session_ids: list[int]) -> None:
    for r in db.rows(f"SELECT DISTINCT question_id FROM sessions WHERE id IN ({','.join('?' * len(session_ids))})", tuple(session_ids)) if session_ids else []:
        db.execute("INSERT OR IGNORE INTO article_questions(article_id,question_id) VALUES(?,?)", (aid, r["question_id"]))


@router.post("/explain")
async def explain(req: ExplainRequest):
    model = _model(req.model)
    concept = req.concept.strip()
    if not concept:
        raise HTTPException(400, "concept is required")
    detail = f"Concept: {concept}\nWhy it matters to this learner: {req.why}\nKey ideas: " + "; ".join(req.key_ideas)
    listing = article_list()
    reason = ""
    if listing:
        pick = await _call("article_pick", PICK_SYSTEM, f"{detail}\n\nArticles:\n{listing}", PICK_SCHEMA, model)
        reason = pick.get("reason", "")
        aid = pick.get("article_id")
        if aid is not None and db.one("SELECT 1 FROM articles WHERE id=?", (aid,)):
            _tag_questions(aid, req.session_ids)
            return {"article": article(aid), "created": False, "reason": reason}
    w = await _call("article_write", WRITE_SYSTEM, f"{detail}\n\nExisting articles:\n{listing or '(none)'}", WRITE_SCHEMA, model,
                    lambda r: None if str(r.get("title", "")).strip() and str(r.get("body", "")).strip() else "title and body must be non-empty")
    title = w["title"].strip()
    same = db.one("SELECT id FROM articles WHERE lower(title)=lower(?)", (title,))
    if same:
        _tag_questions(same["id"], req.session_ids)
        return {"article": article(same["id"]), "created": False, "reason": reason}
    now = time.time()
    aid = db.execute("INSERT INTO articles(title,summary,body,model,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                     (title, w.get("summary", "").strip(), w["body"].strip(), model, now, now))
    _tag_questions(aid, req.session_ids)
    return {"article": article(aid), "created": True, "reason": reason}


@router.get("")
async def list_articles():
    qs: dict[int, list[dict]] = {}
    for r in db.rows("SELECT k.article_id aid,q.id,q.title FROM article_questions k JOIN questions q ON q.id=k.question_id ORDER BY q.title"):
        qs.setdefault(r["aid"], []).append({"id": r["id"], "title": r["title"]})
    return [dict(n, questions=qs.get(n["id"], [])) for n in db.rows("SELECT id,title,summary,updated_at FROM articles ORDER BY title COLLATE NOCASE")]


@router.get("/{aid}")
async def get_article(aid: int):
    return article(aid)


class ArticleEdit(BaseModel):
    title: str
    summary: str = ""
    body: str = ""


@router.put("/{aid}")
async def edit_article(aid: int, e: ArticleEdit):
    article(aid)
    title = e.title.strip()
    if not title:
        raise HTTPException(400, "title is required")
    if db.one("SELECT 1 FROM articles WHERE lower(title)=lower(?) AND id<>?", (title, aid)):
        raise HTTPException(409, "another article has this title")
    db.execute("UPDATE articles SET title=?, summary=?, body=?, updated_at=? WHERE id=?", (title, e.summary.strip(), e.body, time.time(), aid))
    return article(aid)


@router.delete("/{aid}")
async def delete_article(aid: int):
    article(aid)
    db.execute("DELETE FROM article_questions WHERE article_id=?", (aid,))
    db.execute("DELETE FROM articles WHERE id=?", (aid,))
    return {"ok": True}


class AskRequest(BaseModel):
    question: str
    model: str = "sonnet"


@router.post("/{aid}/ask")
async def ask(aid: int, req: AskRequest):
    model = _model(req.model)
    a = article(aid)
    q = req.question.strip()
    if not q:
        raise HTTPException(400, "question is required")
    r = await _call("article_ask", ASK_SYSTEM, f"# {a['title']}\n\n{a['body']}\n\n---\nQuestion: {q}", ASK_SCHEMA, model,
                    lambda r: None if str(r.get("answer", "")).strip() else "answer is empty")
    return {"answer": r["answer"], "model": model}
