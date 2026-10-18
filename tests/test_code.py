"""Coding vertical: comparison modes, the Java judge, test-case validation and the API flow, with the model call stubbed.
The Java tests need a JDK and are skipped without one. Run: .venv/bin/python -m unittest discover tests"""
import asyncio
import json
import os
import sys
import tempfile
import time
import unittest

os.environ["LEMMA_HOME"] = tempfile.mkdtemp()
os.environ["LEMMA_TTS"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app import config, db, grader, main  # noqa: E402
from app.code import compare, generate, handlers, judge, runner  # noqa: E402

HAVE_JAVA = runner.find_java()["ok"]
needs_java = unittest.skipUnless(HAVE_JAVA, "no JDK")


_LOOP = asyncio.new_event_loop()  # one loop for the whole module: subprocess transports are collected after a per-call loop would be closed


def run(coro):
    return _LOOP.run_until_complete(coro)


COUNT_EVEN = """import java.util.*;
class Solution {
    public int countEven(int[] a) { int n = 0; for (int x : a) if (x % 2 == 0) n++; return n; }
}"""
COUNT_EVEN_BRUTE = """import java.util.*;
class Solution {
    public int countEven(int[] a) { List<Integer> evens = new ArrayList<>(); for (int x : a) { if (Math.floorMod(x, 2) == 0) evens.add(x); } return evens.size(); }
}"""
GEN = "def gen(rng, size, level=1):\n    return [[rng.randint(-9, 9) for _ in range(rng.randint(0, size))]]\n"


def spec(**over) -> dict:
    s = {
        "kind": "function", "class_name": "Solution", "method": "countEven", "inplace_param": -1, "compare": "exact",
        "statement_md": "Count the even numbers in `a`.", "constraints": ["0 <= a.length <= 10^5"],
        "starter_code": "class Solution {\n    public int countEven(int[] a) {\n        // TODO\n        return 0;\n    }\n}",
        "support_code": "", "reference_solution": COUNT_EVEN, "brute_solution": COUNT_EVEN_BRUTE,
        "examples": [{"input": [[1, 2, 4]], "expected": 2, "explanation": "2 and 4", "level": 1}],
        "edge_cases": [{"name": "empty", "input": [[]], "level": 1}, {"name": "negatives", "input": [[-2, -1, 0]], "level": 1}],
        "generator_py": GEN, "checker_py": "", "perf_size": 200000, "hints": ["h1", "h2", "h3"], "approach_md": "Loop and count.",
        "time_complexity": "O(n)", "space_complexity": "O(1)", "pitfalls": ["negative numbers"], "follow_ups": ["streaming"], "levels": [],
    }
    s.update(over)
    return s


def review_result(score=3.5) -> dict:
    dim = {"score": 3.5, "assessed": True, "rationale": "r"}
    return {"verdict_kind": "correct_optimal", "overall_score": score, "overall_level": "staff", "hire_signal": "strong_hire", "summary": "Solid.",
            "dimension_scores": {k: dict(dim) for k in ("correctness", "algorithm_and_complexity", "code_quality", "design_and_extensibility",
                                                        "production_awareness", "verification", "communication")},
            "complexity": {"your_time": "O(n)", "your_space": "O(1)", "optimal_time": "O(n)", "optimal_space": "O(1)", "note": "n"},
            "strengths": ["clear"], "issues": [], "staff_gaps": [], "improvements": [], "say_out_loud": "I would loop once.",
            "interviewer_follow_ups": [], "gaps": [{"tag": "ops.memory_bounds", "description": "d", "severity": "low"}, {"tag": "made.up_tag", "description": "x", "severity": "low"}],
            "drill": "d", "redo_advice": "r"}


class Compare(unittest.TestCase):
    def test_modes(self):
        self.assertTrue(compare.equal([[1, 2], [3]], [[3], [2, 1]], "unordered_nested"))
        self.assertFalse(compare.equal([[1, 2], [3]], [[3], [2, 1]], "unordered"))
        self.assertTrue(compare.equal([3, 1, 2], [1, 2, 3], "unordered"))
        self.assertFalse(compare.equal([3, 1, 2], [1, 2, 3], "exact"))
        self.assertTrue(compare.equal(0.1 + 0.2, 0.3, "float"))
        self.assertFalse(compare.equal(True, 1))  # a boolean is not a number
        self.assertTrue(compare.equal(1.0, 1))
        self.assertFalse(compare.equal([1, 2], [1, 2, 3]))
        self.assertTrue(compare.equal({"a": [1]}, {"a": [1]}))

    def test_time_limit_scales_with_reference(self):
        self.assertEqual(generate.time_limit("perf", 10), 1500)
        self.assertEqual(generate.time_limit("perf", 100), 4000)
        self.assertEqual(generate.time_limit("perf", 10_000), 6000)
        self.assertEqual(generate.time_limit("edge", 5), 2000)


class Sandbox(unittest.TestCase):
    def test_does_not_use_isolated_mode(self):
        from app.code import sandbox
        self.assertNotIn("-I", sandbox.PY_FLAGS)  # -I ignores PYTHONHOME, which breaks the packaged app's interpreter

    def test_generator_runs_and_python_home_is_passed_through(self):
        from app.code import sandbox
        code = "import os\ndef gen(rng, size, level=1):\n    return [size, rng.randint(1, 9)]\n"
        os.environ["PYTHONHOME"] = sys.base_prefix
        try:
            r = run(sandbox.generate(code, [{"count": 2, "size": 3, "level": 1, "seed": 1}]))
        finally:
            del os.environ["PYTHONHOME"]
        self.assertEqual(len(r["cases"]), 2)
        self.assertEqual(r["cases"][0]["input"][0], 3)

    def test_a_dead_interpreter_is_not_blamed_on_the_model(self):
        from app.code import sandbox
        fake = os.path.join(tempfile.mkdtemp(), "py")
        with open(fake, "w") as f:
            f.write("#!/bin/sh\necho 'Fatal Python error: init_fs_encoding' >&2\necho '  <no Python frame>' >&2\nexit 1\n")
        os.chmod(fake, 0o755)
        real, sys.executable = sys.executable, fake
        try:
            with self.assertRaises(sandbox.SandboxError) as cm:
                run(sandbox.generate("def gen(rng, size, level=1):\n    return []\n", [{"count": 1, "size": 1, "level": 1, "seed": 1}]))
        finally:
            sys.executable = real
        self.assertIn("could not start", str(cm.exception))
        # a bug in the model's own generator, by contrast, is reported back so it can be fixed
        r = run(sandbox.generate("def gen(rng, size, level=1):\n    return 1/0\n", [{"count": 1, "size": 1, "level": 1, "seed": 1}]))
        self.assertIn("ZeroDivisionError", r["errors"][0])


class Queue(unittest.TestCase):
    def test_problem_building_never_starves_grading(self):
        from app import jobs
        config.ensure_dirs()
        db.migrate()
        db.connect().execute("DELETE FROM jobs")
        db.connect().commit()
        db.execute("INSERT INTO jobs(type,ref_id,created_at) VALUES('code_spec',1,0)")
        later = db.execute("INSERT INTO jobs(type,ref_id,created_at) VALUES('research',999,0)")
        claimed = jobs._claim(jobs.GENERAL_TYPES)
        self.assertEqual(claimed["id"], later)  # queued after the build job, but claimed first
        db.connect().execute("DELETE FROM jobs")
        db.connect().commit()


class Background(unittest.TestCase):
    """The candidate can read and code while the tests are still being built."""
    def test_attempt_before_tests(self):
        config.ensure_dirs()
        config.seed_config()
        db.migrate()
        slug = "two-sum-demo"
        pid = db.execute("INSERT INTO problems(slug,num,title,phase,ord,track,difficulty,tags_json,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                         (slug, 1, "Count evens", 1, 9999, "core", "Easy", "[]", "n", time.time()))
        brief = {k: spec()[k] for k in ("kind", "class_name", "method", "inplace_param", "statement_md", "constraints", "starter_code", "levels")}
        db.execute("INSERT INTO problem_briefs(problem_id,brief_json,created_at) VALUES(?,?,?)", (pid, json.dumps(brief), time.time()))
        with TestClient(main.app) as c:
            d = c.get(f"/api/code/problems/{slug}").json()
            self.assertIsNone(d["spec"])
            self.assertIn("countEven", d["brief"]["starter_code"])
            self.assertNotIn("reference_solution", json.dumps(d))
            aid = c.post(f"/api/code/problems/{slug}/attempts", json={}).json()["id"]
            a = c.get(f"/api/code/attempts/{aid}").json()
            self.assertIsNone(a["spec_id"])
            self.assertEqual(a["code"], brief["starter_code"])
            code = "class Solution { int countEven(int[] a) { return 1; } }"
            self.assertEqual(c.put(f"/api/code/attempts/{aid}/code", json={"code": code}).status_code, 200)  # typing is saved
            for path in ("run", "advance", "hint", "coach", "solution"):
                body = {"code": code} if path == "run" else {}
                r = c.post(f"/api/code/attempts/{aid}/{path}", json=body)
                self.assertEqual(r.status_code, 409, path)
                self.assertIn("still being built", r.json()["detail"])
            self.assertEqual(c.get(f"/api/code/attempts/{aid}").json()["code"], code)  # the failed run kept the code
        db.execute("DELETE FROM problems WHERE id=?", (pid,))


class Caps(unittest.TestCase):
    def test_caps_cannot_be_exceeded(self):
        r = handlers.apply_caps(review_result(3.5), {"status": "passed", "hints_used": 1, "solution_viewed": False})
        self.assertEqual(r["overall_score"], 3.0)
        self.assertEqual(r["overall_level"], "staff")
        r = handlers.apply_caps(review_result(3.5), {"status": "failed", "hints_used": 0, "solution_viewed": False})
        self.assertEqual(r["overall_score"], 2.0)
        self.assertEqual(r["hire_signal"], "lean_no")
        r = handlers.apply_caps(review_result(3.5), {"status": "passed", "hints_used": 0, "solution_viewed": True})
        self.assertEqual(r["overall_score"], 2.0)
        res = review_result(3.5)
        res["verdict_kind"] = "correct_slow"
        self.assertEqual(handlers.apply_caps(res, {"status": "passed", "hints_used": 0, "solution_viewed": False})["overall_score"], 2.5)
        clean = handlers.apply_caps(review_result(3.5), {"status": "passed", "hints_used": 0, "solution_viewed": False})
        self.assertEqual((clean["overall_score"], clean["caps_applied"]), (3.5, []))


@needs_java
class Judge(unittest.TestCase):
    def test_missing_imports_are_added_on_line_one(self):
        code = "class A {\n  List<int[]> a = new ArrayList<>(); // Map\n  String s = \"Set\";\n}\n"
        out = judge.add_missing_imports(code)
        self.assertTrue(out.startswith("import java.util.List; import java.util.ArrayList; class A {"))
        self.assertNotIn("Map;", out)
        self.assertEqual(out.count("\n"), code.count("\n"))
        self.assertEqual(judge.add_missing_imports("import java.util.*;\nclass A { List<Integer> a; }"), "import java.util.*;\nclass A { List<Integer> a; }")
        self.assertEqual(judge.add_missing_imports("class Stack {}\nclass A { Stack s; }"), "class Stack {}\nclass A { Stack s; }")

    def test_function_and_errors(self):
        s = spec()
        cases = [{"id": "a", "kind": "example", "name": "ex", "level": 1, "input": [[1, 2, 4]], "expected": 2},
                 {"id": "b", "kind": "random", "name": "r", "level": 1, "input": [[2, 2, 2]], "expected": 3}]
        v = run(judge.judge(COUNT_EVEN, s, {}, cases))
        self.assertEqual((v["status"], v["passed"], v["total"]), ("passed", 2, 2))
        wrong = COUNT_EVEN.replace("x % 2 == 0", "x % 2 != 0")
        v = run(judge.judge(wrong, s, {}, cases))
        self.assertEqual(v["status"], "failed")
        shown = {c["id"]: c for c in v["cases"]}
        self.assertEqual(shown["a"]["actual"], "1")  # examples always show everything
        self.assertIn("input", shown["b"])  # a failing hidden case is revealed
        v = run(judge.judge("class Solution { int countEven(int[] a) { return ; } }", s, {}, cases))
        self.assertEqual(v["status"], "compile_error")
        self.assertEqual(v["compile"]["errors"][0]["line"], 1)
        crash = COUNT_EVEN.replace("int n = 0;", "int n = a[99];")
        v = run(judge.judge(crash, s, {}, cases))
        self.assertIn("ArrayIndexOutOfBounds", v["cases"][0]["message"])
        loop = COUNT_EVEN.replace("int n = 0;", "int n = 0; if (a.length >= 0) while (true) {}")
        slow_cases = [dict(c, timeout_ms=300) for c in cases]
        v = run(judge.judge(loop, s, {}, slow_cases))
        self.assertEqual(v["cases"][0]["message"], "Time limit exceeded")

    def test_design_and_inplace_and_structures(self):
        counter = "class Counter { int n; Counter(int s) { n = s; } void inc() { n++; } int get() { return n; } }"
        s = spec(kind="design", class_name="Counter", method="")
        case = {"id": "d", "kind": "example", "name": "d", "level": 1, "input": [["Counter", [5]], ["inc", []], ["get", []]], "expected": [None, None, 6]}
        self.assertEqual(run(judge.judge(counter, s, {}, [case]))["status"], "passed")
        sort = "import java.util.*; class Solution { public void sortIt(int[] a) { Arrays.sort(a); } public ListNode rev(ListNode h) { ListNode p = null; while (h != null) { ListNode n = h.next; h.next = p; p = h; h = n; } return p; } }"
        r = run(judge.run_source(sort, spec(method="sortIt", inplace_param=0), [{"id": "x", "input": [[3, 1, 2]], "kind": "example"}]))
        self.assertEqual(r["results"][0]["result"], [1, 2, 3])
        r = run(judge.run_source(sort, spec(method="rev"), [{"id": "x", "input": [[1, 2, 3]], "kind": "example"}]))
        self.assertEqual(r["results"][0]["result"], [3, 2, 1])


@needs_java
class Validation(unittest.TestCase):
    def test_agreeing_solutions_keep_every_case(self):
        cases, report, issues = run(generate.build_cases(spec()))
        self.assertEqual(issues, [])
        kinds = {c["kind"] for c in cases}
        self.assertEqual(kinds, {"example", "edge", "random", "perf"})
        self.assertEqual(report["dropped"], 0)
        self.assertTrue(all(c["timeout_ms"] >= 1500 for c in cases if c["kind"] == "perf"))
        self.assertFalse(next(c for c in cases if c["kind"] == "perf")["verified"])  # stress cases are checked against the reference only

    def test_a_wrong_reference_is_caught_and_its_cases_dropped(self):
        buggy = COUNT_EVEN.replace("x % 2 == 0", "x % 2 == 0 && x > 0")  # forgets non-positive evens
        cases, report, issues = run(generate.build_cases(spec(reference_solution=buggy)))
        self.assertTrue(issues)
        self.assertTrue(any("brute force" in i for i in issues))
        self.assertGreater(report["dropped"], 0)
        self.assertNotIn("ex1", [c["id"] for c in cases] if any("example" in i for i in issues) else [])

    def test_a_wrong_example_is_reported(self):
        bad = spec(examples=[{"input": [[1, 2, 4]], "expected": 3, "explanation": "wrong", "level": 1}])
        cases, _, issues = run(generate.build_cases(bad))
        self.assertTrue(any("the example says the answer is 3" in i for i in issues))
        self.assertNotIn("ex1", [c["id"] for c in cases])

    def test_a_broken_reference_does_not_compile(self):
        _, _, issues = run(generate.build_cases(spec(reference_solution="class Solution { int countEven(int[] a) { return ; } }")))
        self.assertIn("does not compile", issues[0])

    def test_spec_validation(self):
        schema = generate.load_schema()
        problem = {"is_build": 0, "levels_json": None}
        self.assertIsNone(generate.validate_spec(spec(), schema, problem))
        self.assertIn("class named", generate.validate_spec(spec(brute_solution="class Other {}"), schema, problem))
        self.assertIn("levels must have", generate.validate_spec(spec(levels=[{"n": 1, "title": "t", "statement_md": "s", "methods_added": []}]), schema, problem))
        self.assertIn("perf_size", generate.validate_spec(spec(perf_size=3), schema, problem))


CALLS: list[str] = []


async def fake_run_claude(kind, system, payload, schema, model, timeout, cpath="", validator=None, ref=None, web=True):
    CALLS.append(kind)
    if kind == "code_brief":
        out = {k: spec()[k] for k in ("kind", "class_name", "method", "inplace_param", "statement_md", "constraints", "starter_code", "levels")}
    elif kind == "code_spec":
        out = spec()
    elif kind == "code_review":
        out = review_result(3.5)
    else:
        out = {"hint": "Look at how you treat the parity of negative numbers."}
    if validator:
        problem = validator(out)
        assert problem is None, problem
    return {"ok": True, "structured": out, "raw": {}, "duration_s": 0.1, "error_kind": None, "error": None}


def wait(fn, tries=300):
    for _ in range(tries):
        v = fn()
        if v:
            return v
        time.sleep(0.1)
    raise AssertionError("timed out waiting")


@needs_java
class Flow(unittest.TestCase):
    def setUp(self):
        self._orig = grader.run_claude
        grader.run_claude = fake_run_claude

    def tearDown(self):
        grader.run_claude = self._orig

    def test_end_to_end(self):
        slug = "group-anagrams"
        with TestClient(main.app) as c:
            self.assertTrue(c.get("/api/code/status").json()["java_ok"])
            road = c.get("/api/code/roadmap").json()
            self.assertEqual(road["stats"]["total"], 160)
            self.assertEqual(len(road["phases"]), 20)  # 19 phases + the builds
            self.assertEqual(c.post(f"/api/code/problems/{slug}/attempts", json={}).status_code, 409)  # nothing written yet
            self.assertEqual(c.post("/api/code/generate", json={"slugs": [slug]}).json()["queued"], 1)
            wait(lambda: c.get(f"/api/code/problems/{slug}").json()["problem"]["spec"] == "ready")
            self.assertEqual(CALLS[:2], ["code_brief", "code_spec"])  # the statement is written first, then the tests against it
            d = c.get(f"/api/code/problems/{slug}").json()
            self.assertNotIn("reference_solution", json.dumps(d))  # secrets never leave the server
            self.assertNotIn("brute_solution", json.dumps(d))
            self.assertEqual(c.post("/api/code/generate", json={"slugs": [slug]}).json()["queued"], 0)  # already ready
            aid = c.post(f"/api/code/problems/{slug}/attempts", json={}).json()["id"]
            self.assertEqual(c.post(f"/api/code/problems/{slug}/attempts", json={}).json()["id"], aid)  # reopens the unfinished one
            self.assertEqual(c.get(f"/api/code/attempts/{aid}/writeup").status_code, 403)
            starter = d["spec"]["starter_code"]
            r = c.post(f"/api/code/attempts/{aid}/run", json={"code": starter, "kind": "run"}).json()
            self.assertEqual(r["verdict"]["status"], "failed")
            self.assertEqual(c.post(f"/api/code/attempts/{aid}/review", json={}).status_code, 200)  # a run exists, so a review can start
            hint = c.post(f"/api/code/attempts/{aid}/hint").json()
            self.assertEqual((hint["hint"], hint["remaining"]), ("h1", 2))
            r = c.post(f"/api/code/attempts/{aid}/run", json={"code": COUNT_EVEN, "kind": "submit"}).json()
            self.assertEqual(r["verdict"]["status"], "passed")
            self.assertTrue(r["solved"])
            ch = c.post(f"/api/code/attempts/{aid}/coach", json={"question": "why?", "code": COUNT_EVEN}).json()
            self.assertEqual(ch["hints_used"], 2)
            wait(lambda: c.get(f"/api/code/hints/{ch['hint_id']}").json()["status"] == "done")
            rv = c.post(f"/api/code/attempts/{aid}/review", json={"code": COUNT_EVEN, "explanation": "single pass"}).json()
            res = wait(lambda: (lambda x: x if x["status"] == "done" else None)(c.get(f"/api/code/reviews/{rv['id']}").json()))["result"]
            self.assertEqual(res["overall_score"], 3.0)  # 3.5 from the model, capped because hints were used
            self.assertEqual(res["caps_applied"][0]["cap"], 3.0)
            tags = [g["tag"] for g in res["gaps"]]
            self.assertIn("ops.memory_bounds", tags)
            self.assertIn("other.up_tag", tags)  # an unknown tag is namespaced, not stored as-is
            self.assertEqual(c.post(f"/api/code/attempts/{aid}/review", json={"code": COUNT_EVEN, "explanation": "single pass"}).json()["id"], rv["id"])  # cached
            p = c.get("/api/code/progress").json()
            self.assertEqual(p["stats"]["done"], 1)
            self.assertEqual(p["stats"]["clean"], 0)  # solved with hints
            self.assertEqual(p["needs_review"][0]["slug"], slug)
            self.assertEqual(p["recent"][0]["slug"], slug)  # the problem just worked on is first
            self.assertEqual(p["recent"][0]["last_run"]["status"], "passed")
            self.assertGreater(p["recent"][0]["last_worked"], time.time() - 120)
            self.assertEqual([r["slug"] for r in p["recent"]], [slug])  # untouched problems are not "recent"
            self.assertEqual([t["score"] for t in p["timeline"]], [2.0, 3.0])  # the failing starter was capped at 2.0, the solved attempt at 3.0
            sol = c.post(f"/api/code/attempts/{aid}/solution").json()
            self.assertIn("class Solution", sol["reference_solution"])
            self.assertEqual(c.get(f"/api/code/attempts/{aid}").json()["solution_viewed"], 0)  # looking after solving costs nothing
            aid2 = c.post(f"/api/code/problems/{slug}/attempts", json={"restart": True}).json()["id"]
            c.post(f"/api/code/attempts/{aid2}/solution")
            self.assertEqual(c.get(f"/api/code/attempts/{aid2}").json()["rating"], "solution")
            self.assertEqual(c.delete(f"/api/code/attempts/{aid2}").status_code, 200)
            self.assertEqual(c.post(f"/api/code/attempts/{aid}/run", json={"code": "x" * 300_000}).status_code, 413)


if __name__ == "__main__":
    unittest.main()
