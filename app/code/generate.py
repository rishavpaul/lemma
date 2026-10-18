"""Turn a roadmap entry into a validated, judge-ready problem.

The model writes the statement, a reference solution, an independent brute-force solution, example answers and a Python
input generator. Nothing it says is trusted until it has been executed: both solutions must compile, the examples must
match the reference, and on every generated input the reference and the brute force must agree (or both satisfy the checker).
Disagreements go back to the model once or twice; whatever still disagrees is dropped and reported."""
import json
import logging
import re

from .. import config
from . import compare, judge, sandbox

log = logging.getLogger("coach.code.generate")

MAX_ROUNDS = 3
SMALL_SIZES = (1, 2, 3, 4, 5, 6, 8)
MEDIUM_SIZES = (12, 20, 30)

PUBLIC_KEYS = ("kind", "class_name", "method", "inplace_param", "compare", "statement_md", "constraints", "starter_code", "support_code", "levels")
SECRET_KEYS = ("reference_solution", "brute_solution", "generator_py", "checker_py", "perf_size", "hints", "approach_md",
               "time_complexity", "space_complexity", "pitfalls", "follow_ups")


def load_schema() -> dict:
    """code_spec.json with any $ref resolved, so every backend sees a self-contained schema."""
    return inline_refs(config.load_schema("code_spec"))


def inline_refs(schema: dict) -> dict:
    defs = schema.get("$defs", {})

    def walk(node):
        if isinstance(node, dict):
            if "$ref" in node:
                return walk(defs[node["$ref"].rsplit("/", 1)[-1]])
            return {k: walk(v) for k, v in node.items() if k != "$defs"}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node
    return walk(schema)


def split_spec(spec: dict) -> tuple[dict, dict]:
    return ({k: spec[k] for k in PUBLIC_KEYS if k in spec}, {k: spec[k] for k in SECRET_KEYS if k in spec})


def _entry(problem: dict, phase: dict, topics: dict) -> str:
    tags = ", ".join(topics.get(t, t) for t in json.loads(problem["tags_json"]))
    lines = [f"<roadmap_entry>\ntitle: {problem['title']}"]
    if problem.get("num"):
        lines.append(f"inspired by: LeetCode #{problem['num']}" + (" (premium)" if problem["premium"] else ""))
    lines += [f"difficulty: {problem['difficulty']}", f"phase: {phase['name']} - {phase['why']}", f"topics: {tags or 'n/a'}",
              f"note from the roadmap (the interviewer's intent and the follow-up): {problem['note']}"]
    if problem["is_build"]:
        levels = json.loads(problem["levels_json"])
        lines.append(f"This is a multi-level build with {len(levels)} levels. Level descriptions from the roadmap (a staff marker means a staff-level follow-up):")
        lines += [f"  level {i}{' (staff)' if lv.get('staff') else ''}: {lv['text']}" for i, lv in enumerate(levels, 1)]
    lines.append("</roadmap_entry>")
    return "\n".join(lines)


def _n_levels(problem: dict) -> int:
    return len(json.loads(problem["levels_json"])) if problem["is_build"] else 0


def brief_payload(problem: dict, phase: dict, topics: dict) -> str:
    n = _n_levels(problem)
    return (_entry(problem, phase, topics) + "\n\n<task>\nWrite the statement and the starter file per the output schema. "
            + (f"Provide exactly {n} entries in `levels`." if n else "Leave `levels` as an empty array.") + "\n</task>")


def request_payload(problem: dict, phase: dict, topics: dict, brief: dict | None = None) -> str:
    n = _n_levels(problem)
    fixed = ""
    if brief:
        shown = {k: brief[k] for k in ("kind", "class_name", "method", "inplace_param", "starter_code", "statement_md")}
        fixed = ("\n\n<fixed_brief>\nThe candidate is already reading this statement and typing into this starter file, so the public signature is FINAL. "
                 "Use exactly this `kind`, `class_name`, `method`, `inplace_param` and implement every solution against exactly this starter's "
                 "signatures. Return `starter_code`, `constraints` and `levels` unchanged. Return `statement_md` unchanged too, unless a worked example "
                 "in it contradicts the correct answer, in which case fix only that example.\n" + json.dumps(shown) + "\n</fixed_brief>")
    return (_entry(problem, phase, topics) + fixed + "\n\n<task>\nProduce the full problem per the output schema. "
            + (f"Provide exactly {n} entries in `levels`." if n else "Leave `levels` as an empty array.")
            + " Remember: every solution and generator you write will be executed and cross-checked.\n</task>")


def validate_brief(b: dict, schema: dict, problem: dict) -> str | None:
    from ..pipeline import check_schema
    err = check_schema(b, schema)
    if err:
        return err
    if not re.search(rf"\b(class|interface|record)\s+{re.escape(b['class_name'])}\b", b["starter_code"]):
        return f"starter_code must declare a class named {b['class_name']}"
    if b["kind"] == "function" and not b["method"].strip():
        return "method is required for kind function"
    if b["kind"] == "function" and b["method"] not in b["starter_code"]:
        return "starter_code must contain the method named in `method`"
    if b["kind"] == "design" and b["method"].strip():
        return "method must be an empty string for kind design"
    if b["inplace_param"] != int(b["inplace_param"]) or b["inplace_param"] < -1:
        return "inplace_param must be an integer, -1 for none"
    if len(b["levels"]) != _n_levels(problem):
        return f"levels must have exactly {_n_levels(problem)} entries"
    if not b["statement_md"].strip():
        return "statement_md must not be empty"
    return None


def retry_payload(base: str, previous: dict, issues: list[str]) -> str:
    body = "\n".join(f"- {i}" for i in issues[:10])
    return (base + "\n\n<previous_attempt>\n" + json.dumps(previous) + "\n</previous_attempt>\n\n<validation_report>\n"
            "The judge ran your previous attempt and found these problems. Decide for each whether the reference, the brute force, the "
            "expected value, the generator or the statement is wrong, and fix the cause. Return the complete corrected problem.\n"
            + body + "\n</validation_report>")


def validate_spec(spec: dict, schema: dict, problem: dict, brief: dict | None = None) -> str | None:
    from ..pipeline import check_schema
    err = check_schema(spec, schema)
    if err:
        return err
    if brief:
        for k in ("kind", "class_name", "method"):
            if spec[k] != brief[k]:
                return f"{k} must stay {brief[k]!r} as in the fixed brief"
        if int(spec["inplace_param"]) != int(brief["inplace_param"]):
            return f"inplace_param must stay {brief['inplace_param']} as in the fixed brief"
    cls = spec["class_name"]
    for name in ("starter_code", "reference_solution", "brute_solution"):
        if not re.search(rf"\b(class|interface|record)\s+{re.escape(cls)}\b", spec[name]):
            return f"{name} must declare a class named {cls}"
    if spec["kind"] == "function" and not spec["method"].strip():
        return "method is required for kind function"
    if spec["kind"] == "design" and spec["method"].strip():
        return "method must be an empty string for kind design"
    if spec["kind"] == "function" and spec["method"] not in spec["reference_solution"]:
        return "the reference solution does not define the method named in `method`"
    if "def gen" not in spec["generator_py"]:
        return "generator_py must define gen(rng, size, level=1)"
    if spec["checker_py"].strip() and "def check" not in spec["checker_py"]:
        return "checker_py must define check(case_input, actual)"
    if not spec["examples"]:
        return "at least one example is required"
    if len(spec["hints"]) < 3:
        return "three hints are required"
    if spec["perf_size"] < 10:
        return "perf_size must be at least 10"
    n = _n_levels(problem)
    if len(spec["levels"]) != n:
        return f"levels must have exactly {n} entries"
    if spec["inplace_param"] != int(spec["inplace_param"]):
        return "inplace_param must be an integer"
    return None


def time_limit(kind: str, ref_ms: int) -> int:
    """A per-case limit scaled to how long the reference took, so a stress case separates the intended complexity from a slower
    one instead of letting anything under a flat ceiling through. Generous multiples absorb JVM warm-up and a clumsier but valid solution."""
    if kind == "perf":
        return int(min(6000, max(1500, ref_ms * 40)))
    return int(min(5000, max(2000, ref_ms * 20)))


def _plan(n_levels: int, perf_size: int) -> list[dict]:
    steps, seed = [], 1000
    for lv in range(1, n_levels + 1):
        small = SMALL_SIZES if n_levels == 1 else (2, 4, 6, 8)
        medium = MEDIUM_SIZES if n_levels == 1 else (15, 30)
        for size in small:
            seed += 1
            steps.append({"count": 4 if n_levels == 1 else 3, "size": size, "level": lv, "seed": seed})
        for size in medium:
            seed += 1
            steps.append({"count": 3 if n_levels == 1 else 2, "size": size, "level": lv, "seed": seed})
    seed += 1
    steps.append({"count": 2, "size": perf_size, "level": n_levels, "seed": seed, "perf": True})
    return steps


async def build_cases(spec: dict) -> tuple[list[dict], dict, list[str]]:
    """Run the reference and the brute force on every candidate case. Returns (cases, report, issues).
    `cases` holds only cases that passed validation; `issues` is what to send back to the model."""
    issues: list[str] = []
    mode = judge.compare_mode(spec)
    n_levels = max(1, len(spec["levels"]))
    cands: list[dict] = []
    for i, ex in enumerate(spec["examples"], 1):
        cands.append({"id": f"ex{i}", "kind": "example", "name": f"Example {i}", "level": int(ex["level"]), "input": ex["input"],
                      "given": ex["expected"], "has_given": True})
    for i, e in enumerate(spec["edge_cases"], 1):
        cands.append({"id": f"ed{i}", "kind": "edge", "name": e["name"], "level": int(e["level"]), "input": e["input"]})
    gen = await sandbox.generate(spec["generator_py"], _plan(n_levels, int(spec["perf_size"])))
    if gen.get("error") and not gen["cases"]:
        issues.append(f"generator_py failed: {gen['error']}")
    elif gen.get("errors"):
        issues.append("generator_py raised on some inputs: " + "; ".join(gen["errors"][:3]))
    seen = {judge.dumps(c["input"]) for c in cands}
    counts = {"small": 0, "medium": 0, "perf": 0}
    for g in gen.get("cases", []):
        key = judge.dumps(g["input"])
        if key in seen:
            continue
        seen.add(key)
        tier = "perf" if g["perf"] else ("small" if g["size"] <= max(SMALL_SIZES) else "medium")
        counts[tier] += 1
        cands.append({"id": f"{'p' if tier == 'perf' else 'r'}{sum(counts.values())}", "kind": "perf" if tier == "perf" else "random",
                      "name": "Stress test" if tier == "perf" else f"Random {sum(counts.values())}", "level": int(g["level"]),
                      "input": g["input"], "tier": tier, "size": g["size"]})
    for c in cands:
        c["timeout_ms"] = 10000 if c["kind"] == "perf" else 4000
    ref = await judge.run_source(spec["reference_solution"], spec, cands)
    if not ref["compile"]["ok"]:
        return [], {"counts": counts}, [f"reference_solution does not compile:\n{ref['compile']['output'][:1500]}"]
    small = [c for c in cands if c["kind"] != "perf"]
    brute = await judge.run_source(spec["brute_solution"], spec, small)
    if not brute["compile"]["ok"]:
        return [], {"counts": counts}, [f"brute_solution does not compile:\n{brute['compile']['output'][:1500]}"]
    ref_by = dict(zip([c["id"] for c in cands], ref["results"]))
    brute_by = dict(zip([c["id"] for c in small], brute["results"]))
    checker = (spec["checker_py"] or "").strip()
    verdict: dict[tuple[str, str], str | None] = {}
    if checker:
        items, keys = [], []
        for who, by in (("ref", ref_by), ("brute", brute_by)):
            for cid, r in by.items():
                if r["status"] == "ok":
                    items.append({"input": next(c["input"] for c in cands if c["id"] == cid), "actual": r["result"]})
                    keys.append((who, cid))
        res = await sandbox.check(checker, items) if items else []
        if isinstance(res, str):
            issues.append(f"checker_py failed: {res}")
        else:
            verdict = dict(zip(keys, res))

    def same(a, b) -> bool:
        return compare.equal(a, b, mode)

    kept, dropped, unverified = [], [], 0
    for c in cands:
        r = ref_by[c["id"]]
        where = f"[{c['kind']} '{c['name']}' level {c['level']}] input {compare.show(c['input'], 300)}"
        if r["status"] != "ok":
            msg = f"{where}: the reference solution {r['status']}: {r.get('error') or ''}".strip()
            if c["kind"] == "perf":
                dropped.append(c["id"])
                issues.append(msg + " (the stress case is too slow or too large; lower perf_size or fix the reference)")
            else:
                dropped.append(c["id"])
                issues.append(msg)
            continue
        ok = True
        if checker:
            v = verdict.get(("ref", c["id"]))
            if v:
                issues.append(f"{where}: your checker rejects the reference output {compare.show(r['result'], 200)}: {v}")
                ok = False
        elif c.get("has_given") and not same(r["result"], c["given"]):
            issues.append(f"{where}: the example says the answer is {compare.show(c['given'], 300)} but the reference returned {compare.show(r['result'], 300)}"
                          + (f" and the brute force returned {compare.show(brute_by[c['id']].get('result'), 300)}" if c["id"] in brute_by and brute_by[c["id"]]["status"] == "ok" else ""))
            ok = False
        if ok and c["id"] in brute_by:
            b = brute_by[c["id"]]
            if b["status"] == "ok":
                if checker:
                    v = verdict.get(("brute", c["id"]))
                    if v:
                        issues.append(f"{where}: your checker rejects the brute-force output: {v}")
                        ok = False
                elif not same(r["result"], b["result"]):
                    issues.append(f"{where}: the reference returned {compare.show(r['result'], 300)} but the brute force returned {compare.show(b['result'], 300)}")
                    ok = False
            elif b["status"] == "timeout" and c.get("tier") == "medium":
                c["verified"] = False
                unverified += 1
            else:
                issues.append(f"{where}: the brute force {b['status']}: {b.get('error') or ''}".strip())
                ok = False
        if not ok:
            dropped.append(c["id"])
            continue
        c["verified"] = c.get("verified", c["kind"] != "perf")
        c["expected"] = r["result"]
        c["timeout_ms"] = time_limit(c["kind"], r.get("ms", 0))
        kept.append({k: c[k] for k in ("id", "kind", "name", "level", "input", "expected", "timeout_ms", "verified")})
    report = {"counts": counts, "kept": len(kept), "dropped": len(dropped), "unverified": unverified, "ref_ms_max": max((r.get("ms", 0) for r in ref["results"]), default=0)}
    return kept, report, issues
