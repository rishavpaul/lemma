"""Behavioral track: question bank, drafts, stories, graded attempts (model stubbed) and behavioral program items.
Run: .venv/bin/python -m unittest discover tests"""
import os
import tempfile
import time
import unittest

os.environ["LEMMA_HOME"] = tempfile.mkdtemp()
os.environ["LEMMA_TTS"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app import db, grader, main  # noqa: E402

CALLS: list[tuple[str, str]] = []
RESULT = {"overall_score": 3.5, "level_signal": "staff", "answers_the_question": True, "summary": "Strong scope; add numbers.",
          "dimension_scores": {k: {"score": 3, "assessed": True, "rationale": "ok"} for k in
                               ("scope_impact", "ownership", "influence_leadership", "judgment", "self_awareness", "structure_clarity")},
          "strengths": ["clear I vs we"], "gaps": [{"issue": "no metric", "quote": "", "fix": "add p99"}],
          "follow_ups": ["What would you change?"], "stronger_outline": "- S: ..."}


async def fake_run_claude(kind, system, payload, schema, model, timeout, cpath="", validator=None, ref=None, web=True):
    CALLS.append((kind, payload))
    return {"ok": True, "structured": dict(RESULT), "raw": {}, "duration_s": 0.1, "error_kind": None, "error": None}


ANSWER = ("I led the migration of our payments service off a shared database. Three teams depended on it and nobody owned the plan. "
          "I wrote the design doc, ran the dual writes and cut over with no downtime. p99 dropped from 900 to 120 milliseconds.")


class BehavioralTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        grader.run_claude = fake_run_claude
        cls.client = TestClient(main.app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)

    def wait_done(self, qid: int) -> dict:
        for _ in range(100):
            a = self.client.get(f"/api/behavioral/questions/{qid}").json()["attempts"][0]
            if a["status"] in ("done", "failed"):
                return a
            time.sleep(0.05)
        self.fail("review never finished")

    def test_bank_is_seeded(self):
        o = self.client.get("/api/behavioral").json()
        keys = {c["key"] for c in o["competencies"]}
        self.assertGreaterEqual(len(o["questions"]), 30)
        self.assertTrue(all(q["competency"] in keys for q in o["questions"]))
        self.assertTrue(all(q["status"] == "todo" for q in o["questions"]))

    def test_draft_story_and_review(self):
        c = self.client
        qid = c.get("/api/behavioral").json()["questions"][0]["id"]
        sid = c.post("/api/behavioral/stories", json={"title": "Payments DB split", "notes": "dual writes; 3 teams"}).json()["id"]
        self.assertEqual(c.put(f"/api/behavioral/questions/{qid}/draft", json={"text": "half an answer"}).status_code, 200)
        self.assertEqual(c.put(f"/api/behavioral/questions/{qid}/draft", json={"story_id": sid}).status_code, 200)
        q = c.get(f"/api/behavioral/questions/{qid}").json()
        self.assertEqual((q["draft"], q["story_id"]), ("half an answer", sid))  # each save changes only the fields it sends
        o = c.get("/api/behavioral").json()
        self.assertEqual(next(x for x in o["questions"] if x["id"] == qid)["status"], "attempted")
        self.assertEqual(next(s for s in o["stories"] if s["id"] == sid)["question_ids"], [qid])

        self.assertEqual(c.post(f"/api/behavioral/questions/{qid}/attempts", json={"text": "too short"}).status_code, 400)
        r = c.post(f"/api/behavioral/questions/{qid}/attempts", json={"text": ANSWER, "story_id": sid})
        self.assertEqual(r.status_code, 200)
        a = self.wait_done(qid)
        self.assertEqual(a["status"], "done")
        self.assertEqual(a["result"]["overall_score"], 3.5)
        kind, payload = CALLS[-1]
        self.assertEqual(kind, "behavioral_review")
        self.assertIn("<look_for>", payload)
        self.assertIn("Payments DB split", payload)
        self.assertIn("p99 dropped", payload)
        o = c.get("/api/behavioral").json()
        row = next(x for x in o["questions"] if x["id"] == qid)
        self.assertEqual((row["status"], row["last_score"], row["attempts"]), ("done", 3.5, 1))

        c.delete(f"/api/behavioral/stories/{sid}")
        self.assertIsNone(c.get(f"/api/behavioral/questions/{qid}").json()["story_id"])  # the draft survives without its story
        c.delete(f"/api/behavioral/attempts/{a['id']}")
        self.assertEqual(c.get(f"/api/behavioral/questions/{qid}").json()["attempts"], [])

    def test_off_topic_answer_is_capped(self):
        c = self.client
        qid = c.get("/api/behavioral").json()["questions"][1]["id"]
        RESULT["answers_the_question"] = False
        try:
            c.post(f"/api/behavioral/questions/{qid}/attempts", json={"text": ANSWER})
            self.assertEqual(self.wait_done(qid)["result"]["overall_score"], 2.0)
        finally:
            RESULT["answers_the_question"] = True

    def test_program_items_and_weekend_spread(self):
        c = self.client
        bq = [q["id"] for q in c.get("/api/behavioral").json()["questions"][:4]]
        pid = c.post("/api/programs", json={"name": "December"}).json()["id"]
        for q in bq:
            self.assertEqual(c.put(f"/api/programs/{pid}/items", json={"kind": "behavioral", "ref": str(q)}).status_code, 200)
        self.assertEqual(c.put(f"/api/programs/{pid}/items", json={"kind": "behavioral", "ref": "999999"}).status_code, 404)
        slugs = [r["slug"] for r in db.rows("SELECT slug FROM problems WHERE difficulty='Medium' ORDER BY ord LIMIT 8")]
        for s in slugs:
            c.put(f"/api/programs/{pid}/items", json={"kind": "code", "ref": s})
        p = c.get(f"/api/programs/{pid}").json()
        self.assertEqual([i["kind"] for i in p["items"][:4]], ["behavioral"] * 4)
        self.assertTrue(all(i["title"] for i in p["items"]))

        # Fri 2026-12-11 to Mon 2026-12-14: with weekends at 3x, Saturday and Sunday get most of the work.
        c.put(f"/api/programs/{pid}/schedule", json={"start_date": "2026-12-11", "end_date": "2026-12-14"})
        p = c.post(f"/api/programs/{pid}/schedule/spread", json={"weekend_weight": 3}).json()
        per_day = {d: sum(1 for i in p["items"] if i["day"] == d) for d in p["days"]}
        self.assertGreater(per_day["2026-12-12"] + per_day["2026-12-13"], per_day["2026-12-11"] + per_day["2026-12-14"])
        self.assertTrue(all(i["day"] for i in p["items"]))


if __name__ == "__main__":
    unittest.main()
