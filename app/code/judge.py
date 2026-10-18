"""Run a candidate's Java (or a reference solution) on a problem's cases and decide which pass."""
import json
import re

from . import compare, runner, sandbox

DEFAULT_TIMEOUT_MS = 2500
PERF_TIMEOUT_MS = 6000
MAX_DETAILED_FAILURES = 4


_AUTO_IMPORTS = {
    "java.util": "List ArrayList LinkedList Map HashMap TreeMap LinkedHashMap Set HashSet TreeSet LinkedHashSet Queue Deque ArrayDeque "
                 "PriorityQueue Stack Vector Arrays Collections Iterator Optional Objects Random Comparator BitSet NavigableMap NavigableSet "
                 "SortedMap SortedSet StringJoiner ListIterator EnumMap",
    "java.util.function": "Function BiFunction Supplier Consumer Predicate BiConsumer UnaryOperator BinaryOperator IntFunction",
    "java.util.stream": "Stream IntStream Collectors LongStream",
    "java.util.concurrent": "ConcurrentHashMap",
    "java.util.concurrent.atomic": "AtomicInteger AtomicLong",
}
_STRINGS_AND_COMMENTS = re.compile(r'//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\'', re.S)


def add_missing_imports(code: str) -> str:
    """Prepend imports for common JDK classes the code uses without importing, on line 1 so error line numbers do not move."""
    body = _STRINGS_AND_COMMENTS.sub(" ", code)
    have = set(re.findall(r"^\s*import\s+([\w.]+(?:\.\*)?)\s*;", body, re.M))
    declared = set(re.findall(r"\b(?:class|interface|enum|record)\s+(\w+)", body))
    add = []
    for pkg, names in _AUTO_IMPORTS.items():
        if f"{pkg}.*" in have:
            continue
        for name in names.split():
            if name not in declared and f"{pkg}.{name}" not in have and re.search(rf"(?<![\w.]){name}\b", body):
                add.append(f"import {pkg}.{name};")
    return (" ".join(add) + " " + code) if add else code


def source_files(code: str, spec: dict) -> dict[str, str]:
    files = {f"{spec['class_name']}.java": add_missing_imports(code)}
    if (spec.get("support_code") or "").strip():
        files["Support.java"] = spec["support_code"]
    return files


def compare_mode(spec: dict) -> str:
    """Design problems return a list of per-operation results, so list-order modes make no sense for them."""
    mode = spec.get("compare") or "exact"
    return mode if spec["kind"] == "function" or mode == "float" else "exact"


def case_timeout(case: dict) -> int:
    return case.get("timeout_ms") or (PERF_TIMEOUT_MS if case.get("kind") == "perf" else DEFAULT_TIMEOUT_MS)


async def compile_starter(brief: dict) -> str | None:
    """None when the starter file compiles (as the candidate will see it), else the first compiler messages."""
    with runner.Workdir() as wd:
        comp = await runner.compile_sources({f"{brief['class_name']}.java": brief["starter_code"]}, wd)
    if comp["ok"]:
        return None
    if comp.get("unavailable"):
        return None  # no JDK: nothing to check against, the judge will say so later
    return comp["output"][:600]


async def run_source(code: str, spec: dict, cases: list[dict]) -> dict:
    """Compile `code` and run `cases`. Returns {"compile": {...}, "results": [...]} (results align with cases)."""
    inplace = spec.get("inplace_param")
    inplace = None if inplace is None or inplace < 0 else int(inplace)
    run_cases = [{"id": c["id"], "input": c["input"], "timeout_ms": case_timeout(c)} for c in cases]
    return await runner.execute(source_files(code, spec), spec["class_name"], spec["kind"], spec.get("method") or "", inplace, run_cases)


def _status_text(r: dict) -> str:
    s = r["status"]
    if s == "timeout":
        return "Time limit exceeded"
    if s == "skipped":
        return "Not run (earlier cases timed out)"
    if s == "crash":
        return str(r.get("error") or "The program crashed")
    return str(r.get("error") or "Runtime error")


async def judge(code: str, spec: dict, secrets: dict, cases: list[dict]) -> dict:
    """The verdict for one submission. `cases` is already filtered to the cases that apply (level, run vs submit)."""
    out = await run_source(code, spec, cases)
    comp = out["compile"]
    if not comp["ok"]:
        return {"status": "compile_error" if not comp.get("unavailable") else "unavailable", "compile": comp, "passed": 0, "total": len(cases), "cases": []}
    mode = compare_mode(spec)
    checker = (secrets.get("checker_py") or "").strip()
    verdicts: dict[str, str | None] = {}
    checker_error = None
    ok_idx = [i for i, r in enumerate(out["results"]) if r["status"] == "ok"]
    if checker and ok_idx:
        res = await sandbox.check(checker, [{"input": cases[i]["input"], "actual": out["results"][i]["result"]} for i in ok_idx])
        if isinstance(res, str):
            checker_error = res
        else:
            verdicts = {cases[i]["id"]: msg for i, msg in zip(ok_idx, res)}
    rows, passed, detailed = [], 0, 0
    for case, r in zip(cases, out["results"]):
        row = {"id": case["id"], "kind": case["kind"], "name": case.get("name") or "", "level": case.get("level", 1),
               "ms": r.get("ms", 0), "status": r["status"], "stdout": (r.get("stdout") or "")[:1500]}
        if r["status"] == "ok":
            if checker:
                ok = checker_error is None and verdicts.get(case["id"]) is None
                row["message"] = "" if ok else (verdicts.get(case["id"]) or f"checker failed: {checker_error}")
            else:
                ok = compare.equal(r["result"], case["expected"], mode)
                row["message"] = "" if ok else "Wrong answer"
        else:
            ok = False
            row["message"] = _status_text(r)
            row["trace"] = r.get("trace") or ""
        row["passed"] = ok
        passed += ok
        # examples and edge cases are always shown in full; hidden cases only reveal themselves when they fail, and only the first few
        show = case["kind"] in ("example", "edge") or (not ok and detailed < MAX_DETAILED_FAILURES)
        if not ok and case["kind"] not in ("example", "edge"):
            detailed += 1
        if show:
            row["input"] = compare.show(case["input"])
            row["expected"] = compare.show(case["expected"]) if case.get("expected") is not None or not checker else "(any valid answer)"
            if r["status"] == "ok":
                row["actual"] = compare.show(r["result"])
            elif r.get("partial") is not None:
                row["actual"] = compare.show(r["partial"])
        rows.append(row)
    status = "passed" if passed == len(cases) else "failed"
    return {"status": status, "compile": comp, "passed": passed, "total": len(cases), "cases": rows}


def summarize(verdict: dict) -> str:
    """A few lines for prompts: what the judge said, without dumping every case."""
    if verdict["status"] == "compile_error":
        return "Did not compile:\n" + verdict["compile"]["output"][:1200]
    lines = [f"{verdict['passed']}/{verdict['total']} cases passed."]
    slow = [c for c in verdict["cases"] if c["passed"] and c["kind"] == "perf"]
    if slow:
        lines.append("Stress cases: " + ", ".join(f"{c['name'] or c['id']} {c['ms']}ms" for c in slow))
    for c in [c for c in verdict["cases"] if not c["passed"]][:4]:
        bits = [f"- [{c['kind']}] {c['message']}"]
        if c.get("input"):
            bits.append(f"input {c['input'][:300]}")
        if c.get("expected"):
            bits.append(f"expected {c['expected'][:200]}")
        if c.get("actual"):
            bits.append(f"got {c['actual'][:200]}")
        lines.append("; ".join(bits))
    return "\n".join(lines)


def dumps(x) -> str:
    return json.dumps(x, separators=(",", ":"), ensure_ascii=False)
