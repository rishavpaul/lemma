import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["LEMMA_HOME"] = tempfile.mkdtemp()
os.environ["LEMMA_TTS"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402
from app.code import lsp  # noqa: E402


class Project(unittest.TestCase):
    def test_prepare_project_lays_out_support_files_and_keeps_edits(self):
        info = lsp.prepare_project("two-sum", "Solution", "class Solution {}", "class Support {}")
        root = Path(info["rootUri"].removeprefix("file://"))
        self.assertEqual({p.name for p in root.iterdir()}, {"Solution.java", "Support.java", "ListNode.java", "TreeNode.java"})
        self.assertTrue(info["fileUri"].endswith("/Solution.java"))
        (root / "Solution.java").write_text("changed")
        lsp.prepare_project("two-sum", "Solution", "class Solution {}", None)
        self.assertEqual((root / "Solution.java").read_text(), "changed")

    def test_slug_cannot_escape(self):
        info = lsp.prepare_project("../../evil", "Solution", "x", None)
        self.assertTrue(info["rootUri"].startswith(lsp.lsp_root().as_uri()))

    def test_frames_round_trip(self):
        import asyncio

        async def go():
            r = asyncio.StreamReader()
            r.feed_data(lsp._frame('{"a":"é"}') + lsp._frame("{}"))
            r.feed_eof()
            return [await lsp._read_frame(r), await lsp._read_frame(r), await lsp._read_frame(r)]
        self.assertEqual(asyncio.run(go()), ['{"a":"é"}', "{}", None])


@unittest.skipUnless(lsp.find_jdtls(), "jdtls not installed")
class Bridge(unittest.TestCase):
    def test_initialize_through_the_socket(self):
        import json
        with TestClient(main.app) as c, c.websocket_connect("/api/code/lsp") as ws:
            ws.send_text(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                                     "params": {"processId": None, "rootUri": None, "capabilities": {}}}))
            msg = json.loads(ws.receive_text())
            while "result" not in msg:
                msg = json.loads(ws.receive_text())
            self.assertIn("completionProvider", msg["result"]["capabilities"])


if __name__ == "__main__":
    unittest.main()
