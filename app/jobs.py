"""Persistent job queue with a transcription worker and Claude worker(s)."""
import asyncio
import json
import logging
import time
from typing import Awaitable, Callable

from . import config, db

log = logging.getLogger("coach.jobs")

TRANSCRIBE_TYPES = ("transcribe",)
CLAUDE_TYPES = ("research", "grade_section", "grade_session")
TERMINAL = ("done", "failed")

# type -> async handler(job: dict) -> None. A handler raises JobError to fail with a classified error.
HANDLERS: dict[str, Callable[[dict], Awaitable[None]]] = {}


class JobError(Exception):
    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind, self.message = kind, message


def register(job_type: str):
    def deco(fn):
        HANDLERS[job_type] = fn
        return fn
    return deco


def enqueue(job_type: str, ref_id: int, depends_on: list[int] | None = None) -> int:
    """Enqueue a job. An identical queued/running job for the same ref is reused."""
    existing = db.one("SELECT id FROM jobs WHERE type=? AND ref_id=? AND status IN ('queued','running')",
                      (job_type, ref_id))
    if existing:
        return existing["id"]
    return db.execute(
        "INSERT INTO jobs(type,ref_id,depends_on_json,created_at) VALUES(?,?,?,?)",
        (job_type, ref_id, json.dumps(depends_on or []), time.time()))


def get_job(job_id: int) -> dict | None:
    return db.one("SELECT * FROM jobs WHERE id=?", (job_id,))


def retry_job(job_id: int) -> None:
    db.execute("UPDATE jobs SET status='queued', error=NULL, error_kind=NULL, finished_at=NULL WHERE id=?", (job_id,))


def reset_running() -> int:
    conn = db.connect()
    cur = conn.execute("UPDATE jobs SET status='queued' WHERE status='running'")
    conn.commit()
    return cur.rowcount


def _ready(job: dict) -> bool:
    for dep in json.loads(job["depends_on_json"] or "[]"):
        d = get_job(dep)
        if d and d["status"] not in TERMINAL:
            return False
    if job["type"] == "grade_section":
        sec = db.one("SELECT s.session_id, ses.question_id FROM sections s JOIN sessions ses ON ses.id=s.session_id "
                     "WHERE s.id=?", (job["ref_id"],))
        if sec and db.one("SELECT 1 FROM jobs WHERE type='research' AND ref_id=? AND status IN ('queued','running')",
                          (sec["question_id"],)):
            return False
    if job["type"] == "grade_session":
        pending = db.one(
            "SELECT 1 FROM jobs j JOIN sections s ON s.id=j.ref_id WHERE j.type='grade_section' AND s.session_id=? "
            "AND j.status NOT IN ('done','failed') "
            "AND j.id=(SELECT MAX(id) FROM jobs WHERE type='grade_section' AND ref_id=j.ref_id)", (job["ref_id"],))
        if pending:
            return False
    return True


def _claim(types: tuple[str, ...]) -> dict | None:
    types = tuple(t for t in types if t in HANDLERS)
    if not types:
        return None
    q = ",".join("?" * len(types))
    for job in db.rows(f"SELECT * FROM jobs WHERE status='queued' AND type IN ({q}) ORDER BY id", types):
        if _ready(job):
            db.execute("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?",
                       (time.time(), job["id"]))
            return get_job(job["id"])
    return None


async def _run(job: dict) -> None:
    try:
        await HANDLERS[job["type"]](job)
        db.execute("UPDATE jobs SET status='done', finished_at=?, error=NULL, error_kind=NULL WHERE id=?",
                   (time.time(), job["id"]))
    except JobError as e:
        _fail(job, e.kind, e.message)
    except Exception as e:  # noqa: BLE001
        log.exception("job %s crashed", job["id"])
        _fail(job, "other", f"{type(e).__name__}: {e}")


def _fail(job: dict, kind: str, message: str) -> None:
    now = time.time()
    if kind == "rate_limit":
        status = "pending_retry"
    elif job["attempts"] < 2 and job["type"] in CLAUDE_TYPES + TRANSCRIBE_TYPES:
        status = "queued"  # one automatic retry
    else:
        status = "failed"
    db.execute("UPDATE jobs SET status=?, error_kind=?, error=?, finished_at=? WHERE id=?",
               (status, kind, message[:2000], now, job["id"]))
    log.warning("job %s (%s) -> %s [%s] %s", job["id"], job["type"], status, kind, message[:200])


async def worker(name: str, types: tuple[str, ...], stop: asyncio.Event) -> None:
    while not stop.is_set():
        job = _claim(types)
        if job is None:
            await asyncio.sleep(0.5)
            continue
        await _run(job)


def start_workers(stop: asyncio.Event) -> list[asyncio.Task]:
    n = reset_running()
    if n:
        log.info("requeued %d running job(s) after restart", n)
    conc = int(config.get_setting(db.connect(), "claude_concurrency") or 1)
    tasks = [asyncio.create_task(worker("transcribe", TRANSCRIBE_TYPES, stop))]
    tasks += [asyncio.create_task(worker(f"claude{i}", CLAUDE_TYPES, stop)) for i in range(max(1, min(2, conc)))]
    return tasks
