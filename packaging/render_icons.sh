#!/bin/bash
# Re-renders packaging/icon-1024.png and the web icons from the two SVGs. Needs Google Chrome (headless). Run after editing an SVG, commit the PNGs.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
render() { # svg out.png transparent(0|1)
  local bg=FFFFFFFF; [ "$3" = 1 ] && bg=00000000
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1024,1024 \
    --default-background-color=$bg --screenshot="$2" "file://$PWD/$1" >/dev/null 2>&1
}
render packaging/icon.svg packaging/icon-1024.png 1
render packaging/icon-flat.svg /tmp/icon-flat-1024.png 0
for s in 192 512; do sips -z $s $s /tmp/icon-flat-1024.png --out web/public/icon-$s.png >/dev/null; done
cp web/public/icon-512.png web/public/icon-maskable-512.png
sips -z 180 180 /tmp/icon-flat-1024.png --out web/public/apple-touch-icon.png >/dev/null
