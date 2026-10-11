"""ffmpeg conversion + mlx-whisper transcription."""
import logging
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
