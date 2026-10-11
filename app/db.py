"""SQLite schema, migrations (PRAGMA user_version) and shared helpers."""
import json
import sqlite3
import threading
import time

from . import config

_local = threading.local()

MIGRATIONS = [
    # v1: initial schema
    """
    CREATE TABLE questions(
        id INTEGER PRIMARY KEY, slug TEXT UNIQUE, title TEXT NOT NULL, prompt TEXT NOT NULL,
        stresses_json TEXT NOT NULL DEFAULT '[]', crux_hints TEXT NOT NULL DEFAULT '',
        is_custom INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL);
    CREATE TABLE research(
        id INTEGER PRIMARY KEY, question_id INTEGER NOT NULL REFERENCES questions(id),
        status TEXT NOT NULL, brief_json TEXT, brief_md TEXT, model TEXT, grounding_warning TEXT,
        created_at REAL NOT NULL);
    CREATE TABLE sessions(
        id INTEGER PRIMARY KEY, question_id INTEGER NOT NULL REFERENCES questions(id),
        status TEXT NOT NULL DEFAULT 'in_progress', model TEXT, started_at REAL NOT NULL,
        finished_at REAL, show_feedback_live INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sections(
        id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        key TEXT NOT NULL, ord INTEGER NOT NULL, audio_path TEXT, wav_path TEXT, duration_sec REAL,
        budget_sec INTEGER NOT NULL, transcript_raw TEXT, transcript_edited TEXT, segments_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending', UNIQUE(session_id, key));
    CREATE TABLE section_grades(
        id INTEGER PRIMARY KEY, section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        model TEXT, status TEXT NOT NULL, result_json TEXT, raw_response TEXT, duration_s REAL,
        created_at REAL NOT NULL);
    CREATE TABLE session_grades(
        id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        model TEXT, status TEXT NOT NULL, result_json TEXT, raw_response TEXT, duration_s REAL,
        created_at REAL NOT NULL);
    CREATE TABLE gaps(
        id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        section_key TEXT, tag TEXT NOT NULL, description TEXT, severity TEXT, source TEXT NOT NULL);
    CREATE TABLE study_items(
        id INTEGER PRIMARY KEY, concept TEXT NOT NULL, why TEXT, resource TEXT,
        source_session_id INTEGER, status TEXT NOT NULL DEFAULT 'todo', created_at REAL NOT NULL);
    CREATE UNIQUE INDEX study_concept ON study_items(lower(concept));
    CREATE TABLE jobs(
        id INTEGER PRIMARY KEY, type TEXT NOT NULL, ref_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
        depends_on_json TEXT NOT NULL DEFAULT '[]', attempts INTEGER NOT NULL DEFAULT 0, error_kind TEXT, error TEXT,
        created_at REAL NOT NULL, started_at REAL, finished_at REAL);
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE INDEX idx_jobs_status ON jobs(status, type);
    CREATE INDEX idx_sections_session ON sections(session_id);
    CREATE INDEX idx_gaps_tag ON gaps(tag);
    """,
]


def connect() -> sqlite3.Connection:
    """One connection per thread."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(config.DB_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return conn


def migrate() -> int:
    conn = connect()
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    for i in range(version, len(MIGRATIONS)):
        conn.executescript(MIGRATIONS[i])
        conn.execute(f"PRAGMA user_version={i + 1}")
        conn.commit()
    return conn.execute("PRAGMA user_version").fetchone()[0]


def sync_questions() -> None:
    """Upsert questions from config/questions.yaml by slug. Custom questions are untouched."""
    conn = connect()
    for q in config.load_questions_yaml():
        conn.execute(
            """INSERT INTO questions(slug,title,prompt,stresses_json,crux_hints,is_custom,created_at)
               VALUES(?,?,?,?,?,0,?)
               ON CONFLICT(slug) DO UPDATE SET title=excluded.title, prompt=excluded.prompt,
                 stresses_json=excluded.stresses_json, crux_hints=excluded.crux_hints""",
            (q["slug"], q["title"], q["prompt"], json.dumps(q.get("stresses", [])),
             "\n".join(q.get("crux_hints", [])), time.time()))
    conn.commit()


def rows(sql: str, args: tuple = ()) -> list[dict]:
    return [dict(r) for r in connect().execute(sql, args).fetchall()]


def one(sql: str, args: tuple = ()) -> dict | None:
    r = connect().execute(sql, args).fetchone()
    return dict(r) if r else None


def execute(sql: str, args: tuple = ()) -> int:
    conn = connect()
    cur = conn.execute(sql, args)
    conn.commit()
    return cur.lastrowid
