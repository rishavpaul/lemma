"""Probe flow with the model call stubbed. Run: .venv/bin/python -m unittest discover tests"""
import json
import os
import tempfile
import time
import unittest

os.environ["SD_COACH_HOME"] = tempfile.mkdtemp()

from fastapi.testclient import TestClient  # noqa: E402

from app import db, grader, main, prompts  # noqa: E402

CALLS: list[tuple[str, str]] = []


async def fake_run_claude(kind, system, payload, schema, model, timeout, cpath="", validator=None, ref=None):
    CALLS.append((kind, payload))
    return {"ok": True, "structured": {"question": "What if the cache dies?", "hint": "Think about stampedes."},
            "raw": {}, "duration_s": 0.1, "error_kind": None, "error": None}


class ProbeFlow(unittest.TestCase):
    def test_flow(self):
        grader.run_claude = fake_run_claude
        with TestClient(main.app) as c:
            qid = c.get("/api/questions").json()
            qid = (qid["questions"] if isinstance(qid, dict) else qid)[0]["id"]
            sid = c.post("/api/sessions", json={"question_id": qid}).json()["id"]
            secs = c.get(f"/api/sessions/{sid}").json()["sections"]
            keys = [s["key"] for s in secs]
            for i, s in enumerate(secs[:4]):
                db.execute("UPDATE sections SET status='saved', transcript_edited=? WHERE id=?", (f"answer {i + 1}", s["id"]))
            url = lambda i: f"/api/sessions/{sid}/sections/{keys[i]}/probe"

            # needs the answer key
            self.assertEqual(c.post(url(1)).status_code, 409)
            db.execute("INSERT INTO research(question_id,status,brief_json,brief_md,model,created_at) VALUES(?,?,?,?,?,?)",
                       (qid, "done", json.dumps({"k": 1}), "", "t", time.time()))

            def probed(i):
                self.assertEqual(c.post(url(i)).status_code, 200)
                for _ in range(80):
                    p = c.get(f"/api/sessions/{sid}").json()["sections"][i]["probe"]
                    if p and p["question"]:
                        return
                    time.sleep(0.1)
                self.fail("probe never produced a question")

            probed(1)
            self.assertEqual(c.post(url(1)).status_code, 409)  # one probe per section
            self.assertEqual(c.post(f"/api/sessions/{sid}/finish").status_code, 400)  # open probe blocks finishing
            self.assertEqual(c.put(url(1) + "/answer", json={"text": "  "}).status_code, 400)
            self.assertEqual(c.put(url(1) + "/answer", json={"text": "coalesce requests"}).status_code, 200)
            self.assertEqual(c.delete(url(1)).status_code, 409)  # an asked probe cannot be skipped

            probed(3)
            first, second = (p for k, p in CALLS if k == "probe")
            self.assertIn("answer 2", first.split("<window>")[1])
            self.assertNotIn("answer 3", first)
            # second window starts after the section already probed; the first exchange is earlier context
            window = second.split("<window>")[1]
            self.assertIn("answer 3", window)
            self.assertIn("answer 4", window)
            self.assertNotIn("answer 2", window)
            self.assertIn("coalesce requests", second.split("<window>")[0])

            # grading: deferred while probed, queued once the probe is answered; unprobed sections are queued on save
            graded = lambda i: db.one("SELECT 1 FROM jobs WHERE type='grade_section' AND ref_id=?", (secs[i]["id"],)) is not None
            self.assertTrue(graded(1))  # answered above
            self.assertFalse(graded(3))  # probed, not answered yet
            self.assertEqual(c.put(url(3) + "/answer", json={"text": "use a lease"}).status_code, 200)
            self.assertTrue(graded(3))
            r = c.put(f"/api/sessions/{sid}/sections/{keys[0]}/transcript", json={"text": "plain save"})
            self.assertIsNotNone(r.json()["job_id"])
            r = c.put(f"/api/sessions/{sid}/sections/{keys[2]}/transcript", json={"text": "to be probed", "defer_grading": True})
            self.assertIsNone(r.json()["job_id"])
            self.assertFalse(graded(2))
            self.assertEqual(c.delete(f"/api/sessions/{sid}").status_code, 200)

    def test_probed_section_prompt_is_self_contained(self):
        fw = {"key": "k", "title": "K", "cover": ["c"], "staff_bar": "bar"}
        probe = {"question": "Q?", "hint": "H", "answer": "A"}
        txt = prompts.section(fw, "anchors", None, {"title": "K", "text": "initial", "budget_sec": 60}, None, probe)
        self.assertIn("judge this section on its own", txt)
        self.assertIn("initial", txt)
        self.assertIn("Candidate's answer: A", txt)
        self.assertIn("needing the hint lowers the final score", txt)
        plain = prompts.section(fw, "anchors", [], {"title": "K", "text": "x", "budget_sec": 60})
        self.assertNotIn("PROMPTED FOLLOW-UP", plain)
        self.assertNotIn("needing the hint", plain)

    def test_graders_see_probe_as_prompted(self):
        probe = {"question": "Q?", "hint": "H", "answer": "A"}
        self.assertIn("PROMPTED FOLLOW-UP", prompts.probe_text(probe))
        self.assertEqual(prompts.probe_text(None), "")
        fw = {"key": "k", "title": "K", "cover": ["c"], "staff_bar": "bar"}
        txt = prompts.section(fw, "anchors", [{"title": "E", "text": "t", "probe": probe}],
                              {"title": "K", "text": "x", "budget_sec": 60})
        self.assertIn("Candidate's answer: A", txt)
        self.assertIn("less credit", txt)
        h = prompts.holistic([{"title": "E", "text": "t", "probe": probe, "budget_sec": 60, "grade": None}], [])
        self.assertIn("Candidate's answer: A", h)


if __name__ == "__main__":
    unittest.main()


class StableContext(unittest.TestCase):
    def test_brief_lives_in_stable_context_not_payload(self):
        q = {"title": "T", "prompt": "P", "crux_hints": ""}
        brief = {"summary": "BRIEFMARK"}
        ctx = prompts.stable_context(q, brief, {"tags": {"a.b": "desc"}})
        self.assertIn("BRIEFMARK", ctx)
        self.assertIn("a.b: desc", ctx)
        self.assertEqual(ctx, prompts.stable_context(q, brief, {"tags": {"a.b": "desc"}}))  # byte-stable, or the cache misses
        fw = {"key": "k", "title": "K", "cover": ["c"], "staff_bar": "bar"}
        self.assertNotIn("BRIEFMARK", prompts.section(fw, "anchors", [], {"title": "K", "text": "x", "budget_sec": 60}))
