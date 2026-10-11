#!/usr/bin/env bash
# Create the venv if needed, install deps, start the server on 127.0.0.1 and open the browser.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8765}"

command -v uv >/dev/null || { echo "uv missing: brew install uv"; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg missing: brew install ffmpeg"; exit 1; }

[ -d .venv ] || uv venv --python 3.12
uv pip install -q fastapi "uvicorn[standard]" python-multipart pyyaml mlx-whisper

if [ -z "${NO_OPEN:-}" ]; then
  (sleep 2 && open "http://127.0.0.1:${PORT}") &
fi
exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT"
