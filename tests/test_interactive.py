"""Interactive mode is chosen per session. Run: .venv/bin/python -m unittest discover tests"""
import os
import tempfile
import unittest

os.environ["LEMMA_HOME"] = tempfile.mkdtemp()
os.environ["LEMMA_TTS"] = "0"  # never download or load the speech model in tests

from fastapi.testclient import TestClient  # noqa: E402

from app import config, main, prompts  # noqa: E402


class InteractiveMode(unittest.TestCase):
    def test_flow(self):
        with TestClient(main.app) as c:
            qs = c.get("/api/questions").json()
            qid = (qs["questions"] if isinstance(qs, dict) else qs)[0]["id"]
            live = lambda sid: c.get(f"/api/sessions/{sid}").json()["session"]["show_feedback_live"]

            default = c.post("/api/sessions", json={"question_id": qid}).json()["id"]
            on = c.post("/api/sessions", json={"question_id": qid, "interactive": True}).json()["id"]
            off = c.post("/api/sessions", json={"question_id": qid, "interactive": False}).json()["id"]
            self.assertEqual((live(default), live(on), live(off)), (0, 1, 0))

            self.assertEqual(c.put(f"/api/sessions/{off}/interactive", json={"on": True}).status_code, 200)
            self.assertEqual(live(off), 1)
            c.put(f"/api/sessions/{off}/interactive", json={"on": False})
            self.assertEqual(live(off), 0)
            self.assertEqual(c.put("/api/sessions/9999/interactive", json={"on": True}).status_code, 404)

            row = next(s for s in c.get("/api/sessions").json() if s["id"] == on)
            self.assertEqual(row["sections_total"], 5)

    def test_spoken_feedback_only_when_interactive(self):
        fw = config.load_framework()[0]
        args = (fw, "anchors", [], {"title": "t", "text": "x", "duration_sec": 5, "budget_sec": 60})
        self.assertNotIn("spoken_feedback", prompts.section(*args))
        self.assertIn("spoken_feedback", prompts.section(*args, spoken=True))
        schema = config.load_schema("section")
        self.assertIn("spoken_feedback", schema["properties"])
        self.assertNotIn("spoken_feedback", schema["required"])  # optional: only interactive sessions ask for it

    def test_tts_prepare_and_unavailable(self):
        from app import tts
        self.assertEqual(tts.prepare("p99 latency"), "P ninety nine latency")
        self.assertEqual(tts.prepare("p50"), "P fifty")
        self.assertIn("Reddis", tts.prepare("Use Redis here"))
        with TestClient(main.app) as c:
            st = c.get("/api/tts/status").json()
            self.assertFalse(st["ready"])
            self.assertEqual(c.post("/api/tts", json={"text": "hello"}).status_code, 503)
            self.assertEqual(c.post("/api/tts", json={"text": "  "}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
