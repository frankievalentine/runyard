#!/bin/sh
# Runyard machine teardown, for macOS and Linux: removes what Runyard's setup
# left, once Runyard has removed its runners (decommission the machine and
# run its review first). Run on the machine, as the account Runyard used:
#   curl -fsSL <runyard>/api/machine-setup/teardown.sh | sh
# It deletes ~/runyard-runners and Runyard's key from ~/.ssh/authorized_keys.
# For a machine set up with --prepare, run it as root with --prepared instead:
#   curl -fsSL <runyard>/api/machine-setup/teardown.sh | sudo sh -s -- --prepared
# That also removes the runyard account (and its home), its sudoers file and
# lingering. It refuses while any runner there is still configured or running.
# Tools installed through tool profiles stay.
set -eu

key='__RUNYARD_KEY__'
body="$(printf '%s' "$key" | awk '{print $2}')"
prepared=no
for arg in "$@"; do
  case "$arg" in
    --prepared) prepared=yes ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# Refuses while Runyard's runners are still there: Runyard deregisters them, not this script.
check_runners() {
  root="$1/runyard-runners"
  [ -d "$root" ] || return 0
  configured="$(find "$root" -name .runner 2>/dev/null | head -n 1)"
  if [ -n "$configured" ]; then
    echo "A runner is still configured at $(dirname "$configured")." >&2
    echo "Decommission the machine in Runyard and run its review first, so the runner is deregistered." >&2
    exit 1
  fi
  if command -v pgrep >/dev/null 2>&1 && pgrep -f "$root/" >/dev/null 2>&1; then
    echo "Something is still running from $root; let its job finish, then run this again." >&2
    exit 1
  fi
}

# Removes Runyard's key from an account's authorized_keys, keeping every other line.
remove_key() {
  authorized="$1/.ssh/authorized_keys"
  [ -f "$authorized" ] || return 0
  if grep -qF "$body" "$authorized"; then
    kept="$(mktemp "$1/.ssh/authorized_keys.XXXXXX")"
    grep -vF "$body" "$authorized" >"$kept" || true
    chmod 600 "$kept"
    [ "$(id -u)" = 0 ] && chown "$2:" "$kept"
    mv "$kept" "$authorized"
    echo "Removed Runyard's key from $authorized."
  fi
}

if [ "$prepared" = yes ]; then
  [ "$(id -u)" = 0 ] || { echo "--prepared needs root: pipe it to 'sudo sh -s -- --prepared'." >&2; exit 2; }
  if ! id runyard >/dev/null 2>&1; then
    echo "There's no runyard account here; run it without --prepared as the account Runyard used." >&2
    exit 2
  fi
  home="$(getent passwd runyard | cut -d: -f6)"
  check_runners "$home"
  rm -f /etc/sudoers.d/runyard
  # userdel refuses while any of the account's processes are left, and its systemd user
  # manager takes a moment to stop: end its sessions, wait, then force what's still there.
  if command -v loginctl >/dev/null 2>&1; then
    loginctl disable-linger runyard >/dev/null 2>&1 || true
    loginctl terminate-user runyard >/dev/null 2>&1 || true
  fi
  pkill -u runyard >/dev/null 2>&1 || true
  waited=0
  while pgrep -u runyard >/dev/null 2>&1 && [ "$waited" -lt 10 ]; do
    sleep 1
    waited=$((waited + 1))
  done
  pkill -KILL -u runyard >/dev/null 2>&1 || true
  sleep 1
  userdel -r runyard 2>/dev/null || userdel runyard
  echo "Removed the runyard account, its home, its sudoers file and lingering."
else
  user="$(id -un)"
  check_runners "$HOME"
  if [ -d "$HOME/runyard-runners" ]; then
    rm -rf "$HOME/runyard-runners"
    echo "Removed $HOME/runyard-runners."
  fi
  remove_key "$HOME" "$user"
fi
echo "Done. Runyard no longer has access here. Tools installed through tool profiles stay."
