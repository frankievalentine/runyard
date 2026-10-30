#!/usr/bin/env bash
# Has one exact forgejo-runner write its output to runner.log in its directory,
# where run history reads which tasks it took, and restarts it. For runners
# installed before run history; new installs write there from the start.
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
unit_path="/etc/systemd/system/$unit"
test -f "$unit_path" || { echo "no service file at $unit_path" >&2; exit 3; }
if ! grep -q '^StandardOutput=append:' "$unit_path"; then
  # Written as this user, then installed by root, as at install.
  unit_file="$(mktemp "${TMPDIR:-/tmp}/runyard-unit.XXXXXX")"
  awk -v log="$RF_ROOT/runner.log" '
    { print }
    /^ExecStart=/ {
      print "# Run history reads which tasks it took from here; the account can read it without sudo."
      print "StandardOutput=append:" log
      print "StandardError=append:" log
    }' "$unit_path" > "$unit_file"
  run_as_root install -m 644 "$unit_file" "$unit_path"
  rm -f "$unit_file"
  run_as_root systemctl daemon-reload
fi
# Keep the log small: past 5 MB, only its last 1 MB.
if [ -f runner.log ] && [ "$(wc -c < runner.log)" -gt 5242880 ]; then
  tail -c 1048576 runner.log > runner.log.new && cat runner.log.new > runner.log && rm -f runner.log.new
fi
run_as_root systemctl restart "$unit"
printf '1\n' > .runyard-history
unset RF_SUDO_PASSWORD
echo "set $RF_NAME to record its jobs for run history and restarted it"
