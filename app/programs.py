"""Programs: a named, finite set of coding problems and design questions to work through (/api/programs).

An item is (kind, ref): `code` refs are problem slugs, `design` refs are question ids and `behavioral` refs are behavioral
question ids, both as text.
A program may have a schedule: a start and end date (ISO, the user's calendar days) and a planned day per item."""
import datetime as dt
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import behavioral, db
from .code import routes as code_routes

router = APIRouter(prefix="/api/programs")
KINDS = ("code", "design", "behavioral")


class NameBody(BaseModel):
    name: str


class ItemBody(BaseModel):
    kind: str
    ref: str


class ScheduleBody(BaseModel):
    start_date: str
    end_date: str


class DayBody(ItemBody):
    day: str | None = None


class SpreadBody(BaseModel):
    weekend_weight: float = 1.0  # how much more a Saturday or Sunday carries than a weekday


MAX_DAYS = 90
# Rough effort per item, used only to spread items evenly over days: a design session is about two medium problems.
EFFORT = {"Easy": 0.5, "Medium": 1.0, "Hard": 1.5, "Build": 2.0}
DESIGN_EFFORT = 2.0
BEHAVIORAL_EFFORT = 0.5


def _date(s: str) -> dt.date:
    try:
        return dt.date.fromisoformat(s)
    except (TypeError, ValueError):
        raise HTTPException(400, f"not a date: {s!r}") from None


def _days(p: dict) -> list[str]:
    if not p.get("start_date") or not p.get("end_date"):
        return []
    start, end = dt.date.fromisoformat(p["start_date"]), dt.date.fromisoformat(p["end_date"])
    return [(start + dt.timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]


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


def _sources() -> dict[str, dict[str, dict]]:
    """Every problem and question a program item can point at, by kind then ref."""
    return {"code": {r["slug"]: r for r in code_routes.roadmap_rows()}, "design": _design_status(), "behavioral": behavioral.status_map()}


def _items(pid: int, sources: dict[str, dict[str, dict]]) -> list[dict]:
    out = []
    for it in db.rows("SELECT kind, ref, day FROM program_items WHERE program_id=? ORDER BY ord", (pid,)):
        src = sources.get(it["kind"], {}).get(it["ref"])
        if not src:  # the problem or question was removed since it was added
            continue
        if it["kind"] == "code":
            out.append({"kind": "code", "ref": it["ref"], "title": src["title"], "num": src["num"], "difficulty": src["difficulty"],
                        "status": src["status"], "rating": src["rating"], "day": it["day"]})
        else:
            out.append({"kind": it["kind"], "ref": it["ref"], "title": src["title"], "num": None, "difficulty": None,
                        "status": src["status"], "rating": None, "day": it["day"]})
    return out


def _summary(p: dict, items: list[dict]) -> dict:
    return {"id": p["id"], "name": p["name"], "total": len(items), "done": sum(1 for i in items if i["status"] == "done"),
            "start_date": p.get("start_date"), "end_date": p.get("end_date"), "days": _days(p), "items": items}


def _effort(item: dict) -> float:
    if item["kind"] == "design":
        return DESIGN_EFFORT
    if item["kind"] == "behavioral":
        return BEHAVIORAL_EFFORT
    return EFFORT.get(item["difficulty"] or "", 1.0)


def spread(items: list[dict], days: list[str], weekend_weight: float = 1.0) -> list[str]:
    """Plan a day per item, keeping the items' order. Each day's share of the work is proportional to its capacity
    (1 on weekdays, `weekend_weight` on Saturday and Sunday). Items never split across days."""
    caps = [weekend_weight if dt.date.fromisoformat(d).weekday() >= 5 else 1.0 for d in days]
    bounds, acc = [], 0.0
    for c in caps:
        acc += c
        bounds.append(acc)
    total = sum(_effort(i) for i in items) or 1.0
    out, before = [], 0.0
    for it in items:
        w = _effort(it)
        x = (before + w / 2) / total * acc  # the item's midpoint on the capacity line
        out.append(days[next((i for i, b in enumerate(bounds) if x < b), len(days) - 1)])
        before += w
    return out


@router.get("")
async def list_programs():
    sources = _sources()
    return [_summary(p, _items(p["id"], sources)) for p in db.rows("SELECT * FROM programs ORDER BY id")]


@router.post("")
async def create_program(body: NameBody):
    pid = db.execute("INSERT INTO programs(name, created_at) VALUES(?,?)", (_name(body), time.time()))
    return {"id": pid}


@router.get("/{pid}")
async def get_program(pid: int):
    p = _program(pid)
    return _summary(p, _items(pid, _sources()))


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
    elif body.kind == "behavioral":
        found = body.ref.isdigit() and db.one("SELECT 1 FROM behavioral_questions WHERE id=? AND active=1", (int(body.ref),))
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


@router.put("/{pid}/schedule")
async def set_schedule(pid: int, body: ScheduleBody):
    """Set the dates the program runs over. Items planned for a day outside the new range become unscheduled."""
    _program(pid)
    start, end = _date(body.start_date), _date(body.end_date)
    if end < start:
        raise HTTPException(400, "end date is before start date")
    if (end - start).days + 1 > MAX_DAYS:
        raise HTTPException(400, f"a program runs at most {MAX_DAYS} days")
    conn = db.connect()
    conn.execute("UPDATE programs SET start_date=?, end_date=? WHERE id=?", (start.isoformat(), end.isoformat(), pid))
    conn.execute("UPDATE program_items SET day=NULL WHERE program_id=? AND (day < ? OR day > ?)", (pid, start.isoformat(), end.isoformat()))
    conn.commit()
    return await get_program(pid)


@router.delete("/{pid}/schedule")
async def clear_schedule(pid: int):
    _program(pid)
    conn = db.connect()
    conn.execute("UPDATE programs SET start_date=NULL, end_date=NULL WHERE id=?", (pid,))
    conn.execute("UPDATE program_items SET day=NULL WHERE program_id=?", (pid,))
    conn.commit()
    return {"ok": True}


@router.post("/{pid}/schedule/spread")
async def spread_schedule(pid: int, body: SpreadBody | None = None):
    """Plan every item, in program order, so each day gets effort in proportion to its capacity (weekends can carry more).
    Replaces any days already planned."""
    p = _program(pid)
    days = _days(p)
    if not days:
        raise HTTPException(409, "set the program's dates first")
    weight = max(0.25, min(5.0, (body or SpreadBody()).weekend_weight))
    items = _items(pid, _sources())
    conn = db.connect()
    for it, day in zip(items, spread(items, days, weight)):
        conn.execute("UPDATE program_items SET day=? WHERE program_id=? AND kind=? AND ref=?", (day, pid, it["kind"], it["ref"]))
    conn.commit()
    return await get_program(pid)


@router.put("/{pid}/items/day")
async def set_item_day(pid: int, body: DayBody):
    """Move one item to a day of the program (or to unscheduled with day null). It goes last within that day."""
    p = _program(pid)
    if body.day is not None and body.day not in _days(p):
        raise HTTPException(400, "day is outside the program's dates")
    if not db.one("SELECT 1 FROM program_items WHERE program_id=? AND kind=? AND ref=?", (pid, body.kind, body.ref)):
        raise HTTPException(404, "not in this program")
    nxt = db.one("SELECT COALESCE(MAX(ord), 0) + 1 n FROM program_items WHERE program_id=?", (pid,))["n"]
    db.execute("UPDATE program_items SET day=?, ord=? WHERE program_id=? AND kind=? AND ref=?", (body.day, nxt, pid, body.kind, body.ref))
    return {"ok": True}
