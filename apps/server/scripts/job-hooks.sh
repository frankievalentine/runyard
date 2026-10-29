# Runyard's runner hooks, for run history and (through the job-completed hook) cleanup.
# runyard_job_hooks <runner directory> <runner name> [file of extra job-completed commands]
# writes runyard-job-started.sh and runyard-job-completed.sh into the directory and points
# its .env at them. Each appends one line to ~/runyard-runners/.runyard-jobs.log (seconds,
# event, runner, repository, run, attempt, workflow) and never fails the job.
runyard_job_hooks() {
  hooks_dir="$1"
  hooks_runner="$2"
  hooks_extra="${3:-}"
  hooks_log="$HOME/runyard-runners/.runyard-jobs.log"
  for hooks_event in started completed; do
    hook="$hooks_dir/runyard-job-$hooks_event.sh"
    {
      echo '#!/bin/sh'
      echo "# Written by Runyard. Records this job for run history and never fails it."
      printf "log='%s'\nrunner='%s'\nevent=%s\n" "$hooks_log" "$hooks_runner" "$hooks_event"
      cat <<'HOOK'
workflow="$(printf '%s' "${GITHUB_WORKFLOW:-}" | tr '\t\n\r' '   ')"
{ printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date +%s)" "$event" "${RUNNER_NAME:-$runner}" \
  "${GITHUB_REPOSITORY:-}" "${GITHUB_RUN_ID:-}" "${GITHUB_RUN_ATTEMPT:-1}" "$workflow" >>"$log"; } 2>/dev/null || true
# Past 1 MB, only the newest 5000 lines are kept.
if [ "$(wc -c <"$log" 2>/dev/null || echo 0)" -gt 1000000 ]; then
  tail -n 5000 "$log" >"$log.tmp" 2>/dev/null && mv "$log.tmp" "$log" 2>/dev/null || true
fi
HOOK
      if [ "$hooks_event" = completed ] && [ -n "$hooks_extra" ]; then cat "$hooks_extra"; fi
      echo 'exit 0'
    } >"$hook"
    chmod 755 "$hook"
  done
  hooks_env="$(mktemp "$hooks_dir/.env.XXXXXX")"
  if [ -f "$hooks_dir/.env" ]; then
    grep -v -e '^ACTIONS_RUNNER_HOOK_JOB_STARTED=' -e '^ACTIONS_RUNNER_HOOK_JOB_COMPLETED=' \
      "$hooks_dir/.env" >"$hooks_env" || true
  fi
  printf 'ACTIONS_RUNNER_HOOK_JOB_STARTED=%s\nACTIONS_RUNNER_HOOK_JOB_COMPLETED=%s\n' \
    "$hooks_dir/runyard-job-started.sh" "$hooks_dir/runyard-job-completed.sh" >>"$hooks_env"
  chmod 644 "$hooks_env"
  mv "$hooks_env" "$hooks_dir/.env"
  printf '1\n' >"$hooks_dir/.runyard-history"
}
