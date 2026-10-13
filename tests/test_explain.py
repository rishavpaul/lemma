"""Knowledge-graph explain/ask flow with the model call stubbed. Run: .venv/bin/python -m unittest discover tests"""
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
    out = {"kg_pick": PICK,
           "kg_write": {"title": "Quorum reads", "summary": "R+W>N", "body": "body", "related_ids": [999]},
           "kg_ask": {"answer": "because"}}[kind]
    return {"ok": True, "structured": out, "raw": {}, "duration_s": 0.1, "error_kind": None, "error": None}


class Knowledge(unittest.TestCase):
    def test_flow(self):
        grader.run_claude = fake_run_claude
        with TestClient(main.app) as c:
            body = {"concept": "Quorum reads", "model": "free"}
            r = c.post("/api/kg/explain", json=body).json()
            self.assertTrue(r["created"])
            self.assertEqual([k for k, _, _ in CALLS], ["kg_write"])  # empty graph: no pick call
            self.assertIn("nemotron", CALLS[0][1])
            aid = r["article"]["id"]
            self.assertEqual(r["article"]["links"], [])  # unknown related id ignored

            PICK.update(article_id=aid)
            r = c.post("/api/kg/explain", json=dict(body, model="opus")).json()
            self.assertFalse(r["created"])
            self.assertEqual(r["article"]["id"], aid)
            self.assertIn(f"[{aid}] Quorum reads: R+W>N", CALLS[-1][2])  # compressed graph sent

            PICK.update(article_id=None)  # model says nothing fits; title collides, so the existing article is reused
            self.assertFalse(c.post("/api/kg/explain", json=body).json()["created"])

            self.assertEqual(c.get("/api/kg").json()["nodes"][0]["title"], "Quorum reads")
            e = c.put(f"/api/kg/articles/{aid}", json={"title": "Quorums", "summary": "s", "body": "new"}).json()
            self.assertEqual(e["body"], "new")
            self.assertEqual(c.post(f"/api/kg/articles/{aid}/ask", json={"question": "why?", "model": "sonnet"}).json()["answer"], "because")
            self.assertEqual(c.post("/api/kg/explain", json={"concept": "x", "model": "gpt"}).status_code, 400)
            self.assertEqual(c.post("/api/kg/explain", json={"concept": " ", "model": "opus"}).status_code, 400)
            self.assertEqual(c.delete(f"/api/kg/articles/{aid}").status_code, 200)
            self.assertEqual(c.get(f"/api/kg/articles/{aid}").status_code, 404)


if __name__ == "__main__":
    unittest.main()
