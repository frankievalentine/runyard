# Read-only: run history's lines from this machine's job log, newer than
# RUNYARD_JOBS_SINCE (seconds; that second again, since re-reading only merges). Runyard's runner hooks append one line when a
# job starts and one when it ends: seconds, event, runner, repository, run,
# attempt, workflow, tab-separated. At most the newest 500 lines per read.
jobs_log="$HOME/runyard-runners/.runyard-jobs.log"
if [ -f "$jobs_log" ]; then
  awk -F '\t' -v since="${RUNYARD_JOBS_SINCE:-0}" '$1 ~ /^[0-9]+$/ && $1 + 0 >= since + 0 { print "RFJ\t" $0 }' "$jobs_log" | tail -n 500
fi
