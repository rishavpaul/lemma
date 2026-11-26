"""Turn the staff review's comments into a code review on the candidate's code: find the lines each comment is about, and check
every suggested edit before the candidate sees it (applied alone to the reviewed code, compiled, and run on the visible cases).

The model quotes code; quotes are matched exactly first, then ignoring differences in whitespace, and the exact text found in the
code is what the editor later replaces. An edit that cannot be matched to exactly one place is dropped (the comment stays)."""
import re

from . import judge


def locate(code: str, text: str) -> tuple[int, int, int] | None:
    """(start offset, end offset, number of matches) of `text` in `code`, or None. Whitespace-insensitive when an exact match fails."""
    text = text.strip("\n")
    if not text.strip():
        return None
    n = code.count(text)
    if n:
        i = code.index(text)
        return i, i + len(text), n
    tokens = text.split()
    pattern = re.compile(r"\s+".join(re.escape(t) for t in tokens))
    found = list(pattern.finditer(code))
    if not found:
        return None
    return found[0].start(), found[0].end(), len(found)


def _lines(code: str, start: int, end: int) -> tuple[int, int]:
    return code.count("\n", 0, start) + 1, code.count("\n", 0, max(start, end - 1)) + 1


def attach(result: dict, code: str) -> None:
    """Add `line_start`/`line_end` to each comment and `edit` = {find (exact text in the code), replace} to each usable suggestion."""
    taken: list[tuple[int, int]] = []
    for c in result.get("comments", []):
        c["line_start"] = c["line_end"] = None
        c["edit"] = None
        c["edit_problem"] = None
        f = (c.get("find") or "").strip("\n")
        if f.strip():
            hit = locate(code, f)
            if not hit:
                c["edit_problem"] = "the suggested change could not be matched to your code"
            elif hit[2] > 1:
                c["edit_problem"] = "the suggested change matches more than one place in your code"
            elif any(hit[0] < b and a < hit[1] for a, b in taken):
                c["edit_problem"] = "the suggested change overlaps another suggestion"
            else:
                taken.append((hit[0], hit[1]))
                c["edit"] = {"find": code[hit[0]:hit[1]], "replace": (c.get("replace") or "").strip("\n")}
                c["line_start"], c["line_end"] = _lines(code, hit[0], hit[1])
        anchor = locate(code, c.get("anchor") or "")
        if anchor:  # the anchor says where the comment is shown; fall back to the edit's place
            c["line_start"], c["line_end"] = _lines(code, anchor[0], anchor[1])


async def verify(result: dict, code: str, spec: dict, secrets: dict, cases: list[dict], baseline: dict | None) -> None:
    """Run each suggested edit, applied alone to the reviewed code, on `cases`. Sets edit.check to
    {"status": "passes" | "fails" | "compile_error" | "error", "passed", "total", "baseline_passed"}."""
    for c in result.get("comments", []):
        e = c.get("edit")
        if not e:
            continue
        edited = code.replace(e["find"], e["replace"], 1)
        try:
            v = await judge.judge(edited, spec, secrets, cases)
        except RuntimeError as ex:
            e["check"] = {"status": "error", "message": str(ex)[:200]}
            continue
        status = "compile_error" if v["status"] == "compile_error" else "passes" if v["status"] == "passed" else "fails"
        e["check"] = {"status": status, "passed": v["passed"], "total": v["total"],
                      "baseline_passed": baseline["passed"] if baseline else None,
                      "message": (v["compile"].get("output") or "")[:400] if status == "compile_error" else None}


def upgrade(result: dict | None, code: str | None) -> dict | None:
    """Reviews written before code-review comments had `issues`, `staff_gaps` and `improvements`: turn them into `comments`
    (pinned to the code where their quote can be found, without one-click edits) so there is one format everywhere."""
    if not result or "comments" in result:
        return result
    comments = []
    for x in result.get("issues", []):
        comments.append({"severity": x.get("severity", "medium"), "kind": "bug", "title": x.get("title", ""),
                         "comment": " ".join(p for p in (x.get("detail", ""), ("Fix: " + x["fix"]) if x.get("fix") else "") if p),
                         "anchor": x.get("quote", ""), "find": "", "replace": ""})
    for g in result.get("staff_gaps", []):
        comments.append({"severity": "medium", "kind": "staff_gap", "title": g.get("area", ""),
                         "comment": f"{g.get('gap', '')} Staff does: {g.get('what_staff_does', '')}".strip(), "anchor": "", "find": "", "replace": ""})
    for m in result.get("improvements", []):
        comments.append({"severity": "low", "kind": "clarity", "title": m.get("title", ""),
                         "comment": f"{m.get('why', '')}\n\n{m.get('code', '')}".strip(), "anchor": "", "find": "", "replace": ""})
    out = {k: v for k, v in result.items() if k not in ("issues", "staff_gaps", "improvements")}
    out["comments"] = comments
    attach(out, code or "")
    return out
