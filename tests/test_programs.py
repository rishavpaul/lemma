"""Programs: named sets of coding problems and design questions, with progress. Run: .venv/bin/python -m unittest discover tests"""
import os
import tempfile
import unittest

os.environ["LEMMA_HOME"] = tempfile.mkdtemp()
os.environ["LEMMA_TTS"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app import db, main  # noqa: E402


class ProgramsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)
        cls.client.__enter__()
        cls.slug = db.one("SELECT slug FROM problems WHERE id NOT IN (SELECT problem_id FROM attempts) ORDER BY ord LIMIT 1")["slug"]
        cls.qid = str(db.one("SELECT id FROM questions WHERE id NOT IN (SELECT question_id FROM sessions) ORDER BY id LIMIT 1")["id"])

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)

    def test_flow(self):
        c = self.client
        pid = c.post("/api/programs", json={"name": "  Practical round  "}).json()["id"]
        self.assertEqual(c.put(f"/api/programs/{pid}/items", json={"kind": "code", "ref": self.slug}).status_code, 200)
        c.put(f"/api/programs/{pid}/items", json={"kind": "code", "ref": self.slug})  # adding twice is a no-op
        c.put(f"/api/programs/{pid}/items", json={"kind": "design", "ref": self.qid})
        p = c.get(f"/api/programs/{pid}").json()
        self.assertEqual(p["name"], "Practical round")
        self.assertEqual([(i["kind"], i["status"]) for i in p["items"]], [("code", "todo"), ("design", "todo")])
        self.assertEqual((p["total"], p["done"]), (2, 0))
        listed = next(x for x in c.get("/api/programs").json() if x["id"] == pid)
        self.assertEqual([(i["kind"], i["ref"]) for i in listed["items"]], [("code", self.slug), ("design", self.qid)])

        c.delete(f"/api/programs/{pid}/items", params={"kind": "code", "ref": self.slug})
        self.assertEqual(c.get(f"/api/programs/{pid}").json()["total"], 1)
        c.patch(f"/api/programs/{pid}", json={"name": "Renamed"})
        self.assertEqual(c.get(f"/api/programs/{pid}").json()["name"], "Renamed")
        c.delete(f"/api/programs/{pid}")
        self.assertEqual(c.get(f"/api/programs/{pid}").status_code, 404)
        self.assertEqual(db.one("SELECT COUNT(*) n FROM program_items WHERE program_id=?", (pid,))["n"], 0)

    def test_rejects_bad_input(self):
        c = self.client
        self.assertEqual(c.post("/api/programs", json={"name": "  "}).status_code, 400)
        pid = c.post("/api/programs", json={"name": "x"}).json()["id"]
        self.assertEqual(c.put(f"/api/programs/{pid}/items", json={"kind": "code", "ref": "no-such"}).status_code, 404)
        self.assertEqual(c.put(f"/api/programs/{pid}/items", json={"kind": "design", "ref": "abc"}).status_code, 404)
        self.assertEqual(c.put(f"/api/programs/{pid}/items", json={"kind": "other", "ref": "1"}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
