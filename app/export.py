"""Session -> markdown."""
from datetime import datetime

from . import config
from . import diagram as diagram_mod

LEVELS = {"below_senior": "Below senior", "senior": "Senior", "staff": "Staff", "senior_staff_plus": "Senior staff+"}
SIGNALS = {"strong_no": "Strong no", "lean_no": "Lean no", "lean_hire": "Lean hire", "strong_hire": "Strong hire"}


def _mmss(s) -> str:
    s = int(round(s or 0))
    return f"{s // 60}:{s % 60:02d}"


def session_markdown(p: dict) -> str:
    q, ses = p["question"], p["session"]
    g, gm = p["grade"], p["grade_meta"]
    when = datetime.fromtimestamp(ses["started_at"]).strftime("%Y-%m-%d %H:%M")
    L = [f"# {q['title']} — session {ses['id']}", "", f"*{when} · model: {(gm or {}).get('model') or ses['model']}*", "",
         f"> {q['prompt']}", ""]
    if g:
        L += [f"## Overall: {LEVELS[g['overall_level']]} ({g['overall_score']}/4) — {SIGNALS[g['hire_signal_at_staff']]} at staff", "",
              g["verdict"], "", "### Dimension scores", "", "| Dimension | Score | Rationale |", "|---|---|---|"]
        for k, d in g["dimension_scores"].items():
            L.append(f"| {k.replace('_', ' ')} | {d['score']} | {d['rationale'].replace('|', '/')} |")
        L += ["", "### Strengths"] + [f"- {x}" for x in g["strengths"]]
        if g["improvements_vs_previous"]:
            L += ["", "### Improvements vs previous"] + [f"- {x}" for x in g["improvements_vs_previous"]]
        if g["recurring_patterns_vs_previous"]:
            L += ["", "### Recurring patterns"] + [f"- {x}" for x in g["recurring_patterns_vs_previous"]]
        L += ["", "### Study plan"] + [f"{i}. **{x['concept']}** — {x['why']} ({x['resource']})" for i, x in enumerate(p.get("study_plan") or [], 1)]
        L += ["", "### Drill for next session", "", g["drill_for_next_session"], ""]
        f = g.get("interview_focus")
        if f:
            L += ["### What to explain in the hour", "", f["shape"], ""]
            L += [f"{i}. **{x['topic']}** (~{round(x['minutes'])} min) — {x['explain']}" for i, x in enumerate(f["priorities"], 1)]
            if f["can_skip"]:
                L += ["", "Can skip or say in one line:"] + [f"- {x}" for x in f["can_skip"]]
            L.append("")
    else:
        L += ["*Holistic grade not available yet.*", ""]
    costs = []
    def _row(label, c):
        if c:
            money = "not reported" if not c["reported"] else f"≈${c['cost_usd']:.3f}"
            costs.append(f"| {label} | {c['model'] or '?'} | {c['total_tokens']:,} | {money} |")
    _row("Answer key", (p.get("costs") or {}).get("answer_key"))
    for s in p["sections"]:
        _row(f"{s['ord']}. {s['title']}", (s.get("cost") or {}).get("grade"))
        _row(f"{s['ord']}. {s['title']}: probe question", (s.get("cost") or {}).get("probe"))
    _row("Overall grade", (p.get("costs") or {}).get("overall"))
    if costs:
        L += ["## Models and cost", "", "| Task | Model | Tokens | Cost |", "|---|---|---|---|"] + costs + [""]
    L += ["## Sections", ""]
    for s in p["sections"]:
        L += [f"### {s['ord']}. {s['title']}", "", f"Time: {_mmss(s['duration_sec'])} of {_mmss(s['budget_sec'])} budget", ""]
        pr = s.get("probe")
        if pr and pr.get("question"):
            L += ["**Interviewer probe** — " + pr["question"], f"Nudge: {pr.get('hint') or ''}", f"Your answer: {pr.get('answer') or '(no answer)'}", ""]
        sg = s["grade"]
        if sg:
            L += [f"**Score {sg['score']} ({LEVELS[sg['level_signal']]})** — {sg['summary']}", ""]
            if sg.get("gap_summary"):
                L += ["**Gaps**", "", sg["gap_summary"], ""]
            elif sg.get("gaps"):  # grade written before gaps became a summary
                L += ["**Gaps**"] + [f"- `{x['tag']}` ({x['severity']}) — {x['description']}" for x in sg["gaps"]] + [""]
            lr = sg.get("language_review")
            if lr:
                L += [f"**Wording and terminology ({lr['register'].replace('_', ' ')})** — {lr['assessment']}", ""]
                L += [f"- You said: \"{x['said']}\" — {x['problem']} Staff phrasing: {x['better']}" for x in lr["issues"]] + [""] if lr["issues"] else []
            if sg.get("concepts_writeup"):
                L += ["**What to learn**", "", sg["concepts_writeup"], ""]
            if sg.get("fact_checks"):
                L += ["**Fact checks**"] + [f"- {f['verdict']}: {f['claim']} — {f['explanation']}" + (f" ({f['url']})" if f.get("url") else "")
                                           for f in sg["fact_checks"]] + [""]
        if s.get("diagram") and not diagram_mod.is_empty(s["diagram"]):
            L += ["<details><summary>Diagram as saved</summary>", "", "```", diagram_mod.render_text(s["diagram"]), "```", "", "</details>", ""]
        L += ["<details><summary>Transcript</summary>", "", s["transcript_edited"] or "(empty)", "", "</details>", ""]
    srcs = {}
    for src in (g["sources"] if g else []) + [x for s in p["sections"] if s["grade"] for x in s["grade"]["sources"]]:
        srcs[src["url"]] = src["title"]
    if srcs:
        L += ["## Sources"] + [f"- [{t}]({u})" for u, t in srcs.items()]
    return "\n".join(L) + "\n"


def write_export(p: dict) -> tuple[str, str]:
    md = session_markdown(p)
    config.EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = config.EXPORT_DIR / f"{p['session']['id']}.md"
    path.write_text(md, encoding="utf-8")
    return str(path), md
