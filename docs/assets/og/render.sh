#!/usr/bin/env bash
# Renders og.html into the social preview: og.png (a still, mid-crossing) and
# og.mp4 (the 10 s crossing as a seamless loop, 1200x630 H.264). Needs
# agent-browser and ffmpeg. The outputs go to apps/dashboard/public, which the
# dashboard serves at /og.png and /og.mp4, and og.png also to docs/assets.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
fps=24
seconds=10
frames="$(mktemp -d "${TMPDIR:-/tmp}/runyard-og.XXXXXX")"
trap 'rm -rf "$frames"; agent-browser close >/dev/null 2>&1 || true' EXIT
export AGENT_BROWSER_SESSION="runyard-og-render"

agent-browser open "file://$here/og.html" >/dev/null
agent-browser set viewport 1200 630 >/dev/null
total=$((fps * seconds))
for ((i = 0; i < total; i++)); do
  t="$(awk -v i="$i" -v f="$fps" 'BEGIN { printf "%.4f", i / f }')"
  agent-browser eval "(() => { const s = document.getElementById('scene'); s.pauseAnimations(); s.setCurrentTime($t); return 1; })()" >/dev/null
  agent-browser screenshot "$frames/$(printf '%04d' "$i").png" >/dev/null
done
agent-browser eval "(() => { const s = document.getElementById('scene'); s.setCurrentTime(4.2); return 1; })()" >/dev/null
agent-browser screenshot "$frames/still.png" >/dev/null

ffmpeg -loglevel error -y -framerate "$fps" -i "$frames/%04d.png" \
  -c:v libx264 -pix_fmt yuv420p -profile:v high -crf 23 -movflags +faststart -an \
  "$repo/apps/dashboard/public/og.mp4"
cp "$frames/still.png" "$repo/apps/dashboard/public/og.png"
cp "$frames/still.png" "$repo/docs/assets/og/og.png"
echo "Wrote og.mp4 and og.png."
