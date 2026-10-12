"""Aggregation for the Progress page and next-question suggestion."""
import json
import random

from . import config, db


def graded_sessions() -> list[dict]:
    """Sessions with a completed holistic grade (latest grade per session), oldest first."""
    out = []
    for s in db.rows("SELECT s.id, s.started_at, s.question_id, q.title FROM sessions s JOIN questions q ON q.id=s.question_id "
                     "ORDER BY s.started_at, s.id"):
        g = db.one("SELECT result_json, model FROM session_grades WHERE session_id=? AND status='done' ORDER BY id DESC LIMIT 1", (s["id"],))
        if g:
            s["grade"] = json.loads(g["result_json"])
            s["model"] = g["model"]
            out.append(s)
    return out


def _avg(xs):
    return sum(xs) / len(xs) if xs else None


def suggest() -> dict:
    qs = db.rows("SELECT id, title, stresses_json FROM questions")
    if not qs:
        raise ValueError("no questions")
    attempted = {r["question_id"] for r in db.rows("SELECT DISTINCT question_id FROM sessions")}
    last3 = graded_sessions()[-3:]
    pick, reason = None, None
    if last3:
        avg = {d: _avg([s["grade"]["dimension_scores"][d]["score"] for s in last3 if d in s["grade"]["dimension_scores"]])
               for d in config.DIMENSIONS}
        weakest = [d for d, _ in sorted(((d, v) for d, v in avg.items() if v is not None), key=lambda kv: kv[1])[:2]]
        pool = [q for q in qs if q["id"] not in attempted] or None
        note = ""
        if pool is None:  # everything attempted: fall back to the least recently attempted
            last = {r["question_id"]: r["t"] for r in db.rows("SELECT question_id, MAX(started_at) t FROM sessions GROUP BY question_id")}
            oldest = min(last.values())
            pool = [q for q in qs if last.get(q["id"]) == oldest]
            note = " (all questions attempted; picking the least recently practiced)"
        scored = [(len(set(json.loads(q["stresses_json"])) & set(weakest)), random.random(), q) for q in pool]
        scored.sort(key=lambda t: (-t[0], t[1]))
        pick = scored[0][2]
        overlap = scored[0][0]
        avg_txt = ", ".join(f"{d.replace('_', ' ')} {avg[d]:.1f}" for d in weakest)
        reason = (f"Your weakest dimensions over the last {len(last3)} graded session(s) are {avg_txt}; "
                  f"this question stresses {overlap} of them{note}.")
    else:
        fresh = [q for q in qs if q["id"] not in attempted] or qs
        pick = random.choice(fresh)
        reason = "No graded history yet, so this one is picked at random."
    return {"question_id": pick["id"], "title": pick["title"], "reason": reason}


def progress() -> dict:
    sessions = graded_sessions()
    timeline = [{"session_id": s["id"], "started_at": s["started_at"], "title": s["title"], "model": s["model"],
                 "overall_score": s["grade"]["overall_score"], "overall_level": s["grade"]["overall_level"],
                 "dimensions": {k: v["score"] for k, v in s["grade"]["dimension_scores"].items()}} for s in sessions]

    # time vs budget over the last 5 finished sessions
    recent_ids = [r["id"] for r in db.rows("SELECT id FROM sessions WHERE status='done' ORDER BY started_at DESC, id DESC LIMIT 5")]
    time_rows = []
    if recent_ids:
        ph = ",".join("?" * len(recent_ids))
        fw = {s["key"]: s for s in config.load_framework()}
        by_key = {r["key"]: r for r in db.rows(
            f"SELECT key, AVG(duration_sec) avg_used, AVG(budget_sec) budget, COUNT(*) n FROM sections WHERE session_id IN ({ph}) "
            f"AND duration_sec IS NOT NULL GROUP BY key", tuple(recent_ids))}
        for k in config.SECTION_KEYS:
            if k in by_key:
                time_rows.append({"key": k, "title": fw.get(k, {}).get("title", k), "avg_used": by_key[k]["avg_used"],
                                  "budget": by_key[k]["budget"], "n": by_key[k]["n"]})

    # recurring gaps: sessions in which the tag appears (current grades only; gaps are rebuilt on re-grade)
    last5 = {r["id"] for r in db.rows("SELECT id FROM sessions WHERE status='done' ORDER BY started_at DESC, id DESC LIMIT 5")}
    gaps: dict[str, dict] = {}
    for r in db.rows("SELECT g.tag, g.session_id, s.started_at FROM gaps g JOIN sessions s ON s.id=g.session_id WHERE s.status='done'"):
        e = gaps.setdefault(r["tag"], {"tag": r["tag"], "sessions": set(), "recent": set(), "last_seen": 0})
        e["sessions"].add(r["session_id"])
        if r["session_id"] in last5:
            e["recent"].add(r["session_id"])
        e["last_seen"] = max(e["last_seen"], r["started_at"])
    gap_rows = sorted(({"tag": e["tag"], "count": len(e["sessions"]), "last5": len(e["recent"]), "last_seen": e["last_seen"]}
                       for e in gaps.values()), key=lambda x: (-x["count"], -x["last5"], x["tag"]))

    latest = sessions[-1]["grade"] if sessions else None
    focus = {"drill": latest["drill_for_next_session"] if latest else None,
             "session_id": sessions[-1]["id"] if sessions else None,
             "suggested": suggest()}
    study = db.rows("SELECT * FROM study_items ORDER BY CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END, id DESC")
    return {"timeline": timeline, "dimensions": config.DIMENSIONS, "time_vs_budget": time_rows, "gaps": gap_rows,
            "focus": focus, "study_items": study}


# ---- LLM usage ledger ---------------------------------------------------------

_SUM = ("COUNT(*) calls, SUM(ok) ok_calls, COALESCE(SUM(input_tokens),0) input_tokens, COALESCE(SUM(output_tokens),0) output_tokens, "
        "COALESCE(SUM(cache_read_tokens),0) cache_read_tokens, COALESCE(SUM(cache_creation_tokens),0) cache_creation_tokens, "
        "COALESCE(SUM(web_searches),0) web_searches, COALESCE(SUM(web_fetches),0) web_fetches, "
        "COALESCE(SUM(cost_usd),0) cost_usd, COALESCE(SUM(duration_s),0) duration_s")


def _with_total(row: dict) -> dict:
    row["ok_calls"] = row.get("ok_calls") or 0
    row["total_tokens"] = (row["input_tokens"] + row["output_tokens"] + row["cache_read_tokens"] + row["cache_creation_tokens"])
    return row


def _call_cost(model: str | None, rows: list[dict] | None = None, raw: str | None = None) -> dict | None:
    """Model + cost for one task, from its ledger rows (all attempts) or, for older data, the stored raw response."""
    if rows:
        agg = _with_total({"input_tokens": sum(r["input_tokens"] for r in rows), "output_tokens": sum(r["output_tokens"] for r in rows),
                           "cache_read_tokens": sum(r["cache_read_tokens"] for r in rows),
                           "cache_creation_tokens": sum(r["cache_creation_tokens"] for r in rows)})
        cost, dur, calls = sum(r["cost_usd"] for r in rows), sum(r["duration_s"] or 0 for r in rows), len(rows)
    elif raw:
        try:
            f = db.usage_fields(json.loads(raw))
        except (TypeError, ValueError):
            return None
        agg = _with_total({k: f[k] for k in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens")})
        cost, dur, calls = f["cost_usd"], None, 1
    else:
        return None
    # non-Claude providers (OpenRouter, Groq) report no price: cost_usd is then 0 and shown as "not reported"
    return {"model": model, "cost_usd": cost, "reported": cost > 0, "total_tokens": agg["total_tokens"], "duration_s": dur, "calls": calls}


def section_costs(section_id: int, grade_model: str | None, grade_raw: str | None) -> dict:
    g = db.rows("SELECT * FROM llm_calls WHERE section_id=? AND kind='grade_section'", (section_id,))
    p = db.rows("SELECT * FROM llm_calls WHERE section_id=? AND kind='probe'", (section_id,))
    probe_model = db.one("SELECT model FROM probes WHERE section_id=?", (section_id,))
    return {"grade": _call_cost(grade_model, g, grade_raw) if (g or grade_raw) else None,
            "probe": _call_cost(probe_model["model"] if probe_model else None, p) if p else None}


def session_costs(session_id: int, question_id: int, overall_model: str | None, overall_raw: str | None) -> dict:
    o = db.rows("SELECT * FROM llm_calls WHERE session_id=? AND kind='grade_session' ORDER BY id DESC LIMIT 1", (session_id,))
    rs = db.one("SELECT model, created_at FROM research WHERE question_id=? AND status='done' ORDER BY id DESC LIMIT 1", (question_id,))
    key = None
    if rs:
        rows = db.rows("SELECT * FROM llm_calls WHERE kind='research' AND question_id=? AND ok=1 AND created_at<=? ORDER BY id DESC LIMIT 1",
                       (question_id, rs["created_at"] + 5))
        key = _call_cost(rs["model"], rows) if rows else {"model": rs["model"], "cost_usd": 0, "reported": False, "total_tokens": 0, "duration_s": None, "calls": 0}
    return {"overall": _call_cost(overall_model, o, overall_raw) if (o or overall_raw) else None, "answer_key": key}


def session_usage(session_id: int) -> dict:
    return _with_total(db.one(f"SELECT {_SUM} FROM llm_calls WHERE session_id=?", (session_id,)))


def usage() -> dict:
    total = _with_total(db.one(f"SELECT {_SUM} FROM llm_calls"))
    by_kind = [_with_total(r) for r in db.rows(f"SELECT kind, {_SUM} FROM llm_calls GROUP BY kind ORDER BY cost_usd DESC")]
    by_model = [_with_total(r) for r in db.rows(f"SELECT COALESCE(model,'?') model, {_SUM} FROM llm_calls GROUP BY model ORDER BY cost_usd DESC")]
    by_day = [_with_total(r) for r in db.rows(
        f"SELECT date(created_at,'unixepoch','localtime') day, {_SUM} FROM llm_calls GROUP BY day ORDER BY day DESC LIMIT 30")][::-1]
    by_session = [_with_total(r) for r in db.rows(
        f"SELECT c.session_id, q.title, MIN(c.created_at) started, {_SUM} FROM llm_calls c JOIN sessions s ON s.id=c.session_id "
        "JOIN questions q ON q.id=s.question_id GROUP BY c.session_id ORDER BY c.session_id DESC LIMIT 20")]
    recent = db.rows("SELECT c.*, q.title FROM llm_calls c LEFT JOIN questions q ON q.id=c.question_id ORDER BY c.id DESC LIMIT 40")
    first = db.one("SELECT MIN(created_at) t FROM llm_calls")
    return {"total": total, "by_kind": by_kind, "by_model": by_model, "by_day": by_day, "by_session": by_session,
            "recent": recent, "tracking_since": first["t"] if first else None}


def plan_usage() -> dict:
    """Latest plan-limit snapshot reported by the CLI, plus a short history."""
    latest = db.one("SELECT * FROM plan_usage ORDER BY id DESC LIMIT 1")
    hist = db.rows("SELECT created_at, five_hour_util, seven_day_util FROM plan_usage ORDER BY id DESC LIMIT 60")[::-1]
    if latest:
        latest.pop("raw_json", None)
    return {"latest": latest, "history": hist}
