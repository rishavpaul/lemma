"""Local neural text to speech (Kokoro through kokoro-onnx), used to read articles and feedback aloud.

The Mac synthesizes, the UI plays the audio, so the voice is the same on the phone and the desktop app.
Needs `kokoro-onnx` and a system espeak-ng (`brew install espeak-ng`). If either is missing the UI falls back to the
browser's own voices. The espeak-ng wheel bundled with kokoro-onnx is never used: it aborts the whole process when
its data path is wrong.
"""
import hashlib
import io
import logging
import os
import re
import threading
import urllib.request
import wave
from collections import OrderedDict
from pathlib import Path

from . import config

log = logging.getLogger("coach.tts")

MODEL_DIR = config.DATA_DIR / "models" / "kokoro"
BASE_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = {"kokoro-v1.0.onnx": 325_000_000, "voices-v1.0.bin": 28_000_000}  # minimum plausible sizes
DEFAULT_VOICE = "af_heart"
ESPEAK = [("/opt/homebrew/lib/libespeak-ng.dylib", "/opt/homebrew/share/espeak-ng-data"),
          ("/usr/local/lib/libespeak-ng.dylib", "/usr/local/share/espeak-ng-data")]

# Words the phonemizer says badly, respelled for the ear. Matched case-insensitively as whole words.
RESPELL = {  # checked by speaking each term and transcribing it back; the model already says nginx, gRPC, Kafka, DynamoDB etc. well
    "redis": "Reddis", "etcd": "et see dee", "kubectl": "cube control", "postgres": "post gress", "postgresql": "post gress Q L",
    "sqlite": "S Q lite", "oauth": "oh auth",
}
_PCT = re.compile(r"\bp(\d{2,3})\b", re.I)
_WORD = re.compile(r"[A-Za-z]+")

_state = {"ready": False, "loading": False, "error": None, "voices": []}
_lock = threading.Lock()
_kokoro = None
_cache: "OrderedDict[str, bytes]" = OrderedDict()
CACHE_MAX = 120


def state() -> dict:
    return dict(_state)


def prepare(text: str) -> str:
    """Make written text say well: percentiles as 'p ninety nine', and respell the terms in RESPELL."""
    text = _PCT.sub(lambda m: "P " + _number_words(int(m.group(1))), text)
    return _WORD.sub(lambda m: RESPELL.get(m.group(0).lower(), m.group(0)), text)


def _number_words(n: int) -> str:
    ones = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
    tens = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
    if n < 20:
        return ones[n]
    if n < 100:
        return tens[n // 10] + (f" {ones[n % 10]}" if n % 10 else "")
    return f"{ones[n // 100]} hundred" + (f" {_number_words(n % 100)}" if n % 100 else "")


def _espeak() -> tuple[str, str] | None:
    return next(((lib, data) for lib, data in ESPEAK if Path(lib).exists() and (Path(data) / "phontab").exists()), None)


def _download() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for name, min_size in FILES.items():
        dst = MODEL_DIR / name
        if dst.exists() and dst.stat().st_size >= min_size:
            continue
        log.info("downloading %s", name)
        part = dst.with_suffix(dst.suffix + ".part")
        urllib.request.urlretrieve(BASE_URL + name, part)  # noqa: S310 - fixed https URL
        if part.stat().st_size < min_size:
            part.unlink(missing_ok=True)
            raise RuntimeError(f"{name} downloaded incompletely")
        part.replace(dst)


def warm() -> None:
    """Download the model on first use and load it. Runs on a thread at startup; never raises."""
    global _kokoro
    if os.environ.get("LEMMA_TTS") == "0" or _state["loading"] or _state["ready"]:
        return
    _state.update(loading=True, error=None)
    try:
        try:
            from kokoro_onnx import EspeakConfig, Kokoro
        except ImportError as e:
            raise RuntimeError("kokoro-onnx is not installed (uv pip install kokoro-onnx)") from e
        esp = _espeak()
        if not esp:
            raise RuntimeError("espeak-ng is not installed (brew install espeak-ng)")
        _download()
        _kokoro = Kokoro(str(MODEL_DIR / "kokoro-v1.0.onnx"), str(MODEL_DIR / "voices-v1.0.bin"),
                         espeak_config=EspeakConfig(lib_path=esp[0], data_path=esp[1]))
        voices = [v for v in _kokoro.get_voices() if v.startswith(("af_", "am_", "bf_", "bm_"))]
        _state.update(ready=True, voices=voices)
        log.info("kokoro ready, %d voices", len(voices))
    except Exception as e:  # noqa: BLE001
        _state.update(error=str(e))
        log.warning("speech model unavailable: %s", e)
    finally:
        _state.update(loading=False)


def synth(text: str, voice: str | None = None) -> bytes:
    """Speech for `text` as a 16-bit mono WAV. Blocking; call from a thread."""
    import numpy as np
    if not _state["ready"] or _kokoro is None:
        raise RuntimeError("speech model is not ready")
    voice = voice if voice in _state["voices"] else DEFAULT_VOICE
    key = hashlib.sha1(f"{voice}|{text}".encode()).hexdigest()
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
        audio, rate = _kokoro.create(prepare(text), voice=voice, speed=1.0, lang="en-gb" if voice.startswith("b") else "en-us")
        pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(pcm.tobytes())
        _cache[key] = buf.getvalue()
        while len(_cache) > CACHE_MAX:
            _cache.popitem(last=False)
        return _cache[key]
