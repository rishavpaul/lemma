"""Improvement-areas job with the model call stubbed. Run: .venv/bin/python -m unittest discover tests"""
import json
import os
import tempfile
import time
import unittest

os.environ["SD_COACH_HOME"] = tempfile.mkdtemp()

from fastapi.testclient import TestClient  # noqa: E402

from app import config, db, grader, main  # noqa: E402

CALLS: list[str] = []
RESULT = {"summary": "s", "concepts": [{"concept": "Quorum reads", "area": "Replication", "why": "w", "key_ideas": ["R+W>N"],
                                         "study": "DDIA ch. 5", "sessions": [1]}]}


async def fake_run_claude(kind, system, payload, schema, model, timeout, cpath="", validator=None, ref=None, web=True):
    CALLS.append(payload)
    return {"ok": True, "structured": RESULT, "raw": {}, "duration_s": 0.1, "error_kind": None, "error": None}


def grade() -> dict:
    return {"overall_score": 2.5, "overall_level": "senior", "verdict": "v", "drill_for_next_session": "drill", "strengths": ["s"],
            "dimension_scores": {d: {"score": 2.5, "rationale": "r"} for d in config.DIMENSIONS}}


class Improvement(unittest.TestCase):
    def test_flow(self):
        grader.run_claude = fake_run_claude
        with TestClient(main.app) as c:
            self.assertEqual(c.post("/api/improvements", json={"k": 5}).status_code, 400)  # nothing graded yet
            self.assertIsNone(c.get("/api/improvements/latest").json())
            qid = db.one("SELECT id FROM questions LIMIT 1")["id"]
            for i in range(3):
                sid = db.execute("INSERT INTO sessions(question_id,status,started_at) VALUES(?,'done',?)", (qid, time.time() + i))
                db.execute("INSERT INTO session_grades(session_id,model,status,result_json,created_at) VALUES(?,?,?,?,?)",
                           (sid, "m", "done", json.dumps(grade()), time.time()))
                db.execute("INSERT INTO gaps(session_id,section_key,tag,description,severity,source) VALUES(?,?,?,?,?,'section')",
                           (sid, "scope", "estimates.not_used", "never used", "high"))
            r = c.post("/api/improvements", json={"k": 2})
            self.assertEqual(r.status_code, 200)
            rid = r.json()["id"]
            for _ in range(80):
                rep = c.get(f"/api/improvements/{rid}").json()
                if rep["status"] == "done":
                    break
                time.sleep(0.1)
            self.assertEqual(rep["status"], "done")
            self.assertEqual(len(rep["session_ids"]), 2)  # only the last k
            self.assertEqual(rep["model"], "opus")
            self.assertEqual(rep["result"]["concepts"][0]["concept"], "Quorum reads")
            self.assertIn("estimates.not_used", CALLS[0])
            # same window again is served from the cache; force re-runs
            self.assertEqual(c.post("/api/improvements", json={"k": 2}).json()["id"], rid)
            self.assertEqual(len(CALLS), 1)
            self.assertNotEqual(c.post("/api/improvements", json={"k": 2, "force": True}).json()["id"], rid)
            self.assertEqual(c.get("/api/improvements/latest").json()["k"], 2)
            # clearing a report
            last = c.get("/api/improvements/latest").json()["id"]
            self.assertEqual(c.delete(f"/api/improvements/{last}").status_code, 200)
            self.assertEqual(c.get(f"/api/improvements/{last}").status_code, 404)
            # an explicit selection and model
            chosen = [s["session_id"] for s in db.rows("SELECT session_id FROM session_grades ORDER BY session_id")][:1]
            r = c.post("/api/improvements", json={"session_ids": chosen + [9999], "model": "sonnet"}).json()
            self.assertEqual(r["session_ids"], chosen)  # unknown ids dropped
            self.assertEqual(c.post("/api/improvements", json={"session_ids": [9999]}).status_code, 400)
            self.assertEqual(c.post("/api/improvements", json={"session_ids": chosen, "model": "nope"}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
