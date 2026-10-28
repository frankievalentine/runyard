#!/usr/bin/env bash
# Stops and uninstalls one exact forgejo-runner's service. Runyard deletes the
# runner on Forgejo; the directory is kept, with .runner renamed so it no
# longer looks configured.
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
cd "$RF_ROOT"
unit="$(cat .service)"
run_as_root systemctl disable --now "$unit"
run_as_root rm -f "/etc/systemd/system/$unit"
run_as_root systemctl daemon-reload
mv .runner .runner.removed
unset RF_SUDO_PASSWORD
echo "removed $RF_NAME; kept its directory $RF_ROOT"
