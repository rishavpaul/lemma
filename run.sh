#!/usr/bin/env bash
# Start the API (FastAPI, :8765) and the web UI (Next.js, :3000), then open the browser.
#   PORT=9000 WEB_PORT=4000 ./run.sh    change ports
#   NO_OPEN=1 ./run.sh                  do not open the browser
#   DEV=1 ./run.sh                      run the UI with hot reload instead of a production build
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8765}"
WEB_PORT="${WEB_PORT:-3000}"
API_ORIGIN="http://127.0.0.1:${PORT}"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use (an older instance still running?). Stop it first:"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | tail -n +2
  echo "  kill <PID>   or run with PORT=<other port> ./run.sh"
  exit 1
fi

command -v uv >/dev/null || { echo "uv missing: brew install uv"; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg missing: brew install ffmpeg"; exit 1; }
command -v node >/dev/null || { echo "node missing: brew install node"; exit 1; }

[ -d .venv ] || uv venv --python 3.12
uv pip install -q fastapi "uvicorn[standard]" python-multipart pyyaml mlx-whisper

cd web
[ -d node_modules ] || npm install --no-audit --no-fund
export API_ORIGIN NEXT_DIST_DIR

if [ -z "${DEV:-}" ]; then
  # Rebuild when sources changed or the API port changed (the proxy target is baked in at build time).
  DIST="${NEXT_DIST_DIR:-.next}"
  stamp="$DIST/built-for-${PORT}"
  if [ ! -f "$stamp" ] || [ -n "$(find src package.json next.config.ts -newer "$stamp" -print -quit)" ]; then
    echo "Building the UI..."
    rm -rf "$DIST"
    npm run build
    touch "$stamp"
  fi
fi
cd ..

.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT INT TERM

if [ -z "${NO_OPEN:-}" ]; then
  (sleep 3 && open "http://127.0.0.1:${WEB_PORT}") &
fi
cd web
if [ -n "${DEV:-}" ]; then
  npx next dev -H 127.0.0.1 -p "$WEB_PORT"
else
  npx next start -H 127.0.0.1 -p "$WEB_PORT"
fi
