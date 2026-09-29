#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/design/banner/banner.html"
out="$root/design/banner/banner.png"

for candidate in \
  "${CHROME:-}" \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "$(command -v google-chrome || true)" \
  "$(command -v chromium || true)"; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then browser="$candidate"; break; fi
done

if [[ -z "${browser:-}" ]]; then
  echo "No Chromium-based browser found; set CHROME=/path/to/chrome" >&2
  exit 1
fi

"$browser" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1280,480 \
  --virtual-time-budget=2000 \
  --screenshot="$out" "file://$src" >/dev/null 2>&1

echo "$out"
