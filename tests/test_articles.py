"""Article explain/ask flow with the model call stubbed. Run: .venv/bin/python -m unittest discover tests"""
import os
import tempfile
import unittest

os.environ["SD_COACH_HOME"] = tempfile.mkdtemp()

from fastapi.testclient import TestClient  # noqa: E402

from app import grader, main  # noqa: E402

CALLS: list[tuple[str, str, str]] = []
PICK: dict = {"article_id": None, "reason": "none fits"}


async def fake_run_claude(kind, system, payload, schema, model, timeout, cpath="", validator=None, ref=None, web=True):
    CALLS.append((kind, model, payload))
    out = {"article_pick": PICK,
           "article_write": {"title": "Quorum reads", "summary": "R+W>N", "body": "body"},
           "article_ask": {"answer": "because"}}[kind]
    return {"ok": True, "structured": out, "raw": {}, "duration_s": 0.1, "error_kind": None, "error": None}


class Knowledge(unittest.TestCase):
    def test_flow(self):
        grader.run_claude = fake_run_claude
        with TestClient(main.app) as c:
            body = {"concept": "Quorum reads", "model": "free"}
            from app import db
            qid = db.one("SELECT id FROM questions LIMIT 1")["id"]
            sid = db.execute("INSERT INTO sessions(question_id,status,started_at) VALUES(?,'done',1)", (qid,))
            r = c.post("/api/articles/explain", json=dict(body, session_ids=[sid])).json()
            self.assertEqual([q["id"] for q in r["article"]["questions"]], [qid])
            self.assertEqual([q["id"] for q in c.get("/api/articles").json()[0]["questions"]], [qid])
            self.assertTrue(r["created"])
            self.assertEqual([k for k, _, _ in CALLS], ["article_write"])  # empty graph: no pick call
            self.assertIn("nemotron", CALLS[0][1])
            aid = r["article"]["id"]

            PICK.update(article_id=aid)
            r = c.post("/api/articles/explain", json=dict(body, model="opus")).json()
            self.assertFalse(r["created"])
            self.assertEqual(r["article"]["id"], aid)
            self.assertIn(f"[{aid}] Quorum reads: R+W>N", CALLS[-1][2])  # article list sent

            PICK.update(article_id=None)  # model says nothing fits; title collides, so the existing article is reused
            self.assertFalse(c.post("/api/articles/explain", json=body).json()["created"])

            self.assertEqual(c.get("/api/articles").json()[0]["title"], "Quorum reads")
            e = c.put(f"/api/articles/{aid}", json={"title": "Quorums", "summary": "s", "body": "new"}).json()
            self.assertEqual(e["body"], "new")
            self.assertEqual(c.post(f"/api/articles/{aid}/ask", json={"question": "why?", "model": "sonnet"}).json()["answer"], "because")
            self.assertEqual(c.post("/api/articles/explain", json={"concept": "x", "model": "gpt"}).status_code, 400)
            self.assertEqual(c.post("/api/articles/explain", json={"concept": " ", "model": "opus"}).status_code, 400)
            self.assertEqual(c.delete(f"/api/articles/{aid}").status_code, 200)
            self.assertEqual(c.get(f"/api/articles/{aid}").status_code, 404)


if __name__ == "__main__":
    unittest.main()
