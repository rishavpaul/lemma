"""Provider backend against a local fake OpenAI-compatible server. Run: .venv/bin/python -m unittest discover tests"""
import asyncio
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from app import providers

SEEN: list[str] = []


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        fmt = body["response_format"]["type"]
        SEEN.append(fmt)
        if fmt == "json_schema":  # a model without schema support
            self.send_response(400); self.end_headers()
            self.wfile.write(b'{"error":{"message":"json_schema unsupported"}}')
            return
        self.send_response(200); self.end_headers()
        self.wfile.write(json.dumps({"model": "m", "choices": [{"message": {"content": "```json\n{\"a\": 1}\n```"}, "finish_reason": "stop"}],
                                     "usage": {"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.001}}).encode())


class ProviderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base, cls.key = providers.PROVIDERS["groq"]["base"], providers.get_key
        providers.PROVIDERS["groq"]["base"] = f"http://127.0.0.1:{cls.srv.server_port}"

    @classmethod
    def tearDownClass(cls):
        providers.PROVIDERS["groq"]["base"], providers.get_key = cls.base, cls.key
        cls.srv.shutdown()

    def chat(self):
        return asyncio.run(providers.chat_json("groq", "x", "sys", "payload", {"type": "object"}, 20))

    def test_falls_back_to_json_mode_and_parses_fenced_json(self):
        providers.get_key = lambda p: "testkey12345"
        SEEN.clear()
        r = self.chat()
        self.assertTrue(r["ok"])
        self.assertEqual(r["structured"], {"a": 1})
        self.assertEqual(SEEN, ["json_schema", "json_object"])
        self.assertEqual(r["raw"]["usage"], {"input_tokens": 10, "output_tokens": 5})

    def test_missing_key_is_an_auth_error(self):
        providers.get_key = lambda p: ""
        r = self.chat()
        self.assertFalse(r["ok"])
        self.assertEqual(r["error_kind"], "auth")

    def test_parse_model(self):
        self.assertEqual(providers.parse_model("openrouter:a/b:free"), ("openrouter", "a/b:free"))
        self.assertEqual(providers.parse_model("sonnet"), (None, "sonnet"))

    def test_recommend_prefers_large_free_long_context(self):
        ms = [{"id": "x/small-8b", "free": True, "context": 131072}, {"id": "x/big-120b", "free": True, "context": 131072},
              {"id": "x/huge-400b", "free": False, "context": 131072}, {"id": "x/vision-200b", "free": True, "context": 131072}]
        self.assertEqual(providers.recommend(ms), "x/big-120b")


if __name__ == "__main__":
    unittest.main()
