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
