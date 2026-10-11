"""FastAPI app, routes and startup."""
import asyncio
import logging
import threading
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, grader, transcribe

log = logging.getLogger("coach")


def setup_logging() -> None:
    config.LOG_DIR.mkdir(parents=True, exist_ok=True)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    fh = RotatingFileHandler(config.LOG_DIR / "app.log", maxBytes=2_000_000, backupCount=3)
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root.addHandler(fh)


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    setup_logging()
    copied = config.seed_config()
    if copied:
        log.info("seeded config files: %s", copied)
    version = db.migrate()
    db.sync_questions()
    log.info("db ready, schema version %s", version)
    model = config.get_setting(db.connect(), "whisper_model")
    threading.Thread(target=transcribe.warm, args=(model,), daemon=True).start()
    health_task = asyncio.create_task(grader.check_health())
    yield
    health_task.cancel()


app = FastAPI(title="Staff System Design Coach", lifespan=lifespan)


@app.get("/api/health")
async def health():
    c = grader.get_health()
    w = transcribe.whisper_state()
    return {
        "claude_ok": c["claude_ok"], "claude_version": c["version"], "claude_path": c["path"],
        "claude_error": c["error"],
        "ffmpeg_ok": transcribe.ffmpeg_ok(),
        "whisper_loaded": w["whisper_loaded"], "whisper_loading": w["whisper_loading"],
        "whisper_error": w["whisper_error"],
        "data_dir": str(config.DATA_DIR),
    }


@app.get("/api/framework")
async def framework():
    return {"sections": config.load_framework()}


@app.get("/")
async def index():
    return FileResponse(config.STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=config.STATIC_DIR), name="static")
