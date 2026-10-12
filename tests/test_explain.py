"""Explain-concept endpoint with the model call stubbed. Run: .venv/bin/python -m unittest discover tests"""
import os
import tempfile
import unittest

os.environ["SD_COACH_HOME"] = tempfile.mkdtemp()

from fastapi.testclient import TestClient  # noqa: E402

from app import grader, main  # noqa: E402

MODELS: list[str] = []


async def fake_run_claude(kind, system, payload, schema, model, timeout, cpath="", validator=None, ref=None, web=True):
    MODELS.append(model)
    return {"ok": True, "structured": {"explanation": "text"}, "raw": {}, "duration_s": 0.1, "error_kind": None, "error": None}


class Explain(unittest.TestCase):
    def test_models(self):
        grader.run_claude = fake_run_claude
        with TestClient(main.app) as c:
            for m in ("sonnet", "opus", "free"):
                r = c.post("/api/explain", json={"concept": "Quorum reads", "model": m})
                self.assertEqual(r.json()["explanation"], "text")
            self.assertEqual(MODELS[:2], ["sonnet", "opus"])
            self.assertIn("nemotron", MODELS[2])
            self.assertEqual(c.post("/api/explain", json={"concept": "x", "model": "gpt"}).status_code, 400)
            self.assertEqual(c.post("/api/explain", json={"concept": " ", "model": "opus"}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
