#!/usr/bin/env bash
# Starts one exact runner's service, after checking the directory is that runner.
set -euo pipefail
: "${RF_ROOT:?}"
: "${RF_NAME:?}"
: "${RF_SERVICE_MODE:?}"

case "$RF_ROOT" in
  "$HOME/runyard-runners"/*) ;;
  *) echo "refusing root outside $HOME/runyard-runners: $RF_ROOT" >&2; exit 2 ;;
esac
test -f "$RF_ROOT/.runner" || { echo "no configured runner at exact path $RF_ROOT" >&2; exit 3; }
tr -d '[:space:]' < "$RF_ROOT/.runner" | grep -F "\"agentName\":\"$RF_NAME\"" >/dev/null || {
  echo "runner name at exact path does not match $RF_NAME" >&2
  exit 3
}
cd "$RF_ROOT"
if [ ! -f .service ]; then
  if [ "$RF_SERVICE_MODE" = systemd ]; then run_as_root ./svc.sh install "$(id -un)"; else ./svc.sh install; fi
fi
if [ -f /etc/NIXOS ]; then
  run_as_root systemctl start "$(cat .service)"
elif [ "$RF_SERVICE_MODE" = systemd ]; then
  run_as_root ./svc.sh start
else
  ./svc.sh start
fi
unset RF_SUDO_PASSWORD
echo "started $RF_NAME"
