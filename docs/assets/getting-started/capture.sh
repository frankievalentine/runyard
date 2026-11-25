#!/usr/bin/env bash
# Takes the screenshots in docs/getting-started.md from the demo yard: claiming Runyard, the
# forge connections, a machine's readiness check, a new pool, its review and the workflow to
# copy. Starts its own demo (`apps/server/scripts/demo.ts`) with fresh data and drives the
# dashboard with agent-browser, in the light theme with motion off, at 1.5x for sharp text.
# Needs agent-browser and bun. Writes the PNGs next to this script.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
port="${RUNYARD_DEMO_PORT:-7497}"
url="http://127.0.0.1:$port"
# A plain path, since Settings shows the data directory on screen.
data=/tmp/runyard-getting-started
rm -rf "$data"
mkdir -p "$data"
export AGENT_BROWSER_SESSION="runyard-getting-started"

RUNYARD_DATA_DIR="$data/data" RUNYARD_PORT="$port" RUNYARD_WEBHOOK_PORT="$((port + 1))" \
  bun "$repo/apps/server/scripts/demo.ts" >"$data/demo.log" 2>&1 &
demo=$!
trap 'agent-browser close >/dev/null 2>&1 || true; kill "$demo" 2>/dev/null || true; rm -rf "$data"' EXIT
code=""
for _ in $(seq 1 30); do
  code="$(grep -oE '[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}' "$data/demo.log" | head -n 1 || true)"
  [ -n "$code" ] && break
  sleep 0.5
done
[ -n "$code" ] || { echo "The demo didn't start:" >&2; cat "$data/demo.log" >&2; exit 1; }

ab() { agent-browser "$@" >/dev/null; }
# Waits (up to 10 seconds) until the page shows some text.
until_text() {
  for _ in $(seq 1 40); do
    [ "$(agent-browser eval "document.body.innerText.includes($(printf '%s' "$1" | sed "s/'/\\'/g; s/^/'/; s/$/'/"))")" = "true" ] && return 0
    sleep 0.25
  done
  echo "The page never showed \"$1\"." >&2
  exit 1
}
# Clicks the first element with this role whose name starts like this.
click() {
  local r
  r="$(agent-browser snapshot -i | grep -F -- "$1 \"$2" | head -n 1 | grep -oE 'ref=e[0-9]+' | cut -d= -f2)"
  [ -n "$r" ] || { echo "No $1 \"$2\" on the page." >&2; exit 1; }
  ab click "@$r"
}
# Scrolls the dashboard's own panel so the element with exactly this text sits just below the
# page's sticky heading, rather than tucked under it.
scroll_to() {
  ab eval "(() => {
    const main = document.querySelector('main.scroll');
    const el = [...main.querySelectorAll('*')].find((e) => !e.children.length && e.textContent.trim().toLowerCase() === '$1'.toLowerCase());
    if (!el) return;
    const head = main.querySelector('header');
    const below = head ? head.getBoundingClientRect().bottom : main.getBoundingClientRect().top;
    main.scrollBy({ top: el.getBoundingClientRect().top - below - 28 });
  })()"
  sleep 0.6
}
shot() { sleep "${2:-0.8}"; ab screenshot "$here/$1"; echo "Wrote $1"; }

ab set viewport 1280 800 1.5
ab set media light reduced-motion

# Step 2: claiming a new install with its setup code.
ab open "$url/"
until_text "Claim your Runyard"
ab find label "Setup code" fill "$code"
ab find label "Username" fill demo
shot claim.png
ab find label "Password" fill "demo password 1234"
ab find role button click --name "Create admin"
sleep 2.5
if agent-browser snapshot -i | grep -qF 'button "Skip for now"'; then
  ab find role button click --name "Skip for now"
  sleep 1.5
fi
# The sidebar open, so its section names show.
ab eval "localStorage.setItem('runyard.sidebar', 'expanded')"

# Step 3: the forge connections.
ab open "$url/settings/connections"
until_text "Settings"
shot connect.png 1.5

# Step 4: a device from the tailnet, through to its readiness check.
ab open "$url/machines/add"
until_text "Which machine?"
click button "Add and continue"
sleep 2
click button "Continue"
until_text "Checking lab-pi"
until_text "Continue"
shot add-machine.png 2.5

# Step 5: a pool for it: repositories and labels.
click button "Continue"
until_text "lab-pi is ready"
click link "Put it in a pool"
until_text "New pool"
click checkbox "frankie-demo/site"
click checkbox "frankie-demo/cli"
click textbox "Labels"
ab keyboard type "web-build"
scroll_to "Or choose yourself"
shot pool.png 1

# Step 6: where it runs, then the review of each machine's changes.
click button "Continue"
sleep 0.8
click checkbox "lab-pi"
click button "Continue"
sleep 1.5
click button "Create and review"
until_text "Review"
shot review.png 2

# Step 7: the runs-on line and the workflow to copy.
run="$(agent-browser snapshot -i | grep -oE 'button "Run [0-9]+ changes?"' | head -n 1 | sed -E 's/^button "(.*)"$/\1/')"
ab find role button click --name "$run"
until_text "is running"
scroll_to "Use it in a workflow"
shot workflow.png 1.5
