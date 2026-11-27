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


# Every generated problem is one class with 4 levels; this is the fixture for the generation and end-to-end flow.
STAGED = """import java.util.*;
class EvenCounter {
    private final List<Integer> xs = new ArrayList<>();
    public void add(int x) { xs.add(x); }
    public int countEven() { int n = 0; for (int x : xs) if (x % 2 == 0) n++; return n; }
    public int countOdd() { return xs.size() - countEven(); }
    public boolean remove(int x) { return xs.remove(Integer.valueOf(x)); }
    public void reset() { xs.clear(); }
}"""
STAGED_BRUTE = """import java.util.*;
class EvenCounter {
    private LinkedList<Integer> items = new LinkedList<>();
    public void add(int x) { items.addLast(x); }
    public int countEven() { int c = 0; for (int i = 0; i < items.size(); i++) { if (Math.floorMod(items.get(i), 2) == 0) c += 1; } return c; }
    public int countOdd() { int c = 0; for (int i = 0; i < items.size(); i++) { if (Math.floorMod(items.get(i), 2) == 1) c += 1; } return c; }
    public boolean remove(int x) { for (int i = 0; i < items.size(); i++) { if (items.get(i) == x) { items.remove(i); return true; } } return false; }
    public void reset() { items = new LinkedList<>(); }
}"""
STAGED_STARTER = ("class EvenCounter {\n    public void add(int x) {}\n    public int countEven() { return 0; }\n    public int countOdd() { return 0; }\n"
                  "    public boolean remove(int x) { return false; }\n    public void reset() {}\n}")
GEN_STAGED = ("def gen(rng, size, level=1):\n"
              "    names = ['add', 'add', 'countEven'] + (['countOdd'] if level >= 2 else []) + (['remove'] if level >= 3 else []) + (['reset'] if level >= 4 else [])\n"
              "    ops = [['EvenCounter', []]]\n"
              "    for _ in range(rng.randint(1, size)):\n"
              "        m = rng.choice(names)\n"
              "        ops.append([m, [rng.randint(-9, 9)]] if m in ('add', 'remove') else [m, []])\n"
              "    return ops\n")


def _ops(*ops):
    return [["EvenCounter", []], *[[m, list(a)] for m, *a in ops]]


def staged_spec(**over) -> dict:
    lv = lambda n, title, methods: {"n": n, "title": title, "statement_md": title + ".", "methods_added": methods}  # noqa: E731
    s = spec(kind="design", class_name="EvenCounter", method="", statement_md="Keep a list of integers and count the even ones.",
             starter_code=STAGED_STARTER, reference_solution=STAGED, brute_solution=STAGED_BRUTE, generator_py=GEN_STAGED, perf_size=300,
             examples=[{"input": _ops(("add", 2), ("add", 3), ("countEven",)), "expected": [None, None, None, 1], "explanation": "2 is even", "level": 1},
                       {"input": _ops(("add", 1), ("countOdd",)), "expected": [None, None, 1], "explanation": "1 is odd", "level": 2},
                       {"input": _ops(("add", 4), ("remove", 4), ("remove", 4), ("countEven",)), "expected": [None, None, True, False, 0], "explanation": "once", "level": 3},
                       {"input": _ops(("add", 2), ("reset",), ("countEven",)), "expected": [None, None, None, 0], "explanation": "cleared", "level": 4}],
             edge_cases=[{"name": "empty", "input": _ops(("countEven",)), "level": 1}, {"name": "negatives", "input": _ops(("add", -2), ("add", -1), ("countEven",)), "level": 1}],
             levels=[lv(1, "Count evens", ["void add(int x)", "int countEven()"]), lv(2, "Count odds", ["int countOdd()"]),
                     lv(3, "Remove", ["boolean remove(int x)"]), lv(4, "Reset", ["void reset()"])])
    s.update(over)
    return s


def _c(title, anchor="", find="", replace="", kind="clarity"):
    return {"severity": "low", "kind": kind, "title": title, "comment": "c", "anchor": anchor, "find": find, "replace": replace}


# Every outcome a suggested edit can have, against COUNT_EVEN.
REVIEW_COMMENTS = [
    _c("bit test", find="if (x % 2 == 0) n++;", replace="if ((x & 1) == 0) n++;"),           # passes
    _c("off by one", find="return n;", replace="return n + 1;", kind="bug"),                # breaks the tests
    _c("typo", find="int n = 0;", replace="int n = 0"),                                     # does not compile
    _c("ghost", find="return total;", replace="return 0;"),                                 # not in the code
    _c("loop", anchor="for (int x :   xs)"),                                                # comment only, odd spacing
    _c("whole solution"),                                                                   # not pinned to code
]


def review_result(score=3.5) -> dict:
    dim = {"score": 3.5, "assessed": True, "rationale": "r"}
    return {"verdict_kind": "correct_optimal", "overall_score": score, "overall_level": "staff", "hire_signal": "strong_hire", "summary": "Solid.",
            "dimension_scores": {k: dict(dim) for k in ("correctness", "algorithm_and_complexity", "code_quality", "design_and_extensibility",
                                                        "production_awareness", "communication")},
            "complexity": {"your_time": "O(n)", "your_space": "O(1)", "optimal_time": "O(n)", "optimal_space": "O(1)", "note": "n"},
            "strengths": ["clear"], "comments": REVIEW_COMMENTS,
            "interviewer_follow_ups": [], "gaps": [{"tag": "ops.memory_bounds", "description": "d", "severity": "low"}, {"tag": "made.up_tag", "description": "x", "severity": "low"}]}


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

    def test_case_level_follows_methods_it_calls(self):
        levels = [{"n": 1, "methods_added": ["LRUCache(int c)", "void put(int k, int v)"]},
                  {"n": 2, "methods_added": ["void put(int k, int v, int ttl)"]},
                  {"n": 3, "methods_added": ["List<String> drain()"]},
                  {"n": 4, "methods_added": ["int[] stats()"]}]
        cases = [{"level": 3, "input": [["LRUCache", [1]], ["put", [1, 1, 2]], ["drain", []], ["stats", []]]},
                 {"level": 3, "input": [["LRUCache", [1]], ["put", [1, 1]], ["drain", []]]},
                 {"level": 1, "input": [["LRUCache", [1]], ["put", [1, 1, 2]]]}]
        self.assertEqual(generate.raise_case_levels(cases, levels), 2)
        self.assertEqual([c["level"] for c in cases], [4, 3, 2])

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
            for path in ("run", "hint", "coach", "solution"):
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
        self.assertIsNone(generate.validate_spec(staged_spec(), schema, problem))
        self.assertIn("kind must be design", generate.validate_spec(spec(), schema, problem))  # a single function is no longer a problem shape
        self.assertIn("class named", generate.validate_spec(staged_spec(brute_solution="class Other {}"), schema, problem))
        self.assertIn("levels must have", generate.validate_spec(staged_spec(levels=staged_spec()["levels"][:1]), schema, problem))
        no_l4 = [e for e in staged_spec()["examples"] if e["level"] != 4]
        self.assertIn("level(s) [4]", generate.validate_spec(staged_spec(examples=no_l4), schema, problem))
        self.assertIn("perf_size", generate.validate_spec(staged_spec(perf_size=3), schema, problem))


CALLS: list[str] = []


async def fake_run_claude(kind, system, payload, schema, model, timeout, cpath="", validator=None, ref=None, web=True):
    CALLS.append(kind)
    if kind == "code_brief":
        out = {k: staged_spec()[k] for k in ("kind", "class_name", "method", "inplace_param", "statement_md", "constraints", "starter_code", "levels")}
    elif kind == "code_spec":
        out = staged_spec()
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
            # Levels are groups of tests: each passing submit unlocks the next level's tests; passing level 4 solves the problem.
            unlocked = []
            for _ in range(4):
                r = c.post(f"/api/code/attempts/{aid}/run", json={"code": STAGED, "kind": "submit"}).json()
                self.assertEqual(r["verdict"]["status"], "passed")
                self.assertEqual({x["level"] for x in r["verdict"]["cases"]}, set(range(1, r["level"] + 1)))  # levels 1..current, cumulative
                unlocked.append(r["unlocked"])
            self.assertEqual(unlocked, [2, 3, 4, None])
            self.assertTrue(r["solved"])
            example = next(x for x in d["spec"]["cases"] if x["kind"] == "example")
            t = c.post(f"/api/code/attempts/{aid}/trace", json={"code": STAGED, "case_id": example["id"]}).json()
            self.assertTrue(t["steps"] and t["passed"], t.get("error"))
            self.assertIn("EvenCounter.countEven", {f["method"] for st in t["steps"] for f in st["frames"]})
            self.assertEqual(c.post(f"/api/code/attempts/{aid}/trace", json={"code": STAGED, "case_id": "nope"}).status_code, 404)
            ch = c.post(f"/api/code/attempts/{aid}/coach", json={"question": "why?", "code": STAGED}).json()
            self.assertEqual(ch["hints_used"], 2)
            wait(lambda: c.get(f"/api/code/hints/{ch['hint_id']}").json()["status"] == "done")
            rv = c.post(f"/api/code/attempts/{aid}/review", json={"code": STAGED, "explanation": "single pass"}).json()
            res = wait(lambda: (lambda x: x if x["status"] == "done" else None)(c.get(f"/api/code/reviews/{rv['id']}").json()))["result"]
            self.assertEqual(res["overall_score"], 3.0)  # 3.5 from the model, capped because hints were used
            cm = {x["title"]: x for x in res["comments"]}
            self.assertEqual(cm["bit test"]["edit"]["check"]["status"], "passes")
            self.assertEqual(cm["bit test"]["line_start"], 5)
            self.assertEqual(cm["off by one"]["edit"]["check"]["status"], "fails")
            self.assertEqual(cm["typo"]["edit"]["check"]["status"], "compile_error")
            self.assertIsNone(cm["ghost"]["edit"])
            self.assertIn("could not be matched", cm["ghost"]["edit_problem"])
            self.assertEqual((cm["loop"]["line_start"], cm["loop"]["edit"]), (5, None))  # found despite the spacing
            self.assertIsNone(cm["whole solution"]["line_start"])
            self.assertEqual(c.get(f"/api/code/reviews/{rv['id']}").json()["code"], STAGED)
            self.assertEqual(res["caps_applied"][0]["cap"], 3.0)
            tags = [g["tag"] for g in res["gaps"]]
            self.assertIn("ops.memory_bounds", tags)
            self.assertIn("other.up_tag", tags)  # an unknown tag is namespaced, not stored as-is
            self.assertEqual(c.post(f"/api/code/attempts/{aid}/review", json={"code": STAGED, "explanation": "single pass"}).json()["id"], rv["id"])  # cached
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
            self.assertIn("class EvenCounter", sol["reference_solution"])
            self.assertEqual(c.get(f"/api/code/attempts/{aid}").json()["solution_viewed"], 0)  # looking after solving costs nothing
            aid2 = c.post(f"/api/code/problems/{slug}/attempts", json={"restart": True}).json()["id"]
            c.post(f"/api/code/attempts/{aid2}/solution")
            self.assertEqual(c.get(f"/api/code/attempts/{aid2}").json()["rating"], "solution")
            self.assertEqual(c.delete(f"/api/code/attempts/{aid2}").status_code, 200)
            self.assertEqual(c.post(f"/api/code/attempts/{aid}/run", json={"code": "x" * 300_000}).status_code, 413)


if __name__ == "__main__":
    unittest.main()


LRU = """import java.util.*;
class LRUCache {
    static class Node { int key, val; Node prev, next; Node(int k, int v) { key = k; val = v; } }
    private final Map<Integer, Node> map = new HashMap<>();
    private final Node head = new Node(-1, -1), tail = new Node(-1, -1);
    private final int cap;
    public LRUCache(int capacity) { cap = capacity; head.next = tail; tail.prev = head; }
    public int get(int key) {
        Node n = map.get(key);
        if (n == null) return -1;
        unlink(n);
        front(n);
        return n.val;
    }
    public void put(int key, int value) {
        Node n = map.get(key);
        if (n != null) { n.val = value; unlink(n); front(n); return; }
        if (map.size() == cap) { Node lru = tail.prev; unlink(lru); map.remove(lru.key); }
        n = new Node(key, value);
        map.put(key, n);
        front(n);
    }
    private void unlink(Node n) { n.prev.next = n.next; n.next.prev = n.prev; }
    private void front(Node n) { n.next = head.next; n.prev = head; head.next.prev = n; head.next = n; }
}
"""
OPS = [["LRUCache", [2]], ["put", [1, 1]], ["put", [2, 2]], ["get", [1]], ["put", [3, 3]], ["get", [2]]]


@needs_java
class Trace(unittest.TestCase):
    def trace(self, code: str, cls: str, kind: str, method: str, inp) -> dict:
        return asyncio.run(runner.trace_case({f"{cls}.java": code}, cls, kind, method, None, {"id": "c1", "input": inp}))

    def test_design_class_with_collections(self):
        t = self.trace(LRU, "LRUCache", "design", "", OPS)
        self.assertIsNone(t["error"])
        self.assertFalse(t["truncated"])
        self.assertEqual(t["result"]["result"], [None, None, None, 1, None, -1])
        self.assertEqual([s["value"]["v"] for s in t["steps"] if s["kind"] == "return"], ["1", "-1"])
        last = t["steps"][-1]
        maps = [h for h in last["heap"].values() if h["type"] == "HashMap"]
        self.assertEqual(maps[0]["size"], 2)
        self.assertEqual(sorted(k["v"] for k, _ in maps[0]["entries"]), ["1", "3"])  # 2 was evicted
        self.assertTrue(any(f["method"] == "new Node" for s in t["steps"] for f in s["frames"]))
        nodes = [h for h in last["heap"].values() if h["type"] == "LRUCache.Node"]
        self.assertIn("prev", [f for f, _ in nodes[0]["fields"]])

    def test_exception_is_recorded(self):
        code = "class Solution {\n  public int f(int[] a) {\n    int s = 0;\n    for (int i = 0; i <= a.length; i++) s += a[i];\n    return s;\n  }\n}\n"
        t = self.trace(code, "Solution", "function", "f", [[1, 2]])
        ex = [s for s in t["steps"] if s["kind"] == "exception"]
        self.assertTrue(ex)
        self.assertIn("ArrayIndexOutOfBoundsException", ex[0]["value"])
        self.assertEqual(ex[0]["line"], 4)
        self.assertEqual(t["result"]["status"], "error")

    def test_infinite_loop_is_cut_off(self):
        code = "class Solution {\n  public int f(int n) {\n    int i = 0;\n    while (n > 0) {\n      i++;\n    }\n    return i;\n  }\n}\n"
        t0 = time.time()
        t = self.trace(code, "Solution", "function", "f", [1])
        self.assertTrue(t["truncated"])
        self.assertEqual(len(t["steps"]), runner.TRACE_MAX_STEPS)
        self.assertLess(time.time() - t0, 60)

    def test_compile_error(self):
        t = self.trace("class Solution { int f( }", "Solution", "function", "f", [1])
        self.assertFalse(t["compile"]["ok"])
        self.assertEqual(t["steps"], [])


class ReviewEdits(unittest.TestCase):
    def test_locate(self):
        from app.code import review_edits
        code = "a = 1;\nif (a  ==  1) {\n  b();\n}\nb();\n"
        self.assertEqual(review_edits.locate(code, "a = 1;")[:2], (0, 6))
        hit = review_edits.locate(code, "if (a == 1) {")  # whitespace differs
        self.assertEqual(code[hit[0]:hit[1]], "if (a  ==  1) {")
        self.assertEqual(review_edits.locate(code, "b();")[2], 2)  # two matches
        self.assertIsNone(review_edits.locate(code, "c();"))
        self.assertIsNone(review_edits.locate(code, "  "))

    def test_overlapping_edits_keep_the_first(self):
        from app.code import review_edits
        r = {"comments": [_c("a", find="int n = 0;", replace="int n = 1;"), _c("b", find="int n = 0; for", replace="x")]}
        review_edits.attach(r, COUNT_EVEN)
        self.assertIsNotNone(r["comments"][0]["edit"])
        self.assertIsNone(r["comments"][1]["edit"])
        self.assertIn("overlaps", r["comments"][1]["edit_problem"])


class ReviewUpgrade(unittest.TestCase):
    def test_old_reviews_become_comments(self):
        from app.code import review_edits
        old = {"summary": "s", "issues": [{"severity": "high", "title": "t", "detail": "d", "quote": "return n;", "fix": "f"}],
               "staff_gaps": [{"area": "a", "gap": "g", "what_staff_does": "w"}], "improvements": [{"title": "i", "why": "y", "code": "x();"}]}
        new = review_edits.upgrade(old, COUNT_EVEN)
        self.assertNotIn("issues", new)
        self.assertEqual([c["kind"] for c in new["comments"]], ["bug", "staff_gap", "clarity"])
        self.assertEqual(new["comments"][0]["line_start"], 3)
        self.assertTrue(all(c["edit"] is None for c in new["comments"]))
        self.assertIs(review_edits.upgrade(new, COUNT_EVEN), new)  # already in the new format


class Stages(unittest.TestCase):
    def test_regular_problems_can_have_levels(self):
        db.sync_problems()
        p = db.one("SELECT * FROM problems WHERE slug='lru-cache'")
        self.assertFalse(p["is_build"])
        self.assertEqual(generate._n_levels(p), 4)
        entry = generate._entry(p, {"name": "n", "why": "w"}, {})
        self.assertIn("Level 1 is the original problem", entry)
        self.assertIn("level 4 (staff)", entry)
        plain = db.one("SELECT * FROM problems WHERE slug='group-anagrams'")
        self.assertEqual(generate._n_levels(plain), 4)  # every problem has 4 levels
        self.assertIn("design all 4", generate._entry(plain, {"name": "n", "why": "w"}, {}))


class StarterLabels(unittest.TestCase):
    def test_each_stub_is_labelled_with_its_level(self):
        starter = ("class C {\n    public C(int n) {}\n    public int get(int k) { return 0; }\n    // Level 2\n"
                   "    public void put(int k, int v) {}\n    public void put(int k, int v, int ttl) {}\n    public List<Map<String, Integer>> dump() { return null; }\n}")
        levels = [{"n": 1, "title": "Basics", "methods_added": ["C(int n)", "int get(int k)", "void put(int k, int v)"]},
                  {"n": 2, "title": "TTL.", "methods_added": ["void put(int k, int v, int ttl)"]},
                  {"n": 3, "title": "Dump", "methods_added": ["List<Map<String, Integer>> dump()"]}]
        out = generate.annotate_starter(starter, levels)
        lines = out.split("\n")
        self.assertEqual(lines[lines.index("    public void put(int k, int v, int ttl) {}") - 1], "    /** Level 2: TTL. */")  # overload by arity
        self.assertEqual(lines[lines.index("    public void put(int k, int v) {}") - 1], "    /** Level 1: Basics. */")  # replaces the model's marker
        self.assertNotIn("// Level 2", out)
        self.assertIn("    /** Level 3: Dump. */", out)
        self.assertEqual(generate.annotate_starter(out, levels), out)  # labelling twice changes nothing
