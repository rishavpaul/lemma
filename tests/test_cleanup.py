"""Audio and CLI-transcript clean-up. Run: .venv/bin/python -m unittest discover tests"""
import os
import tempfile
import time
import unittest
from pathlib import Path

os.environ["LEMMA_HOME"] = tempfile.mkdtemp()
os.environ["LEMMA_TTS"] = "0"  # never download or load the speech model in tests

from app import config, db, grader, progress, transcribe  # noqa: E402


class Cleanup(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config.ensure_dirs()
        config.seed_config()
        db.migrate()
        db.sync_questions()

    def _section(self, status):
        qid = db.one("SELECT id FROM questions LIMIT 1")["id"]
        sid = db.execute("INSERT INTO sessions(question_id,status,started_at) VALUES(?,?,?)", (qid, "in_progress", time.time()))
        folder = config.AUDIO_DIR / str(sid)
        folder.mkdir(parents=True)
        webm, wav = folder / "01-scope.webm", folder / "01-scope.wav"
        webm.write_bytes(b"a")
        wav.write_bytes(b"b")
        sec = db.execute("INSERT INTO sections(session_id,key,ord,budget_sec,status,audio_path,wav_path) VALUES(?,?,?,?,?,?,?)",
                         (sid, "scope", 1, 300, status, str(webm), str(wav)))
        return sid, sec, webm, wav

    def test_wav_goes_after_transcription_recording_goes_on_save(self):
        _, sec, webm, wav = self._section("transcribed")
        transcribe.purge_wav(sec)
        self.assertFalse(wav.exists())
        self.assertTrue(webm.exists())  # still needed for re-record / retry until saved
        transcribe.purge_audio(sec)
        self.assertFalse(webm.exists())
        self.assertFalse(webm.parent.exists())  # empty session folder removed
        row = db.one("SELECT audio_path, wav_path FROM sections WHERE id=?", (sec,))
        self.assertIsNone(row["audio_path"])

    def test_startup_sweep(self):
        _, saved, webm1, wav1 = self._section("saved")
        _, open_sec, webm2, wav2 = self._section("transcribed")
        _, recorded, webm3, wav3 = self._section("recorded")  # not transcribed yet: keep everything
        orphan = config.AUDIO_DIR / "9999"
        orphan.mkdir()
        (orphan / "x.webm").write_bytes(b"x")
        transcribe.sweep_audio()
        self.assertFalse(webm1.exists() or wav1.exists())
        self.assertTrue(webm2.exists())
        self.assertFalse(wav2.exists())
        self.assertTrue(webm3.exists() and wav3.exists())
        self.assertFalse(orphan.exists())

    def test_cli_transcript_removed(self):
        home = Path(tempfile.mkdtemp())
        os.environ["CLAUDE_CONFIG_DIR"] = str(home)
        try:
            import re
            folder = home / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(config.SANDBOX_DIR))
            folder.mkdir(parents=True)
            f = folder / "5c5d2017-61a2-4317-b646-cb2f4511165f.jsonl"
            f.write_text("{}")
            keep = folder / "other.jsonl"
            keep.write_text("{}")
            grader._drop_cli_transcript("5c5d2017-61a2-4317-b646-cb2f4511165f")
            grader._drop_cli_transcript("../../etc/passwd")  # ignored
            self.assertFalse(f.exists())
            self.assertTrue(keep.exists())
        finally:
            os.environ.pop("CLAUDE_CONFIG_DIR")

    def test_cost_not_reported_for_free_models(self):
        c = progress._call_cost("openrouter:x", [{"input_tokens": 10, "output_tokens": 5, "cache_read_tokens": 0,
                                                  "cache_creation_tokens": 0, "cost_usd": 0, "duration_s": 1.0}])
        self.assertFalse(c["reported"])
        self.assertEqual(c["total_tokens"], 15)


if __name__ == "__main__":
    unittest.main()
