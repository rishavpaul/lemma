"""Knowledge graph of explainer articles: concepts you studied, linked to related concepts.

Explain flow: send the concept plus a compressed graph to the model, which picks an existing article or says none fits;
if none fits, a second call writes a new article that links to related ones."""
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import db, grader, pipeline

router = APIRouter(prefix="/api/kg")

MODELS = {"sonnet": "sonnet", "opus": "opus", "free": "openrouter:nvidia/nemotron-3-super-120b-a12b:free"}
MAX_NODES = 300

PICK_SYSTEM = ("You route a learner's concept to an existing article in their knowledge graph. Each line is `[id] Title: summary -> linked titles`. "
               "Pick the article that already explains the concept well enough to read. If none covers it, answer null. "
               "Do not pick an article that is only loosely related.")
PICK_SCHEMA = {"type": "object", "properties": {"article_id": {"type": ["integer", "null"]}, "reason": {"type": "string"}},
               "required": ["article_id", "reason"], "additionalProperties": False}
WRITE_SYSTEM = ("You are a staff-level system design mentor writing one knowledge-base article for an engineer preparing for staff interviews. "
                "Cover what the concept is, why it matters, how it works with a concrete example, tradeoffs and failure modes, and what to say "
                "out loud in an interview. Write markdown with short sections, under 700 words. The summary is one sentence under 160 characters. "
                "`related_ids` lists ids of existing articles (from the graph given) that this concept directly builds on or connects to; "
                "mention them in the body by title.")
WRITE_SCHEMA = {"type": "object", "properties": {"title": {"type": "string"}, "summary": {"type": "string"}, "body": {"type": "string"},
                                                 "related_ids": {"type": "array", "items": {"type": "integer"}}},
                "required": ["title", "summary", "body", "related_ids"], "additionalProperties": False}
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


def compressed_graph() -> str:
    """One line per article, newest first, capped so the prompt stays small."""
    arts = db.rows("SELECT id,title,summary FROM kg_articles ORDER BY updated_at DESC LIMIT ?", (MAX_NODES,))
    titles = {a["id"]: a["title"] for a in arts}
    links: dict[int, list[str]] = {}
    for r in db.rows("SELECT src,dst FROM kg_links"):
        if r["src"] in titles and r["dst"] in titles:
            links.setdefault(r["src"], []).append(titles[r["dst"]])
    return "\n".join(f"[{a['id']}] {a['title']}: {a['summary'][:120]}" + (f" -> {', '.join(links[a['id']])}" if a["id"] in links else "")
                     for a in arts)


def article(aid: int) -> dict:
    a = db.one("SELECT * FROM kg_articles WHERE id=?", (aid,))
    if not a:
        raise HTTPException(404, "no such article")
    a["links"] = [r["id"] for r in db.rows("SELECT dst id FROM kg_links WHERE src=? UNION SELECT src FROM kg_links WHERE dst=?", (aid, aid))]
    return a


class ExplainRequest(BaseModel):
    concept: str
    why: str = ""
    key_ideas: list[str] = []
    model: str = "sonnet"


@router.post("/explain")
async def explain(req: ExplainRequest):
    model = _model(req.model)
    concept = req.concept.strip()
    if not concept:
        raise HTTPException(400, "concept is required")
    detail = f"Concept: {concept}\nWhy it matters to this learner: {req.why}\nKey ideas: " + "; ".join(req.key_ideas)
    graph = compressed_graph()
    reason = ""
    if graph:
        pick = await _call("kg_pick", PICK_SYSTEM, f"{detail}\n\nKnowledge graph:\n{graph}", PICK_SCHEMA, model)
        reason = pick.get("reason", "")
        aid = pick.get("article_id")
        if aid is not None and db.one("SELECT 1 FROM kg_articles WHERE id=?", (aid,)):
            return {"article": article(aid), "created": False, "reason": reason}
    w = await _call("kg_write", WRITE_SYSTEM, f"{detail}\n\nExisting knowledge graph:\n{graph or '(empty)'}", WRITE_SCHEMA, model,
                    lambda r: None if str(r.get("title", "")).strip() and str(r.get("body", "")).strip() else "title and body must be non-empty")
    title = w["title"].strip()
    same = db.one("SELECT id FROM kg_articles WHERE lower(title)=lower(?)", (title,))
    if same:
        return {"article": article(same["id"]), "created": False, "reason": reason}
    now = time.time()
    aid = db.execute("INSERT INTO kg_articles(title,summary,body,model,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                     (title, w.get("summary", "").strip(), w["body"].strip(), model, now, now))
    for rid in set(w.get("related_ids", [])):
        if rid != aid and db.one("SELECT 1 FROM kg_articles WHERE id=?", (rid,)):
            db.execute("INSERT OR IGNORE INTO kg_links(src,dst) VALUES(?,?)", (aid, rid))
    return {"article": article(aid), "created": True, "reason": reason}


@router.get("")
async def graph():
    return {"nodes": db.rows("SELECT id,title,summary,updated_at FROM kg_articles ORDER BY title COLLATE NOCASE"),
            "edges": db.rows("SELECT src,dst FROM kg_links")}


@router.get("/articles/{aid}")
async def get_article(aid: int):
    return article(aid)


class ArticleEdit(BaseModel):
    title: str
    summary: str = ""
    body: str = ""


@router.put("/articles/{aid}")
async def edit_article(aid: int, e: ArticleEdit):
    article(aid)
    title = e.title.strip()
    if not title:
        raise HTTPException(400, "title is required")
    if db.one("SELECT 1 FROM kg_articles WHERE lower(title)=lower(?) AND id<>?", (title, aid)):
        raise HTTPException(409, "another article has this title")
    db.execute("UPDATE kg_articles SET title=?, summary=?, body=?, updated_at=? WHERE id=?", (title, e.summary.strip(), e.body, time.time(), aid))
    return article(aid)


@router.delete("/articles/{aid}")
async def delete_article(aid: int):
    article(aid)
    db.execute("DELETE FROM kg_links WHERE src=? OR dst=?", (aid, aid))
    db.execute("DELETE FROM kg_articles WHERE id=?", (aid,))
    return {"ok": True}


class AskRequest(BaseModel):
    question: str
    model: str = "sonnet"


@router.post("/articles/{aid}/ask")
async def ask(aid: int, req: AskRequest):
    model = _model(req.model)
    a = article(aid)
    q = req.question.strip()
    if not q:
        raise HTTPException(400, "question is required")
    r = await _call("kg_ask", ASK_SYSTEM, f"# {a['title']}\n\n{a['body']}\n\n---\nQuestion: {q}", ASK_SCHEMA, model,
                    lambda r: None if str(r.get("answer", "")).strip() else "answer is empty")
    return {"answer": r["answer"], "model": model}
