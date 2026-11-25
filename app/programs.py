"""Programs: a named, finite set of coding problems and design questions to work through (/api/programs).

An item is (kind, ref): `code` refs are problem slugs, `design` refs are question ids as text."""
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import db
from .code import routes as code_routes

router = APIRouter(prefix="/api/programs")
KINDS = ("code", "design")


class NameBody(BaseModel):
    name: str


class ItemBody(BaseModel):
    kind: str
    ref: str


def _program(pid: int) -> dict:
    p = db.one("SELECT * FROM programs WHERE id=?", (pid,))
    if not p:
        raise HTTPException(404, "program not found")
    return p


def _name(body: NameBody) -> str:
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "name required")
    return name[:80]


def _design_status() -> dict[str, dict]:
    """Per question id: done once any session of it has a finished grade."""
    graded = {r["question_id"] for r in db.rows(
        "SELECT DISTINCT s.question_id FROM session_grades g JOIN sessions s ON s.id=g.session_id WHERE g.status='done'")}
    tried = {r["question_id"] for r in db.rows("SELECT DISTINCT question_id FROM sessions")}
    out = {}
    for q in db.rows("SELECT id, title FROM questions"):
        out[str(q["id"])] = {"title": q["title"], "status": "done" if q["id"] in graded else "attempted" if q["id"] in tried else "todo"}
    return out


def _items(pid: int, code: dict[str, dict], design: dict[str, dict]) -> list[dict]:
    out = []
    for it in db.rows("SELECT kind, ref FROM program_items WHERE program_id=? ORDER BY ord", (pid,)):
        src = (code if it["kind"] == "code" else design).get(it["ref"])
        if not src:  # the problem or question was removed since it was added
            continue
        if it["kind"] == "code":
            out.append({"kind": "code", "ref": it["ref"], "title": src["title"], "num": src["num"], "difficulty": src["difficulty"],
                        "status": src["status"], "rating": src["rating"]})
        else:
            out.append({"kind": "design", "ref": it["ref"], "title": src["title"], "num": None, "difficulty": None,
                        "status": src["status"], "rating": None})
    return out


def _summary(p: dict, items: list[dict]) -> dict:
    return {"id": p["id"], "name": p["name"], "total": len(items), "done": sum(1 for i in items if i["status"] == "done"), "items": items}


@router.get("")
async def list_programs():
    code = {r["slug"]: r for r in code_routes.roadmap_rows()}
    design = _design_status()
    return [_summary(p, _items(p["id"], code, design)) for p in db.rows("SELECT * FROM programs ORDER BY id")]


@router.post("")
async def create_program(body: NameBody):
    pid = db.execute("INSERT INTO programs(name, created_at) VALUES(?,?)", (_name(body), time.time()))
    return {"id": pid}


@router.get("/{pid}")
async def get_program(pid: int):
    p = _program(pid)
    items = _items(pid, {r["slug"]: r for r in code_routes.roadmap_rows()}, _design_status())
    return _summary(p, items)


@router.patch("/{pid}")
async def rename_program(pid: int, body: NameBody):
    _program(pid)
    db.execute("UPDATE programs SET name=? WHERE id=?", (_name(body), pid))
    return {"ok": True}


@router.delete("/{pid}")
async def delete_program(pid: int):
    _program(pid)
    db.execute("DELETE FROM programs WHERE id=?", (pid,))
    return {"ok": True}


def _check_item(body: ItemBody) -> None:
    if body.kind == "code":
        found = db.one("SELECT 1 FROM problems WHERE slug=?", (body.ref,))
    elif body.kind == "design":
        found = body.ref.isdigit() and db.one("SELECT 1 FROM questions WHERE id=?", (int(body.ref),))
    else:
        raise HTTPException(400, f"kind must be one of {KINDS}")
    if not found:
        raise HTTPException(404, "no such problem or question")


@router.put("/{pid}/items")
async def add_item(pid: int, body: ItemBody):
    _program(pid)
    _check_item(body)
    nxt = db.one("SELECT COALESCE(MAX(ord), 0) + 1 n FROM program_items WHERE program_id=?", (pid,))["n"]
    db.execute("INSERT OR IGNORE INTO program_items(program_id, kind, ref, ord) VALUES(?,?,?,?)", (pid, body.kind, body.ref, nxt))
    return {"ok": True}


@router.delete("/{pid}/items")
async def remove_item(pid: int, kind: str, ref: str):
    _program(pid)
    db.execute("DELETE FROM program_items WHERE program_id=? AND kind=? AND ref=?", (pid, kind, ref))
    return {"ok": True}
