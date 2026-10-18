"""Remote (proxied) requests need the shared token; direct local ones do not. Run: .venv/bin/python -m unittest discover tests"""
import os
import tempfile
import unittest

os.environ["LEMMA_HOME"] = tempfile.mkdtemp()
os.environ["LEMMA_TTS"] = "0"  # never download or load the speech model in tests

from fastapi.testclient import TestClient  # noqa: E402

from app import auth, main  # noqa: E402

PROXIED = {"X-Forwarded-For": "100.113.60.112", "X-Forwarded-Proto": "https"}


class AuthFlow(unittest.TestCase):
    def test_flow(self):
        with TestClient(main.app, base_url="https://testserver") as c:
            token = auth.get_token()
            self.assertEqual(oct(auth.token_path().stat().st_mode & 0o777), "0o600")

            # direct local access is trusted
            self.assertEqual(c.get("/api/framework").status_code, 200)
            self.assertEqual(c.get("/api/auth/status").json(), {"required": False, "authed": True})

            # proxied access is not
            self.assertEqual(c.get("/api/framework", headers=PROXIED).status_code, 401)
            self.assertEqual(c.get("/api/auth/status", headers=PROXIED).json(), {"required": True, "authed": False})
            self.assertEqual(c.post("/api/auth/login", json={"token": "nope"}, headers=PROXIED).status_code, 401)
            self.assertEqual(c.get("/api/framework", headers={**PROXIED, "Authorization": "Bearer nope"}).status_code, 401)

            # bearer works without a cookie
            self.assertEqual(c.get("/api/framework", headers={**PROXIED, "Authorization": f"Bearer {token}"}).status_code, 200)

            # login sets a cookie that then works
            r = c.post("/api/auth/login", json={"token": token}, headers=PROXIED)
            self.assertEqual(r.status_code, 200)
            self.assertIn("httponly", r.headers["set-cookie"].lower())
            self.assertIn("secure", r.headers["set-cookie"].lower())
            self.assertEqual(c.get("/api/framework", headers=PROXIED).status_code, 200)

            c.post("/api/auth/logout", headers=PROXIED)
            self.assertEqual(c.get("/api/framework", headers=PROXIED).status_code, 401)


if __name__ == "__main__":
    unittest.main()
