#!/usr/bin/env bash
# Reports each one-job runner directory under ~/runyard-runners/*/jobs: alive
# while its process runs, exited otherwise (and then removed). Directories
# without a process ID are removed once they are ten minutes old.
set -u
for dir in "$HOME"/runyard-runners/*/jobs/*; do
  [ -d "$dir" ] || continue
  name="${dir##*/}"
  pid="$(cat "$dir/.pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    printf 'RJ\talive\t%s\n' "$name"
  elif [ -n "$pid" ] || [ -n "$(find "$dir" -maxdepth 0 -mmin +10 -print 2>/dev/null)" ]; then
    # Gone without saving its log (killed, or the machine restarted): save what's there.
    logs="${dir%/*}/.logs"
    if [ ! -f "$logs/$name.log" ] && [ -f "$dir/runner.log" ]; then
      mkdir -p "$logs"
      {
        cat "$dir/runner.log"
        echo
        echo "Runyard: the runner's process was gone without exiting normally (killed, or the machine restarted)."
        for f in $(ls -t "$dir"/_diag/Runner_*.log "$dir"/_diag/Worker_*.log 2>/dev/null | head -n 4); do
          echo
          echo "== ${f#"$dir"/} (last 150 lines) =="
          tail -n 150 "$f"
        done
      } > "$logs/$name.log" 2>/dev/null || true
    fi
    rm -rf "$dir"
    printf 'RJ\texited\t%s\n' "$name"
  fi
done
printf 'RJ_END\n'
