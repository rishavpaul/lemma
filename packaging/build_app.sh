#!/usr/bin/env bash
# Builds dist/Design Coach.app (Apple Silicon): the exported UI, the Python API, its own Python and ffmpeg.
# Needs: uv, node. Whisper weights (~1.5 GB) download on first launch, like in the dev setup.
#   OUT=/some/dir ./packaging/build_app.sh     change the output directory
#   VERSION=1.2.0 sets the app version (default 1.0.0)
#   DMG=1 ./packaging/build_app.sh             also write a .dmg (drag-to-Applications installer)
#   SIGN_ID="Developer ID Application: Name (TEAMID)" NOTARY_PROFILE=<notarytool profile> DMG=1 ./packaging/build_app.sh
#                                              sign + notarize, so it opens on any Mac without warnings
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
OUT="${OUT:-$ROOT/dist}"
APP="$OUT/Design Coach.app"
RES="$APP/Contents/Resources"
command -v uv >/dev/null || { echo "uv missing: brew install uv"; exit 1; }
command -v node >/dev/null || { echo "node missing: brew install node"; exit 1; }

echo "==> Building the UI (static export)"
(cd web && { [ -d node_modules ] || npm install --no-audit --no-fund; } && rm -rf out && STATIC_EXPORT=1 npm run build >/dev/null)
[ -f web/out/index.html ] || { echo "UI export failed"; exit 1; }

echo "==> Assembling the bundle"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$RES/bin" "$RES/src"

echo "==> Python runtime"
uv python install 3.12 >/dev/null
PYHOME="$(ls -d "$(uv python dir)"/cpython-3.12.*-macos-aarch64-none | tail -1)"
[ -x "$PYHOME/bin/python3.12" ] || { echo "no managed Python 3.12 found"; exit 1; }
# uv's python directory is a symlink; copy what it points to, not the link.
mkdir -p "$RES/python"
rsync -a "$(cd "$PYHOME" && pwd -P)/" "$RES/python/"
[ ! -L "$RES/python" ] && [ -d "$RES/python/lib" ] || { echo "python copy is not a real directory; refusing to trim it"; exit 1; }
# The interpreter itself lives in Contents/MacOS so macOS treats this bundle (and its Info.plist, with the
# microphone description) as the running app. The launcher points it at the standard library via PYTHONHOME.
cp "$RES/python/bin/python3.12" "$APP/Contents/MacOS/python3.12"
rm -rf "$RES/python/bin" "$RES/python/include" "$RES/python/share" \
  "$RES/python/lib"/tcl* "$RES/python/lib"/tk* "$RES/python/lib"/itcl* "$RES/python/lib"/thread* "$RES/python/lib"/pkgconfig \
  "$RES/python/lib/python3.12"/{test,idlelib,tkinter,turtledemo,ensurepip,lib2to3} "$RES/python/lib/python3.12/site-packages"
# --python-platform pins wheels to the oldest macOS uv targets, not whatever this build machine runs.
uv pip install -q --python-platform aarch64-apple-darwin --python-version 3.12 --target "$RES/site-packages" \
  fastapi "uvicorn[standard]" python-multipart pyyaml mlx-whisper pywebview imageio-ffmpeg 2>&1 | tail -3 || true
ls "$RES/site-packages" | grep -q '^fastapi$' || { echo "dependency install failed"; exit 1; }
# mlx-whisper only needs torch for model conversion, which the app never does; it is the largest dependency.
rm -rf "$RES/site-packages"/{torch,torchgen,functorch,sympy,mpmath,networkx,PyObjCTest} "$RES/site-packages"/*/tests 2>/dev/null || true
find "$RES" -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null || true
FFMPEG="$(ls "$RES/site-packages"/imageio_ffmpeg/binaries/ffmpeg-* | head -1)"
ln -s "../site-packages/imageio_ffmpeg/binaries/$(basename "$FFMPEG")" "$RES/bin/ffmpeg"
# ffprobe is only used as an availability check; transcription needs ffmpeg alone.
printf '#!/bin/sh\nexit 0\n' > "$RES/bin/ffprobe"; chmod +x "$RES/bin/ffprobe"

# The app needs at least the newest macOS any bundled binary was built for.
MINOS="$(find "$RES" "$APP/Contents/MacOS" \( -name '*.so' -o -name '*.dylib' -o -name 'python3.12' \) -type f -print0 2>/dev/null \
  | xargs -0 -n1 sh -c 'vtool -show-build "$0" 2>/dev/null | awk "/minos/{print \$2}"' | sort -t. -k1,1n -k2,2n | tail -1)"
MINOS="${MINOS:-14.0}"
echo "    minimum macOS: $MINOS"

echo "==> App code"
rsync -a --exclude __pycache__ --exclude '*.pyc' app "$RES/src/"
rsync -a web/out/ "$RES/web/"

echo "==> Launcher, icon, Info.plist"
cat > "$APP/Contents/MacOS/DesignCoach" <<'LAUNCH'
#!/bin/bash
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
export PYTHONPATH="$RES/src:$RES/site-packages"
export PYTHONDONTWRITEBYTECODE=1
# Finder-launched apps can lack these, and the claude CLI needs USER to find its login in the Keychain.
export USER="${USER:-$(id -un)}" LOGNAME="${LOGNAME:-$(id -un)}"
export SD_COACH_WEB="$RES/web"
# A Finder-launched app has a bare PATH; the claude CLI may live in any of these.
export PATH="$RES/bin:$HOME/.local/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export PYTHONHOME="$RES/python"
exec "$RES/../MacOS/python3.12" -m app.desktop
LAUNCH
chmod +x "$APP/Contents/MacOS/DesignCoach"

ICONSET="$(mktemp -d)/icon.iconset"; mkdir -p "$ICONSET"
swiftc -O packaging/make_icon.swift -o "$ICONSET/../make_icon"
"$ICONSET/../make_icon" "$ICONSET/base.png"
for s in 16 32 128 256 512; do
  sips -z $s $s "$ICONSET/base.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$ICONSET/base.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
rm "$ICONSET/base.png"
iconutil -c icns "$ICONSET" -o "$RES/DesignCoach.icns"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Design Coach</string>
  <key>CFBundleDisplayName</key><string>Design Coach</string>
  <key>CFBundleIdentifier</key><string>com.mercadore.designcoach</string>
  <key>CFBundleVersion</key><string>__VERSION__</string>
  <key>CFBundleShortVersionString</key><string>__VERSION__</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>DesignCoach</string>
  <key>CFBundleIconFile</key><string>DesignCoach</string>
  <key>LSMinimumSystemVersion</key><string>__MINOS__</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.education</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>Design Coach records your spoken answers so they can be transcribed on this Mac.</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
sed -i "" -e "s/__MINOS__/$MINOS/" -e "s/__VERSION__/${VERSION:-1.0.0}/" "$APP/Contents/Info.plist"

echo "==> Signing"
if [ -n "${SIGN_ID:-}" ]; then
  # Developer ID: hardened runtime + the entitlements Python and the microphone need.
  codesign --force --deep --options runtime --timestamp --entitlements packaging/entitlements.plist --sign "$SIGN_ID" "$APP"
else
  codesign --force --deep --entitlements packaging/entitlements.plist --sign - "$APP"
fi
codesign --verify --deep --strict "$APP" && echo "    signature ok"
# Nothing inside may point back at this machine.
if find "$APP" -type l -exec readlink {} \; | grep -q '^/'; then echo "bundle contains absolute symlinks"; exit 1; fi

# The app must start with a bare environment, like a double-click from Finder.
echo "==> Smoke test"
SMOKE_HOME="$(mktemp -d)"
env -i HOME="$HOME" SD_COACH_HOME="$SMOKE_HOME" PATH=/usr/bin:/bin "$APP/Contents/MacOS/DesignCoach" >"$SMOKE_HOME/out.log" 2>&1 &
SPID=$!
OK=""
for _ in $(seq 1 60); do
  PORT="$(lsof -nP -a -p "$SPID" -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR==2{split($9,a,":"); print a[2]}' || true)"
  if [ -n "$PORT" ] && curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && curl -sf "http://127.0.0.1:$PORT/settings/" >/dev/null; then OK=1; break; fi
  sleep 1
done
for _ in $(seq 1 30); do   # the Claude login check takes a few seconds
  H="$(curl -sf "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)"
  case "$H" in *'"claude_ok":null'*|"") sleep 1;; *) break;; esac
done
echo "    claude check: $(echo "$H" | sed -E 's/.*"claude_ok":([a-z]+).*/\1/') (true if claude is installed and logged in on this Mac)"
kill "$SPID" 2>/dev/null || true
[ -n "$OK" ] || { echo "Smoke test FAILED"; cat "$SMOKE_HOME/out.log"; exit 1; }
echo "    app starts and serves the UI"

if [ -n "${DMG:-}" ]; then
  echo "==> DMG"
  STAGE="$(mktemp -d)"
  cp -R "$APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  cp packaging/READ_ME_FIRST.txt "$STAGE/Read me first.txt"
  rm -f "$OUT/Design Coach.dmg"
  hdiutil create -quiet -volname "Design Coach" -srcfolder "$STAGE" -ov -format UDZO "$OUT/Design Coach.dmg"
  if [ -n "${SIGN_ID:-}" ]; then
    codesign --force --timestamp --sign "$SIGN_ID" "$OUT/Design Coach.dmg"
    if [ -n "${NOTARY_PROFILE:-}" ]; then
      echo "==> Notarizing (a few minutes)"
      xcrun notarytool submit "$OUT/Design Coach.dmg" --keychain-profile "$NOTARY_PROFILE" --wait
      xcrun stapler staple "$OUT/Design Coach.dmg"
    fi
  fi
fi
echo "Done: $APP ($(du -sh "$APP" | cut -f1))"
