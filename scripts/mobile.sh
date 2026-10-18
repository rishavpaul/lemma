#!/usr/bin/env bash
# Serve Lemma to your phone over Tailscale (HTTPS, reachable only from your own tailnet).
#   ./scripts/mobile.sh            build the UI if needed, start the API, publish it, print the phone URL
#   PORT=9000 ./scripts/mobile.sh  change the local API port
# Ctrl-C stops the server and unpublishes it. The Mac must stay awake (this script holds it awake with caffeinate).
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8765}"
command -v tailscale >/dev/null || { echo "tailscale missing: brew install --cask tailscale"; exit 1; }
command -v uv >/dev/null || { echo "uv missing: brew install uv"; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg missing: brew install ffmpeg"; exit 1; }
command -v node >/dev/null || { echo "node missing: brew install node"; exit 1; }

HOST="$(tailscale status --json | python3 -c "import sys,json; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))")"
[ -n "$HOST" ] || { echo "Tailscale is not signed in. Open the Tailscale app first."; exit 1; }

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use (./run.sh still running?). Stop it first, then rerun:"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | tail -n +2
  exit 1
fi

[ -d .venv ] || uv venv --python 3.12
uv pip install -q fastapi "uvicorn[standard]" python-multipart pyyaml mlx-whisper kokoro-onnx

# Static export into web/.next-export, which FastAPI serves itself (LEMMA_WEB). Separate from ./run.sh's .next and from web/out.
cd web
[ -d node_modules ] || npm install --no-audit --no-fund
EXPORT=.next-export
if [ ! -f "$EXPORT/index.html" ] || [ -n "$(find src public package.json next.config.ts -newer "$EXPORT/index.html" -print -quit)" ]; then
  echo "Building the UI..."
  rm -rf "$EXPORT"
  STATIC_EXPORT=1 NEXT_DIST_DIR="$EXPORT" npm run build >/dev/null
fi
cd ..

SERVER_PID=""
cleanup() {
  tailscale serve --https=443 off >/dev/null 2>&1 || true
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

LEMMA_WEB="$PWD/web/$EXPORT" caffeinate -i .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" --log-level warning &
SERVER_PID=$!
for _ in $(seq 1 40); do curl -fs "http://127.0.0.1:$PORT/api/auth/status" >/dev/null 2>&1 && break; sleep 0.5; done

tailscale serve --bg --https=443 "http://127.0.0.1:$PORT" >/dev/null
TOKEN="$(cat "${LEMMA_HOME:-$HOME/Lemma}/auth_token")"
URL="https://$HOST/#token=$TOKEN"

echo
echo "Lemma is up. On your iPhone (Tailscale on), open this once in Safari:"
echo
echo "  $URL"
echo
if command -v qrencode >/dev/null; then qrencode -t ANSIUTF8 "$URL"; else echo "(brew install qrencode to show this as a QR code)"; fi
echo
echo "Then Share > Add to Home Screen. After that, just tap the icon. Ctrl-C here to stop."
wait "$SERVER_PID"
