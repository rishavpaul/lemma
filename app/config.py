"""Paths, settings and seeding of the editable config directory."""
import json
import os
import shutil
import sqlite3
from pathlib import Path

import yaml

APP_DIR = Path(__file__).resolve().parent
SEED_DIR = APP_DIR / "seed"

# LEMMA_HOME allows pointing the app at a scratch directory; default is the real data dir.
LEGACY_DATA_DIRS = (Path.home() / "InterviewCoach", Path.home() / "SystemDesignCoach")  # the app's earlier names; the first that exists is copied
DATA_DIR = Path(os.environ.get("LEMMA_HOME", Path.home() / "Lemma")).expanduser()
CONFIG_DIR = DATA_DIR / "config"
AUDIO_DIR = DATA_DIR / "audio"
RESEARCH_DIR = DATA_DIR / "research"
EXPORT_DIR = DATA_DIR / "exports"
SANDBOX_DIR = DATA_DIR / ".grader-sandbox"
LOG_DIR = DATA_DIR / "logs"
CODE_DIR = DATA_DIR / "code"  # compiled judge harness and per-run scratch directories
DB_PATH = DATA_DIR / "coach.db"

DEFAULT_SETTINGS = {
    "model_research": "opus",
    "model_section": "sonnet",
    "model_holistic": "opus",
    "model_improvement": "default",  # "default" = follow model_holistic
    "model_code_gen": "sonnet",  # writes a coding problem's statement, reference and brute-force solutions and test generator
    "model_code_review": "opus",  # the staff-level review of a candidate's code
    "model_code_hint": "sonnet",  # personalised hints while stuck
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
MODEL_CHOICES = ("opus", "sonnet", "fable", "haiku")
SECTION_KEYS = ["scope", "hld", "deep_dives", "reliability_ops", "tradeoffs_evolution"]


def migrate_legacy_data() -> bool:
    """First launch after the rename: copy ~/InterviewCoach (or the older ~/SystemDesignCoach) to ~/Lemma. The old folder is left alone as a backup.
    Only for the default location, and only when the new folder does not exist yet. The database goes through SQLite's backup API
    so a copy made while the old app is still running is consistent."""
    legacy = next((d for d in LEGACY_DATA_DIRS if d.is_dir()), None)
    if "LEMMA_HOME" in os.environ or DATA_DIR.exists() or legacy is None:
        return False
    tmp = DATA_DIR.with_name(DATA_DIR.name + ".migrating")
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.copytree(legacy, tmp, symlinks=True, ignore=shutil.ignore_patterns("coach.db", "coach.db-*", "coach.db.bak-*", ".grader-sandbox"))
    old_db = legacy / "coach.db"
    if old_db.exists():
        src, dst = sqlite3.connect(old_db), sqlite3.connect(tmp / "coach.db")
        with dst:
            src.backup(dst)
        src.close()
        dst.close()
    tmp.rename(DATA_DIR)
    return True


def ensure_dirs() -> None:
    migrate_legacy_data()
    for d in (DATA_DIR, CONFIG_DIR, AUDIO_DIR, RESEARCH_DIR, EXPORT_DIR, SANDBOX_DIR, LOG_DIR, CODE_DIR):
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


def load_problems_yaml() -> dict:
    return yaml.safe_load(_read("problems.yaml"))


def load_code_gap_tags() -> dict:
    return yaml.safe_load(_read("code/gap_tags.yaml"))


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
    from . import providers  # late import: providers reads paths from this module
    for k, v in data.items():
        if k == "vocabulary":
            (CONFIG_DIR / "vocabulary.txt").write_text(str(v), encoding="utf-8")
        elif k in DEFAULT_SETTINGS:
            if k == "claude_concurrency":
                v = str(max(1, min(2, int(v))))
            if k.startswith("model_"):
                v = str(v)
                if not (v in MODEL_CHOICES or (v == "default" and k == "model_improvement") or v.startswith("claude-") or providers.valid_model_setting(v)):
                    raise ValueError(f"unknown model {v!r} for {k}")
                if k == "model_research" and providers.parse_model(v)[0]:
                    raise ValueError("Research needs live web search, which only Claude provides here.")
            if k == "show_feedback_live":
                v = "1" if v in (True, 1, "1", "true") else "0"
            conn.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                         (k, str(v)))
    conn.commit()
