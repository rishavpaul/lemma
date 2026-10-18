"""Article explain/ask flow with the model call stubbed. Run: .venv/bin/python -m unittest discover tests"""
import os
import tempfile
import unittest

os.environ["LEMMA_HOME"] = tempfile.mkdtemp()
os.environ["LEMMA_TTS"] = "0"  # never download or load the speech model in tests

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
            self.assertEqual(c.get("/api/articles").json()[0]["status"], "pending")
            r = c.patch(f"/api/articles/{aid}", json={"status": "read", "rating": 4}).json()
            self.assertEqual((r["status"], r["rating"]), ("read", 4))
            self.assertIsNone(c.patch(f"/api/articles/{aid}", json={"rating": 0}).json()["rating"])
            self.assertEqual(c.patch(f"/api/articles/{aid}", json={"rating": 6}).status_code, 400)
            a = c.post(f"/api/articles/{aid}/comments", json={"body": "my note"}).json()
            c.post(f"/api/articles/{aid}/comments", json={"body": "ans", "question": "why?", "model": "sonnet"})
            self.assertEqual([x["body"] for x in c.get(f"/api/articles/{aid}").json()["comments"]], ["my note", "ans"])
            self.assertEqual(c.get(f"/api/articles/{aid}").json()["body"], "new")  # comments never touch the body
            self.assertEqual(c.post(f"/api/articles/{aid}/comments", json={"body": " "}).status_code, 400)
            self.assertEqual(len(c.delete(f"/api/articles/{aid}/comments/{a['comments'][0]['id']}").json()["comments"]), 1)
            self.assertEqual(c.delete(f"/api/articles/{aid}/comments/9999").status_code, 404)
            self.assertEqual(c.post(f"/api/articles/{aid}/ask", json={"question": "why?", "model": "sonnet"}).json()["answer"], "because")
            url = f"/api/articles/{aid}/ask"
            c.post(url, json={"question": "plain?"})
            p = CALLS[-1][2]
            self.assertIn("Summary: s", p)
            self.assertNotIn("new", p.split("Question:")[0].replace("Summary", ""))  # body "new" not sent by default
            self.assertNotIn("Saved comments", p)
            c.post(url, json={"question": "all?", "include_body": True, "include_comments": True, "history": [{"q": "q1", "a": "a1"}]})
            p = CALLS[-1][2]
            self.assertIn("## Article text\n\nnew", p)
            self.assertIn("ans", p.split("## Saved comments")[1])
            self.assertIn("Q: q1\nA: a1", p)
            self.assertEqual(c.post("/api/articles/explain", json={"concept": "x", "model": "gpt"}).status_code, 400)
            self.assertEqual(c.post("/api/articles/explain", json={"concept": " ", "model": "opus"}).status_code, 400)
            self.assertEqual(c.delete(f"/api/articles/{aid}").status_code, 200)
            self.assertEqual(c.get(f"/api/articles/{aid}").status_code, 404)


if __name__ == "__main__":
    unittest.main()
