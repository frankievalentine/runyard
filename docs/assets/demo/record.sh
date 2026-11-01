#!/usr/bin/env bash
# Records the README's walkthrough of the demo yard: the overview, adding a
# machine from the tailnet, a new pool from start to running runners, Settings,
# and removing a machine. Starts its own demo (`apps/server/scripts/demo.ts`)
# with fresh data, creates an admin off camera, drives the dashboard with
# agent-browser and records it, zooming in on each action as it goes.
# Needs agent-browser, ffmpeg and bun. Writes runyard-demo.mp4 here, or to $1.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
out="${1:-$here/runyard-demo.mp4}"
port="${RUNYARD_DEMO_PORT:-7499}"
url="http://127.0.0.1:$port"
# A plain path, since Settings shows the data directory on screen.
data=/tmp/runyard-demo
rm -rf "$data"
mkdir -p "$data"
raw="$data/raw.mp4"
export AGENT_BROWSER_SESSION="runyard-demo-video"

RUNYARD_DATA_DIR="$data/data" RUNYARD_PORT="$port" RUNYARD_WEBHOOK_PORT="$((port + 1))" \
  bun "$repo/apps/server/scripts/demo.ts" >"$data/demo.log" 2>&1 &
demo=$!
trap 'agent-browser record stop >/dev/null 2>&1 || true; agent-browser close >/dev/null 2>&1 || true; kill "$demo" 2>/dev/null || true; rm -rf "$data"' EXIT
code=""
for _ in $(seq 1 30); do
  code="$(grep -oE '[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}' "$data/demo.log" | head -n 1 || true)"
  [ -n "$code" ] && break
  sleep 0.5
done
[ -n "$code" ] || { echo "The demo didn't start:" >&2; cat "$data/demo.log" >&2; exit 1; }

ab() { agent-browser "$@" >/dev/null; }
# Snapshot ref of the first element whose role and name start like this.
ref() { agent-browser snapshot -i | grep -F -- "$1 \"$2" | head -n 1 | grep -oE 'ref=e[0-9]+' | cut -d= -f2; }
# The camera: zooms the page itself (the recorded pointer sits outside <body>), easing from
# where it was, and keeps the frame on the page. The browser hit-tests the zoomed page, so
# clicks still land. Arguments: x y zoom, whether x y are on screen or on the page, and
# optionally a page x to use instead (to keep a whole row in frame, not just its button).
ab_cam() {
  ab eval "(() => {
    const [W, H] = [innerWidth, innerHeight];
    const { tx = 0, ty = 0, z: was = 1 } = window.__cam ?? {};
    let [x, y] = [$1, $2];
    if ('$4' === 'screen') [x, y] = [(x - tx) / was, (y - ty) / was];
    if ('${5:-}' !== '') x = Number('${5:-}');
    const z = $3;
    const nx = Math.min(0, Math.max(W - W * z, W / 2 - x * z));
    const ny = Math.min(0, Math.max(H - H * z, H / 2 - y * z));
    const b = document.body;
    b.style.transformOrigin = '0 0';
    b.style.transition = 'transform 0.5s cubic-bezier(0.45, 0, 0.2, 1)';
    b.style.transform = 'translate(' + nx + 'px, ' + ny + 'px) scale(' + z + ')';
    window.__cam = { tx: nx, ty: ny, z };
  })()"
  sleep 0.5
}
# Points the camera at page point x y with zoom z.
cam() { ab_cam "$1" "$2" "$3" page; }
home() { cam 720 450 1; }
# Points the camera at an element (a snapshot ref such as @e1, or a CSS selector) with zoom
# z, optionally at page x instead of the element's own.
look() {
  local box
  box="$(agent-browser get box "$1")"
  ab_cam "$(awk '/^x:/ { x = $2 } /^width:/ { w = $2 } END { printf "%.0f", x + w / 2 }' <<<"$box")" \
    "$(awk '/^y:/ { y = $2 } /^height:/ { h = $2 } END { printf "%.0f", y + h / 2 }' <<<"$box")" \
    "$2" screen "${3:-}"
}
# The pointer, drawn in the page and moved with CSS transitions, so it glides at the
# recording's frame rate (moving the real mouse step by step only manages a few updates a
# second). It hangs off <html>, outside the zoomed <body>. The real mouse follows in one
# move when the pointer arrives, so hover states and clicks happen where it is.
MX=840
MY=480
pointer() {
  ab eval "(() => {
    if (document.getElementById('demo-pointer')) return;
    const p = document.createElement('div');
    p.id = 'demo-pointer';
    p.innerHTML = '<svg width=\"22\" height=\"28\" viewBox=\"0 0 22 28\"><path d=\"M2 2 L2 22 L7.5 17 L11 25.5 L14.5 24 L11 15.8 L18.5 15.8 Z\" fill=\"#fff\" stroke=\"#111\" stroke-width=\"1.6\" stroke-linejoin=\"round\"/></svg>';
    Object.assign(p.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647',
      pointerEvents: 'none', transform: 'translate(${MX}px, ${MY}px)',
      filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.45))' });
    document.documentElement.appendChild(p);
  })()"
}
glide() {
  local ms
  ms="$(awk -v ax="$MX" -v ay="$MY" -v bx="$1" -v by="$2" \
    'BEGIN { d = sqrt((bx - ax) ^ 2 + (by - ay) ^ 2); t = 280 + d * 0.55; if (t > 750) t = 750; printf "%d\n", t }')"
  ab eval "(() => {
    const p = document.getElementById('demo-pointer');
    p.style.transition = 'transform ${ms}ms cubic-bezier(0.3, 0.7, 0.25, 1)';
    p.style.transform = 'translate(${1}px, ${2}px)';
  })()"
  sleep "$(awk -v ms="$ms" 'BEGIN { printf "%.2f\n", ms / 1000 }')"
  ab mouse move "$1" "$2"
  MX="$1"
  MY="$2"
}
# A click where the pointer is, with a ripple to show it.
click_here() {
  ab eval "(() => {
    const r = document.createElement('div');
    Object.assign(r.style, { position: 'fixed', left: '${MX}px', top: '${MY}px', width: '34px', height: '34px',
      margin: '-17px 0 0 -17px', borderRadius: '50%', background: 'rgb(90 150 255 / 0.35)',
      border: '2px solid rgb(90 150 255 / 0.8)', zIndex: '2147483646', pointerEvents: 'none',
      transform: 'scale(0.3)', opacity: '1', transition: 'transform 0.45s ease-out, opacity 0.45s ease-out' });
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => requestAnimationFrame(() => { r.style.transform = 'scale(1.4)'; r.style.opacity = '0'; }));
    setTimeout(() => r.remove(), 600);
  })()"
  ab mouse down
  ab mouse up
}
# An element's center on screen, as "x y".
center() {
  agent-browser get box "$1" |
    awk '/^x:/ { x = $2 } /^y:/ { y = $2 } /^width:/ { w = $2 } /^height:/ { h = $2 } END { printf "%.0f %.0f\n", x + w / 2, y + h / 2 }'
}
# Scrolls the page smoothly until an element is comfortably on screen, so a click never
# lands while the page jumps under it. Only the main panel scrolls: FIXED=1 skips it for
# the sidebar's own controls.
reveal() {
  local x y
  [ "${FIXED:-}" = 1 ] && return 0
  read -r x y < <(center "$1")
  if [ "$y" -gt 820 ] || [ "$y" -lt 110 ]; then
    scroll "$((y - 450))"
    sleep 0.7
  fi
}
# Clicks an element: brought on screen, the pointer glides to it, a beat, the click.
tap() {
  local r x y
  r="$(ref "$1" "$2")"
  [ -n "$r" ] || { echo "No $1 \"$2\" on the page." >&2; exit 1; }
  reveal "@$r"
  read -r x y < <(center "@$r")
  glide "$x" "$y"
  sleep 0.2
  click_here
  sleep 0.3
}
# Zooms in on an element (role and name) and stays there for the clicks that follow
# around it, until home. A third argument sets the page x to center on instead.
ZOOM=1.3
focus() {
  local r
  r="$(ref "$1" "$2")"
  [ -n "$r" ] || { echo "No $1 \"$2\" on the page." >&2; exit 1; }
  reveal "@$r"
  look "@$r" "$ZOOM" "${3:-}"
}
# One click with its own zoom in and out.
press() {
  focus "$1" "$2"
  tap "$1" "$2"
  home
}
# Scrolls the dashboard's own panel, which is what scrolls rather than the window.
scroll() { ab eval "document.querySelector('main .scroll').scrollBy({ top: $1, behavior: 'smooth' })"; }

# Off camera: the first admin, Getting started (all done) dismissed, Tailnet devices open.
ab set viewport 1440 900
ab open "$url/"
ab find label "Setup code" fill "$code"
ab find label "Username" fill demo
ab find label "Password" fill "demo password 1234"
ab find role button click --name "Create admin"
sleep 2.5
ab find role button click --name "Dismiss"
ab find role button click --name "TAILNET DEVICES"
ab mouse move 840 480
sleep 1

pointer
ab record start "$raw" --fps 60
sleep 1.5
# The yard at a glance, and what needs attention.
scroll 520
sleep 2
scroll -520
sleep 1

# A machine from the tailnet: Runyard lists the devices it can see.
tap link "Add machines"
sleep 1.2
focus button "Add" 900
tap button "Add"
tap button "Add lab-pi"
home
sleep 3.5

# A pool: what it's for, where it runs, then each machine's review.
tap link "New pool"
sleep 1
tap checkbox "frankie-demo/site"
tap checkbox "frankie-demo/cli"
tap textbox "Labels"
ab keyboard type "web-build"
sleep 0.4
tap button "Continue"
sleep 0.8
tap checkbox "lab-pi"
tap button "Continue"
sleep 2
tap button "Create and review"
sleep 2
run="$(agent-browser snapshot -i | grep -oE 'button "Run [0-9]+ changes?"' | head -n 1 | sed -E 's/^button "(.*)"$/\1/')"
press button "$run"
sleep 3.5

# Settings: connections, and what this machine has.
FIXED=1 focus button "Account and settings"
FIXED=1 tap button "Account and settings"
sleep 0.4
tap menuitem "Settings"
home
sleep 1
tap link "Connections"
sleep 2.5

# Removing a machine: what goes, one confirmation, each step as it runs.
tap button "Spare LXC"
sleep 1.2
press button "Remove"
sleep 0.8
look '[role=alertdialog]' "$ZOOM"
tap button "Remove machine"
sleep 1.2
tap button "Yes, remove Spare LXC"
sleep 2
home
sleep 3
ab record stop

ffmpeg -loglevel error -y -i "$raw" \
  -c:v libx264 -pix_fmt yuv420p -profile:v high -crf 24 -movflags +faststart -an "$out"
echo "Wrote $out"
