"""Builds the stdin payloads (plain text with XML-style tags) for each Claude call type."""
import json

from . import config
from . import diagram as diagram_mod


def _fmt_framework(framework: list[dict]) -> str:
    return "\n".join(f"- {s['key']} ({s['title']}): {' '.join(str(s['staff_bar']).split())}" for s in framework)


def _fmt_question(q: dict) -> str:
    return f"{q['title']}\n{q['prompt']}"


def _hints(q: dict) -> str:
    return q.get("crux_hints") or "(none provided)"


def stable_context(question: dict, brief: dict | None, gap_tags: dict | None = None) -> str:
    """The per-question text that is identical across every call about it (question, hints, brief, tags).
    It goes at the end of the system prompt, not the stdin payload: the CLI caches the system prompt as its own block,
    so the ~20k-token brief is read from the cache (about a tenth of the price) by every later call within the TTL."""
    brief_txt = json.dumps(brief, indent=1) if brief else \
        "NONE: grade from general knowledge and state that grading was ungrounded"
    out = (f"<question>\n{_fmt_question(question)}\n</question>\n\n"
           f"<crux_hints>\n{_hints(question)}\n</crux_hints>\n\n"
           f"<reference_brief>\n{brief_txt}\n</reference_brief>")
    if gap_tags:
        tags = "\n".join(f"- {t}: {d}" for t, d in gap_tags["tags"].items())
        out += f"\n\n<gap_tags>\nUse these tags (or other.<short_slug> if none fits):\n{tags}\n</gap_tags>"
    return out


def research(question: dict, framework: list[dict]) -> str:
    return (
        f"<question>\n{_fmt_question(question)}\n</question>\n\n"
        f"<crux_hints>\n{_hints(question)}\n</crux_hints>\n\n"
        f"<framework>\n{_fmt_framework(framework)}\n</framework>\n\n"
        "<task>\nProduce the reference brief for this question per the output schema. Use web search and fetch the "
        "pages you rely on. Include at least 5 distinct sources with at least 3 primary. Fill "
        "staff_level_answer_outline with one string per framework section key.\n</task>"
    )


def _diagram_block(diagram: dict | None, key: str | None, note: str) -> tuple[str, str]:
    """(<diagram> block, task suffix). Only sections where a drawing is expected get one: the diagram is repeated in every
    call that carries it, so it is not sent to the others."""
    if key not in diagram_mod.DIAGRAM_SECTIONS:
        return "", ""
    if diagram_mod.is_empty(diagram):
        return "<diagram>\n(no diagram drawn)\n</diagram>\n\n", " " + diagram_mod.PROMPT_RULES
    return f"<diagram>\n{note}\n{diagram_mod.render_text(diagram)}\n</diagram>\n\n", " " + diagram_mod.PROMPT_RULES


PROBE_RULES = ("Some sections end with a PROMPTED FOLLOW-UP: an interviewer probe the candidate asked for, the hint that came with it, "
               "and the candidate's single typed answer. Ideas the candidate only produced after the probe or hint were prompted: give them "
               "less credit than the same idea raised unprompted, and never let a good follow-up answer raise the score for a gap in the "
               "original section. Do credit how well they reasoned and recovered under the probe.")


THIS_PROBE_RULES = ("This section was probed. After the transcript you get the interviewer's probe, the hint that came with it, and the candidate's "
                    "single answer. Grade the section ONCE, on the initial answer and the answer after the probe together, judging only this "
                    "section. Score as a staff interviewer would: credit what the candidate said unprompted in full; ideas they only reached "
                    "after the probe or hint earn partial credit, and needing the hint lowers the final score (more so the more basic the "
                    "missing idea and the more the hint gave away). A strong follow-up answer shows depth, but it does not erase a gap in "
                    "the initial answer. In the summary, say plainly how the probe and the hint affected the score.")


def probe_text(p: dict | None) -> str:
    if not p or not p.get("question"):
        return ""
    ans = (p.get("answer") or "").strip() or "(no answer)"
    return (f"\n\n[PROMPTED FOLLOW-UP] Interviewer probe: {p['question']}\nHint given: {p.get('hint') or '(none)'}\n"
            f"Candidate's answer: {ans}")


SPOKEN_TASK = (" This session is interactive: the candidate will hear the feedback read aloud, so also fill in spoken_feedback. Keep it brief, "
               "conversational and easy to follow by ear.")


def section(fw_section: dict, anchors: str, earlier: list[dict] | None, this: dict, diagram: dict | None = None, this_probe: dict | None = None,
            spoken: bool = False) -> str:
    if earlier is None:  # a probed section is judged on its own
        earlier = []
        earlier_txt = "(not provided: judge this section on its own)"
    else:
        earlier_txt = "\n\n".join(f"## {e['title']}\n{e['text']}{probe_text(e.get('probe'))}" for e in earlier) or "(this is the first section)"
    used = this.get("duration_sec")
    time_txt = f"{round(used)}s used of {this['budget_sec']}s budget" if used else f"unknown time used; budget {this['budget_sec']}s"
    dblock, dtask = _diagram_block(diagram, fw_section["key"], "The canvas as it stood when the candidate saved this section.")
    return (
        f"<framework_section>\nkey: {fw_section['key']}\ntitle: {fw_section['title']}\n"
        f"cover: {'; '.join(fw_section['cover'])}\nstaff_bar: {' '.join(str(fw_section['staff_bar']).split())}\n</framework_section>\n\n"
        f"<rubric_anchors>\n{anchors}\n</rubric_anchors>\n\n"
        f"<earlier_sections>\n{earlier_txt}\n</earlier_sections>\n\n"
        f"<this_section>\ntitle: {this['title']}\ntime: {time_txt}\ntranscript:\n{this['text'] or '(empty)'}{probe_text(this_probe)}\n</this_section>\n\n"
        + dblock +
        "<task>\nGrade this section against the rubric anchors and the reference brief. Fact-check as instructed. Also fill in language_review: judge the wording and terminology of this section as a staff engineer would hear it."
        + (SPOKEN_TASK if spoken else "")
        + (" " + THIS_PROBE_RULES if this_probe else "")
        + (" " + PROBE_RULES if any(e.get("probe") for e in earlier) else "")
        + dtask + " Return the structured output only.\n</task>"
    )


def _grade_digest(g: dict | None) -> str:
    """The part of a section grade the overall grader needs. The long write-ups, quotes and fact checks stay out."""
    if not g:
        return "(not graded)"
    keep = {"score": g["score"], "summary": g["summary"], "gap_summary": g.get("gap_summary"),
            "gaps": [{"tag": x["tag"], "severity": x["severity"], "description": x["description"]} for x in g.get("gaps", [])]}
    return json.dumps({k: v for k, v in keep.items() if v})


def holistic(sections: list[dict], previous: list[dict]) -> str:
    parts = []
    for s in sections:
        used = f"{round(s['duration_sec'])}s used of {s['budget_sec']}s" if s.get("duration_sec") else f"time unknown; budget {s['budget_sec']}s"
        parts.append(f"## {s['title']} ({used})\ntranscript:\n{s['text'] or '(empty)'}{probe_text(s.get('probe'))}\n"
                     f"section grade:\n{_grade_digest(s['grade'])}")
    prev = json.dumps(previous, indent=1) if previous else "(no previous sessions)"
    return (
        f"<rubric_dimensions>\n{config.rubric_dimensions()}\n</rubric_dimensions>\n\n"
        f"<sections>\n{chr(10).join(parts)}\n</sections>\n\n"
        f"<previous_sessions>\n{prev}\n</previous_sessions>\n\n"
        "<task>\nGive the holistic grade for the whole session: overall level, all 10 dimension scores (1-4), ONE concrete drill "
        "for next session, and the interview focus: what to explain in a real one-hour interview on this question, in priority "
        "order. The section grades already took any diagram into account. Compare to previous sessions when provided. "
        "time_management must be judged from the actual time used vs budget per section. "
        "Return the structured output only." + (" " + PROBE_RULES if any(x.get("probe") for x in sections) else "") + "\n</task>"
    )


def probe(fw_section: dict, earlier: list[dict], window: list[dict], diagram: dict | None = None) -> str:
    """`earlier`/`window`: dicts with title, text, optional probe. The window is what the probe is about."""
    def clip(t: str, n: int) -> str:
        t = (t or "").strip() or "(empty)"
        return t if len(t) <= n else t[:n] + " [...]"
    earlier_txt = "\n\n".join(f"## {e['title']}\n{clip(e['text'], 1500)}{probe_text(e.get('probe'))}" for e in earlier) or "(none: the window starts at the first section)"
    window_txt = "\n\n".join(f"## {w['title']}\n{w['text'].strip() or '(empty)'}" for w in window)
    dblock = ""
    if not diagram_mod.is_empty(diagram):
        dblock = f"<diagram>\nThe canvas as it stood when the candidate saved this section.\n{diagram_mod.render_text(diagram)}\n</diagram>\n\n"
    return (
        f"<current_section>\ntitle: {fw_section['title']}\nstaff_bar: {' '.join(str(fw_section['staff_bar']).split())}\n</current_section>\n\n"
        f"<earlier_context>\nFor background only. Do not probe this again.\n{earlier_txt}\n</earlier_context>\n\n"
        f"<window>\nWhat the candidate said since the last probe. Probe this.\n{window_txt}\n</window>\n\n"
        + dblock +
        "<task>\nAsk the one probing question and the one hint, per the system rules. Return the structured output only.\n</task>"
    )


def improvement(sessions: list[dict]) -> str:
    return (
        f"<sessions note=\"oldest first; scores are 1-4, staff = 3\">\n{json.dumps(sessions, indent=1)}\n</sessions>\n\n"
        f"<task>\nThese are the candidate's last {len(sessions)} graded sessions. List the technical concepts they should study, "
        "ranked by priority, each tied to the sessions where it showed up. Return the structured output only.\n</task>"
    )
