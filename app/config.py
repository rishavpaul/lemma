"""Paths, settings and seeding of the editable config directory."""
import json
import os
import shutil
import sqlite3
from pathlib import Path

import yaml

APP_DIR = Path(__file__).resolve().parent
SEED_DIR = APP_DIR / "seed"
STATIC_DIR = APP_DIR / "static"

# SD_COACH_HOME allows pointing the app at a scratch directory; default is the real data dir.
DATA_DIR = Path(os.environ.get("SD_COACH_HOME", Path.home() / "SystemDesignCoach")).expanduser()
CONFIG_DIR = DATA_DIR / "config"
AUDIO_DIR = DATA_DIR / "audio"
RESEARCH_DIR = DATA_DIR / "research"
EXPORT_DIR = DATA_DIR / "exports"
SANDBOX_DIR = DATA_DIR / ".grader-sandbox"
LOG_DIR = DATA_DIR / "logs"
DB_PATH = DATA_DIR / "coach.db"

DEFAULT_SETTINGS = {
    "model": "opus",
    "claude_path": "",
    "claude_concurrency": "1",
    "show_feedback_live": "0",
    "whisper_model": "mlx-community/whisper-large-v3-turbo",
}

DIMENSIONS = [
    "problem_framing", "estimation", "data_modeling", "architecture", "technical_depth",
    "scalability_reliability", "operational_maturity", "tradeoff_reasoning",
    "communication_drive", "time_management",
]
SECTION_KEYS = ["scope", "estimates", "api_data", "hld", "deep_dives", "reliability_ops", "tradeoffs_evolution"]


def ensure_dirs() -> None:
    for d in (DATA_DIR, CONFIG_DIR, AUDIO_DIR, RESEARCH_DIR, EXPORT_DIR, SANDBOX_DIR, LOG_DIR):
        d.mkdir(parents=True, exist_ok=True)


def seed_config() -> list[str]:
    """Copy seed files into config/ without overwriting existing (possibly edited) files."""
    copied = []
    for src in SEED_DIR.rglob("*"):
        if src.is_dir() or src.name.startswith("."):
            continue
        dst = CONFIG_DIR / src.relative_to(SEED_DIR)
        if not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            copied.append(str(src.relative_to(SEED_DIR)))
    return copied


def _read(name: str) -> str:
    return (CONFIG_DIR / name).read_text(encoding="utf-8")


def load_framework() -> list[dict]:
    return yaml.safe_load(_read("framework.yaml"))["sections"]


def load_questions_yaml() -> list[dict]:
    return yaml.safe_load(_read("questions.yaml"))["questions"]


def load_gap_tags() -> dict:
    return yaml.safe_load(_read("gap_tags.yaml"))


def load_text(name: str) -> str:
    return _read(name)


def load_schema(name: str) -> dict:
    return json.loads(_read(f"schemas/{name}.json"))


def load_vocabulary() -> str:
    """Vocabulary for Whisper's initial_prompt, trimmed to roughly 200 tokens (~800 chars)."""
    text = " ".join(_read("vocabulary.txt").split())
    return text[:800]


def rubric_section(key: str) -> str:
    """Extract the anchors block for one section from rubric.md."""
    out, grab = [], False
    for line in _read("rubric.md").splitlines():
        if line.startswith("### "):
            grab = line[4:].strip() == key
            continue
        if line.startswith("## ") and grab:
            break
        if grab:
            out.append(line)
    return "\n".join(out).strip()


def rubric_dimensions() -> str:
    text = _read("rubric.md")
    i = text.find("## Holistic dimensions")
    return text[i:].strip() if i >= 0 else ""


def get_setting(conn: sqlite3.Connection, key: str) -> str:
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row[0] if row else DEFAULT_SETTINGS.get(key, "")


def all_settings(conn: sqlite3.Connection) -> dict:
    s = dict(DEFAULT_SETTINGS)
    for k, v in conn.execute("SELECT key, value FROM settings"):
        s[k] = v
    s["vocabulary"] = _read("vocabulary.txt") if (CONFIG_DIR / "vocabulary.txt").exists() else ""
    return s


def put_settings(conn: sqlite3.Connection, data: dict) -> None:
    for k, v in data.items():
        if k == "vocabulary":
            (CONFIG_DIR / "vocabulary.txt").write_text(str(v), encoding="utf-8")
        elif k in DEFAULT_SETTINGS:
            if k == "claude_concurrency":
                v = str(max(1, min(2, int(v))))
            if k == "show_feedback_live":
                v = "1" if v in (True, 1, "1", "true") else "0"
            conn.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                         (k, str(v)))
    conn.commit()
