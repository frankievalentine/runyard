#!/usr/bin/env bash
# Sets one exact forgejo-runner's labels (they live in its .runner file) and restarts it.
set -euo pipefail
: "${RF_ROOT:?}"
: "${RF_NAME:?}"
: "${RF_LABELS:?}"
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
labels_json="$(printf '%s' "$RF_LABELS" | awk -F, '{for(i=1;i<=NF;i++) printf "%s\"%s\"", (i>1?", ":""), $i}')"
umask 077
sed "s#^  \"labels\": .*#  \"labels\": [$labels_json]#" .runner > .runner.new
mv .runner.new .runner
run_as_root systemctl restart "$(cat .service)"
unset RF_SUDO_PASSWORD
echo "set $RF_NAME's labels to $RF_LABELS and restarted it"
