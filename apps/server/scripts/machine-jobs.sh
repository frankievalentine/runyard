# Read-only: run history's lines from this machine's job log, newer than
# RUNYARD_JOBS_SINCE (seconds; that second again, since re-reading only merges). Runyard's runner hooks append one line when a
# job starts and one when it ends: seconds, event, runner, repository, run,
# attempt, workflow, tab-separated. At most the newest 500 lines per read.
jobs_log="$HOME/runyard-runners/.runyard-jobs.log"
if [ -f "$jobs_log" ]; then
  awk -F '\t' -v since="${RUNYARD_JOBS_SINCE:-0}" '$1 ~ /^[0-9]+$/ && $1 + 0 >= since + 0 { print "RFJ\t" $0 }' "$jobs_log" | tail -n 500
fi
# Forgejo runners log each task they take ('task 12 repo is owner/repo ...'): Runyard's
# persistent runners into runner.log in their directory, one-job runners into theirs and the
# copy kept in jobs/.logs. One line per task: time as logged, runner, task, repository. The
# newest 200 per log; Runyard keeps only what's newer than its last read.
if [ -d "$HOME/runyard-runners" ]; then
  find "$HOME/runyard-runners" -maxdepth 4 -type f \( -name runner.log -o -path '*/jobs/.logs/*.log' \) 2>/dev/null |
    while IFS= read -r f; do
      case "$f" in
        */jobs/.logs/*) name="$(basename "$f" .log)" ;;
        */jobs/*/runner.log) name="$(basename "$(dirname "$f")")" ;;
        *) name="$(tr -d '[:space:]' < "$(dirname "$f")/.runner" 2>/dev/null | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')" ;;
      esac
      [ -n "$name" ] || continue
      awk -v name="$name" '
        match($0, /msg="task [0-9]+ repo is [^ "]+/) {
          t = $0; sub(/^time="/, "", t); sub(/".*/, "", t)
          split(substr($0, RSTART + 5, RLENGTH - 5), w, " ")
          print "RFF\t" t "\t" name "\t" w[2] "\t" w[5]
        }' "$f" | tail -n 200
    done
fi

