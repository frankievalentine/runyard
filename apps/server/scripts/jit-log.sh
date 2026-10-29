#!/usr/bin/env bash
# Prints one one-job runner's log: the kept one once it has exited, or the
# live one while it runs. Read-only.
set -u
: "${RF_NAME:?}"
for f in "$HOME"/runyard-runners/*/jobs/.logs/"$RF_NAME".log "$HOME"/runyard-runners/*/jobs/"$RF_NAME"/runner.log; do
  if [ -f "$f" ]; then
    tail -n 600 "$f"
    exit 0
  fi
done
echo "No log for $RF_NAME on this machine: it was removed after 7 days or 20 newer runners, or the runner started before Runyard kept logs." >&2
exit 4
