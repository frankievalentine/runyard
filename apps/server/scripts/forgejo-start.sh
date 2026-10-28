#!/usr/bin/env bash
# Starts one exact forgejo-runner's service, after checking the directory is that runner.
set -euo pipefail
: "${RF_ROOT:?}"
: "${RF_NAME:?}"
case "$RF_ROOT" in
  "$HOME/runyard-runners"/*) ;;
  *) echo "refusing root outside $HOME/runyard-runners: $RF_ROOT" >&2; exit 2 ;;
esac
test -f "$RF_ROOT/.runner" || { echo "no configured runner at exact path $RF_ROOT" >&2; exit 3; }
tr -d '[:space:]' < "$RF_ROOT/.runner" | grep -F "\"name\":\"$RF_NAME\"" >/dev/null || {
  echo "runner name at exact path does not match $RF_NAME" >&2
  exit 3
}
run_as_root systemctl start "$(cat "$RF_ROOT/.service")"
unset RF_SUDO_PASSWORD
echo "started $RF_NAME"
