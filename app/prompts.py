"""Builds the stdin payloads (plain text with XML-style tags) for each Claude call type."""
import json

from . import config


def _fmt_framework(framework: list[dict]) -> str:
    return "\n".join(f"- {s['key']} ({s['title']}): {' '.join(str(s['staff_bar']).split())}" for s in framework)


def _fmt_question(q: dict) -> str:
    return f"{q['title']}\n{q['prompt']}"


def _hints(q: dict) -> str:
    return q.get("crux_hints") or "(none provided)"


def research(question: dict, framework: list[dict]) -> str:
    return (
        f"<question>\n{_fmt_question(question)}\n</question>\n\n"
        f"<crux_hints>\n{_hints(question)}\n</crux_hints>\n\n"
        f"<framework>\n{_fmt_framework(framework)}\n</framework>\n\n"
        "<task>\nProduce the reference brief for this question per the output schema. Use web search and fetch the "
        "pages you rely on. Include at least 5 distinct sources with at least 3 primary. Fill "
        "staff_level_answer_outline with one string per framework section key.\n</task>"
    )


def section(question: dict, brief: dict | None, fw_section: dict, anchors: str, gap_tags: dict,
            earlier: list[dict], this: dict) -> str:
    brief_txt = json.dumps(brief, indent=1) if brief else \
        "NONE: grade from general knowledge and state that grading was ungrounded"
    earlier_txt = "\n\n".join(f"## {e['title']}\n{e['text']}" for e in earlier) or "(this is the first section)"
    tags = "\n".join(f"- {t}: {d}" for t, d in gap_tags["tags"].items())
    used = this.get("duration_sec")
    time_txt = f"{round(used)}s used of {this['budget_sec']}s budget" if used else f"unknown time used; budget {this['budget_sec']}s"
    return (
        f"<question>\n{_fmt_question(question)}\n</question>\n\n"
        f"<crux_hints>\n{_hints(question)}\n</crux_hints>\n\n"
        f"<reference_brief>\n{brief_txt}\n</reference_brief>\n\n"
        f"<framework_section>\nkey: {fw_section['key']}\ntitle: {fw_section['title']}\n"
        f"cover: {'; '.join(fw_section['cover'])}\nstaff_bar: {' '.join(str(fw_section['staff_bar']).split())}\n</framework_section>\n\n"
        f"<rubric_anchors>\n{anchors}\n</rubric_anchors>\n\n"
        f"<gap_tags>\nUse these tags (or other.<short_slug> if none fits):\n{tags}\n</gap_tags>\n\n"
        f"<earlier_sections>\n{earlier_txt}\n</earlier_sections>\n\n"
        f"<this_section>\ntitle: {this['title']}\ntime: {time_txt}\ntranscript:\n{this['text'] or '(empty)'}\n</this_section>\n\n"
        "<task>\nGrade this section against the rubric anchors and the reference brief. Fact-check as instructed. "
        "Return the structured output only.\n</task>"
    )


def holistic(question: dict, brief: dict | None, gap_tags: dict, sections: list[dict], previous: list[dict]) -> str:
    brief_txt = json.dumps(brief, indent=1) if brief else "NONE: grading was ungrounded"
    tags = "\n".join(f"- {t}: {d}" for t, d in gap_tags["tags"].items())
    parts = []
    for s in sections:
        used = f"{round(s['duration_sec'])}s used of {s['budget_sec']}s" if s.get("duration_sec") else f"time unknown; budget {s['budget_sec']}s"
        parts.append(f"## {s['title']} ({used})\ntranscript:\n{s['text'] or '(empty)'}\n"
                     f"section grade JSON:\n{json.dumps(s['grade']) if s['grade'] else '(not graded)'}")
    prev = json.dumps(previous, indent=1) if previous else "(no previous sessions)"
    return (
        f"<question>\n{_fmt_question(question)}\n</question>\n\n"
        f"<reference_brief>\n{brief_txt}\n</reference_brief>\n\n"
        f"<rubric_dimensions>\n{config.rubric_dimensions()}\n</rubric_dimensions>\n\n"
        f"<gap_tags>\n{tags}\n</gap_tags>\n\n"
        f"<sections>\n{chr(10).join(parts)}\n</sections>\n\n"
        f"<previous_sessions>\n{prev}\n</previous_sessions>\n\n"
        "<task>\nGive the holistic grade for the whole session: overall level, all 10 dimension scores (1-4), at most 3 top "
        "gaps with tags, a study plan, ONE concrete drill for next session, and a model answer outline. Compare to previous "
        "sessions when provided. time_management must be judged from the actual time used vs budget per section. "
        "Return the structured output only.\n</task>"
    )
