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


MIGRATIONS.append("""
    CREATE TABLE llm_calls(
        id INTEGER PRIMARY KEY, created_at REAL NOT NULL, kind TEXT NOT NULL, model TEXT,
        session_id INTEGER, question_id INTEGER, ok INTEGER NOT NULL, error_kind TEXT, duration_s REAL,
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        web_searches INTEGER NOT NULL DEFAULT 0, web_fetches INTEGER NOT NULL DEFAULT 0,
        num_turns INTEGER, cost_usd REAL NOT NULL DEFAULT 0);
    CREATE INDEX idx_llm_calls_session ON llm_calls(session_id);
    CREATE INDEX idx_llm_calls_created ON llm_calls(created_at);
""")


MIGRATIONS.append("""
    CREATE TABLE plan_usage(
        id INTEGER PRIMARY KEY, created_at REAL NOT NULL, status TEXT,
        five_hour_util REAL, five_hour_resets REAL, seven_day_util REAL, seven_day_resets REAL, raw_json TEXT);
""")


MIGRATIONS.append("""
    ALTER TABLE sessions ADD COLUMN diagram_json TEXT;
    ALTER TABLE sections ADD COLUMN diagram_json TEXT;
""")
MIGRATIONS.append("""
    ALTER TABLE llm_calls ADD COLUMN section_id INTEGER;
    CREATE INDEX idx_llm_calls_section ON llm_calls(section_id);
""")
MIGRATIONS.append("""
    CREATE TABLE probes(
        id INTEGER PRIMARY KEY, section_id INTEGER NOT NULL UNIQUE REFERENCES sections(id) ON DELETE CASCADE,
        question TEXT, hint TEXT, answer TEXT, model TEXT, created_at REAL NOT NULL, answered_at REAL);
""")

MIGRATIONS.append("""
    CREATE TABLE improvement_reports(
        id INTEGER PRIMARY KEY, k INTEGER NOT NULL, session_ids_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
        result_json TEXT, model TEXT, created_at REAL NOT NULL);
""")

MIGRATIONS.append("""
    ALTER TABLE improvement_reports ADD COLUMN requested_model TEXT;
""")



def record_plan_usage(info: dict) -> None:
    """Store a plan-limit snapshot from the CLI's rate_limit_event (utilization is a 0-1 fraction)."""
    w = info.get("unifiedWindows") or {}
    five, seven = w.get("five_hour") or {}, w.get("seven_day") or {}
    if not five and not seven:
        return
    conn = connect()
    conn.execute("INSERT INTO plan_usage(created_at,status,five_hour_util,five_hour_resets,seven_day_util,seven_day_resets,raw_json) "
                 "VALUES(?,?,?,?,?,?,?)", (time.time(), info.get("status"), five.get("utilization"), five.get("resetsAt"),
                                          seven.get("utilization"), seven.get("resetsAt"), json.dumps(info)))
    conn.commit()


def usage_fields(data) -> dict:
    """Token/cost numbers from a `claude -p --output-format json` result (zeros when absent)."""
    d = data if isinstance(data, dict) else {}
    u = d.get("usage") or {}
    tool = u.get("server_tool_use") or {}
    return {"input_tokens": u.get("input_tokens", 0) or 0, "output_tokens": u.get("output_tokens", 0) or 0,
            "cache_read_tokens": u.get("cache_read_input_tokens", 0) or 0,
            "cache_creation_tokens": u.get("cache_creation_input_tokens", 0) or 0,
            "web_searches": tool.get("web_search_requests", 0) or 0, "web_fetches": tool.get("web_fetch_requests", 0) or 0,
            "num_turns": d.get("num_turns"), "cost_usd": d.get("total_cost_usd", 0) or 0}


def record_call(kind: str, model: str | None, ok: bool, error_kind, duration_s: float, raw, session_id=None,
                question_id=None, created_at: float | None = None, section_id=None) -> None:
    f = usage_fields(raw)
    conn = connect()
    conn.execute("INSERT INTO llm_calls(created_at,kind,model,session_id,question_id,ok,error_kind,duration_s,input_tokens,"
                 "output_tokens,cache_read_tokens,cache_creation_tokens,web_searches,web_fetches,num_turns,cost_usd,section_id) "
                 "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                 (created_at or time.time(), kind, model, session_id, question_id, int(ok), error_kind, duration_s,
                  f["input_tokens"], f["output_tokens"], f["cache_read_tokens"], f["cache_creation_tokens"],
                  f["web_searches"], f["web_fetches"], f["num_turns"], f["cost_usd"], section_id))
    conn.commit()


def _backfill_llm_calls(conn) -> None:
    """Seed the ledger from raw responses already stored with grades (research raw was never stored)."""
    for table, kind, join in (("section_grades", "grade_section", "JOIN sections s ON s.id=g.section_id"),
                              ("session_grades", "grade_session", "")):
        sid = "s.session_id" if join else "g.session_id"
        for r in conn.execute(f"SELECT g.model, g.raw_response, g.duration_s, g.created_at, {sid} AS sid, "
                              f"(SELECT question_id FROM sessions WHERE id={sid}) AS qid FROM {table} g {join} WHERE g.status='done'"):
            try:
                raw = json.loads(r["raw_response"])
            except (TypeError, ValueError):
                raw = {}
            f = usage_fields(raw)
            conn.execute("INSERT INTO llm_calls(created_at,kind,model,session_id,question_id,ok,duration_s,input_tokens,output_tokens,"
                         "cache_read_tokens,cache_creation_tokens,web_searches,web_fetches,num_turns,cost_usd) VALUES(?,?,?,?,?,1,?,?,?,?,?,?,?,?,?)",
                         (r["created_at"], kind, r["model"], r["sid"], r["qid"], r["duration_s"], f["input_tokens"], f["output_tokens"],
                          f["cache_read_tokens"], f["cache_creation_tokens"], f["web_searches"], f["web_fetches"], f["num_turns"], f["cost_usd"]))


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
        if i == 1:
            _backfill_llm_calls(conn)
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


MIGRATIONS.append("""
    CREATE TABLE kg_articles(
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
        model TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL);
    CREATE UNIQUE INDEX kg_title ON kg_articles(lower(title));
    CREATE TABLE kg_links(
        src INTEGER NOT NULL REFERENCES kg_articles(id) ON DELETE CASCADE,
        dst INTEGER NOT NULL REFERENCES kg_articles(id) ON DELETE CASCADE,
        PRIMARY KEY(src, dst));
""")


MIGRATIONS.append("""
    CREATE TABLE kg_article_questions(
        article_id INTEGER NOT NULL REFERENCES kg_articles(id) ON DELETE CASCADE,
        question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        PRIMARY KEY(article_id, question_id));
""")


MIGRATIONS.append("""
    DROP TABLE kg_links;
    ALTER TABLE kg_articles RENAME TO articles;
    ALTER TABLE kg_article_questions RENAME TO article_questions;
""")


MIGRATIONS.append("""
    DROP TABLE IF EXISTS study_items;
    ALTER TABLE articles ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE articles ADD COLUMN rating INTEGER;
""")


MIGRATIONS.append("""
    CREATE TABLE article_comments(
        id INTEGER PRIMARY KEY, article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        question TEXT, body TEXT NOT NULL, model TEXT, created_at REAL NOT NULL);
    CREATE INDEX idx_article_comments ON article_comments(article_id);
""")


MIGRATIONS.append("""
    CREATE TABLE problems(
        id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, num INTEGER, title TEXT NOT NULL, phase INTEGER NOT NULL, ord INTEGER NOT NULL,
        track TEXT NOT NULL, difficulty TEXT, premium INTEGER NOT NULL DEFAULT 0, tags_json TEXT NOT NULL DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '', is_build INTEGER NOT NULL DEFAULT 0, levels_json TEXT, created_at REAL NOT NULL);
    CREATE TABLE problem_specs(
        id INTEGER PRIMARY KEY, problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        status TEXT NOT NULL, spec_json TEXT NOT NULL, secrets_json TEXT NOT NULL, cases_json TEXT NOT NULL, report_json TEXT,
        model TEXT, created_at REAL NOT NULL);
    CREATE INDEX idx_problem_specs ON problem_specs(problem_id, id);
    CREATE TABLE attempts(
        id INTEGER PRIMARY KEY, problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE, spec_id INTEGER,
        code TEXT NOT NULL DEFAULT '', level INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'in_progress',
        hints_used INTEGER NOT NULL DEFAULT 0, solution_viewed INTEGER NOT NULL DEFAULT 0, explanation TEXT NOT NULL DEFAULT '',
        started_at REAL NOT NULL, finished_at REAL, active_sec REAL NOT NULL DEFAULT 0);
    CREATE INDEX idx_attempts_problem ON attempts(problem_id);
    CREATE TABLE runs(
        id INTEGER PRIMARY KEY, attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE, kind TEXT NOT NULL,
        status TEXT NOT NULL, passed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1,
        result_json TEXT, code TEXT, duration_ms INTEGER, created_at REAL NOT NULL);
    CREATE INDEX idx_runs_attempt ON runs(attempt_id);
    CREATE TABLE code_hints(
        id INTEGER PRIMARY KEY, attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE, question TEXT,
        status TEXT NOT NULL DEFAULT 'queued', text TEXT, model TEXT, created_at REAL NOT NULL);
    CREATE TABLE code_reviews(
        id INTEGER PRIMARY KEY, attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE, run_id INTEGER,
        status TEXT NOT NULL DEFAULT 'queued', code TEXT, explanation TEXT, result_json TEXT, model TEXT, requested_model TEXT,
        created_at REAL NOT NULL);
    CREATE INDEX idx_code_reviews_attempt ON code_reviews(attempt_id);
    CREATE TABLE code_gaps(
        id INTEGER PRIMARY KEY, review_id INTEGER NOT NULL REFERENCES code_reviews(id) ON DELETE CASCADE, problem_id INTEGER NOT NULL,
        tag TEXT NOT NULL, description TEXT, severity TEXT);
    CREATE INDEX idx_code_gaps_tag ON code_gaps(tag);
""")


MIGRATIONS.append("""
    CREATE TABLE problem_briefs(
        problem_id INTEGER PRIMARY KEY REFERENCES problems(id) ON DELETE CASCADE, brief_json TEXT NOT NULL, model TEXT, created_at REAL NOT NULL);
""")


MIGRATIONS.append("""
    ALTER TABLE attempts ADD COLUMN updated_at REAL;
""")


def sync_problems() -> None:
    """Upsert the coding roadmap from config/problems.yaml by slug: 160 problems plus the multi-level builds."""
    data = config.load_problems_yaml()
    conn = connect()
    now = time.time()
    order = 0
    phases = {p["num"]: p for p in data["phases"]}
    for p in data["problems"]:
        order += 1
        conn.execute(
            """INSERT INTO problems(slug,num,title,phase,ord,track,difficulty,premium,tags_json,note,is_build,created_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,0,?)
               ON CONFLICT(slug) DO UPDATE SET num=excluded.num, title=excluded.title, phase=excluded.phase, ord=excluded.ord,
                 track=excluded.track, difficulty=excluded.difficulty, premium=excluded.premium, tags_json=excluded.tags_json, note=excluded.note""",
            (p["slug"], p.get("num"), p["title"], p["phase"], order, phases[p["phase"]]["track"], p.get("difficulty"),
             int(bool(p.get("premium"))), json.dumps(p.get("tags", [])), p.get("note", ""), now))
    phase = max(phases) + 1  # builds follow the last phase
    for b in data.get("progressions", []):
        order += 1
        conn.execute(
            """INSERT INTO problems(slug,num,title,phase,ord,track,difficulty,premium,tags_json,note,is_build,levels_json,created_at)
               VALUES(?,NULL,?,?,?,'practical','Build',0,'[]',?,1,?,?)
               ON CONFLICT(slug) DO UPDATE SET title=excluded.title, ord=excluded.ord, note=excluded.note, levels_json=excluded.levels_json""",
            (b["slug"], b["title"], phase, order, f"{b['base']}. {b['time']}.", json.dumps(b["levels"]), now))
    conn.commit()
