"""ffmpeg conversion + mlx-whisper transcription."""
import logging
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

from . import config

log = logging.getLogger("coach.transcribe")

_state = {"whisper_loaded": False, "whisper_loading": False, "whisper_error": None}
_lock = threading.Lock()


def whisper_state() -> dict:
    return dict(_state)


def ffmpeg_ok() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def warm(model: str) -> None:
    """Transcribe 1 s of silence so the model is downloaded and loaded before the first real clip."""
    _state.update(whisper_loading=True, whisper_error=None)
    t0 = time.time()
    try:
        import numpy as np
        import mlx_whisper
        with _lock:
            mlx_whisper.transcribe(np.zeros(16000, dtype=np.float32), path_or_hf_repo=model, language="en")
        _state.update(whisper_loaded=True)
        log.info("whisper warm in %.1fs", time.time() - t0)
    except Exception as e:  # noqa: BLE001
        _state.update(whisper_error=str(e))
        log.exception("whisper warm failed")
    finally:
        _state.update(whisper_loading=False)


# ---- conversion ----------------------------------------------------------

async def convert_to_wav(src: Path, dst: Path) -> None:
    import asyncio
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ac", "1", "-ar", "16000", str(dst),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {err.decode(errors='replace')[:500]}")


def probe_duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


# ---- hallucination filtering ---------------------------------------------

FILLER = {"thank you", "thanks", "thanks for watching", "thank you for watching", "you", "bye", "okay", "so",
          "thank you very much", "see you next time", "subtitles by the amara.org community"}


def _norm(t: str) -> str:
    return "".join(c for c in t.lower() if c.isalnum() or c == " ").strip()


_PCT = re.compile(r"\bpage (50|90|95|99|999)\b", re.I)


def fix_terms(text: str) -> str:
    """Whisper hears the spoken "p99" as "page 99"."""
    return _PCT.sub(lambda m: "p" + m.group(1), text)


def clean_segments(segments: list[dict]) -> list[dict]:
    """Drop likely hallucinations over silence, then collapse consecutive exact repeats."""
    kept, prev_end = [], 0.0
    for s in segments:
        text, n = s["text"].strip(), _norm(s["text"])
        dur = s["end"] - s["start"]
        gap = s["start"] - prev_end
        drop = False
        if not n:
            drop = True
        elif s.get("no_speech_prob", 0) > 0.6 and s.get("avg_logprob", 0) < -1.0:
            drop = True
        elif n in FILLER and (gap >= 8 or dur >= 10 or s.get("no_speech_prob", 0) > 0.3):
            drop = True
        if not drop:
            if kept and _norm(kept[-1]["text"]) == n and len(n.split()) >= 3:
                prev_end = s["end"]
                continue
            kept.append({"start": s["start"], "end": s["end"], "text": fix_terms(text)})
        prev_end = s["end"]
    return kept


def transcribe_wav(wav: Path, model: str, vocabulary: str) -> dict:
    import mlx_whisper
    with _lock:
        r = mlx_whisper.transcribe(str(wav), path_or_hf_repo=model, language="en",
                                   initial_prompt=vocabulary or None, condition_on_previous_text=False)
    segs = [{"start": float(s["start"]), "end": float(s["end"]), "text": s["text"],
             "no_speech_prob": float(s.get("no_speech_prob", 0)), "avg_logprob": float(s.get("avg_logprob", 0))}
            for s in r["segments"]]
    cleaned = clean_segments(segs)
    text = " ".join(s["text"] for s in cleaned).strip()
    _state["whisper_loaded"] = True
    return {"text": text, "segments": cleaned, "dropped": len(segs) - len(cleaned)}


# ---- job handler ----------------------------------------------------------
import asyncio
import json

from . import db, jobs


@jobs.register("transcribe")
async def handle_transcribe(job: dict) -> None:
    sec = db.one("SELECT * FROM sections WHERE id=?", (job["ref_id"],))
    if not sec or not sec["audio_path"]:
        raise jobs.JobError("other", "section or audio missing")
    db.execute("UPDATE sections SET status='transcribing' WHERE id=?", (sec["id"],))
    wav = Path(sec["wav_path"])
    if not wav.exists():
        await convert_to_wav(Path(sec["audio_path"]), wav)
    model = config.get_setting(db.connect(), "whisper_model")
    vocab = config.load_vocabulary()
    t0 = time.time()
    try:
        result = await asyncio.to_thread(transcribe_wav, wav, model, vocab)
    except Exception as e:  # noqa: BLE001
        db.execute("UPDATE sections SET status='recorded' WHERE id=?", (sec["id"],))
        raise jobs.JobError("other", f"transcription failed: {e}")
    dur = probe_duration(wav)
    db.execute("UPDATE sections SET transcript_raw=?, transcript_edited=?, segments_json=?, duration_sec=?, "
               "status='transcribed' WHERE id=?",
               (result["text"], result["text"], json.dumps(result["segments"]), dur, sec["id"]))
    log.info("transcribed section %s: %.1fs audio in %.1fs, dropped %d segments", sec["id"], dur,
             time.time() - t0, result["dropped"])
