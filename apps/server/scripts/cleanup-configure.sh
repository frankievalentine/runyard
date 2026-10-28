# Sets what a GitHub runner clears after each job (RF_CLEANUP: off,
# workspace or docker) through the runner's job-completed hook: writes
# runyard-job-completed.sh into its directory, points .env's
# ACTIONS_RUNNER_HOOK_JOB_COMPLETED at it (an absolute path, as the runner
# needs), records the mode in .runyard-cleanup, and restarts the service so
# the runner reads .env again. Runyard only sends this for an idle runner.
set -eu

: "${RF_ROOT:?}"
: "${RF_CLEANUP:?}"
: "${RF_SERVICE_MODE:?}"
case "$RF_ROOT" in
  "$HOME/runyard-runners"/*) ;;
  *) echo "refusing root outside $HOME/runyard-runners: $RF_ROOT" >&2; exit 2 ;;
esac
case "$RF_CLEANUP" in off | workspace | docker) ;; *) echo "unknown cleanup: $RF_CLEANUP" >&2; exit 2 ;; esac
[ -f "$RF_ROOT/.runner" ] || { echo "no configured runner at $RF_ROOT" >&2; exit 3; }
cd "$RF_ROOT"
root="$(pwd -P)"
hook="$root/runyard-job-completed.sh"

# .env without Runyard's line; the runner wrote the rest and keeps it.
kept="$(mktemp "$root/.env.XXXXXX")"
if [ -f .env ]; then grep -v '^ACTIONS_RUNNER_HOOK_JOB_COMPLETED=' .env >"$kept" || true; fi

if [ "$RF_CLEANUP" = off ]; then
  rm -f "$hook" .runyard-cleanup
  mv "$kept" .env
  echo "Removed Runyard's cleanup hook."
else
  {
    echo '#!/bin/sh'
    echo "# Written by Runyard for this runner's pool. Clears the job's workspace when"
    echo "# a job ends, only inside this runner's _work directory, and never fails the job."
    printf "root='%s'\n" "$root"
    cat <<'HOOK'
ws="${GITHUB_WORKSPACE:-}"
case "$ws" in
  "$root"/_work/?*)
    if [ -d "$ws" ]; then
      find "$ws" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
      echo "Runyard: cleared $ws"
    fi
    ;;
  *) echo "Runyard: left the workspace alone; it isn't under $root/_work" ;;
esac
HOOK
    if [ "$RF_CLEANUP" = docker ]; then
      cat <<'HOOK'
if command -v docker >/dev/null 2>&1; then
  # Stopped containers and unused networks, dangling images and anonymous volumes.
  docker container prune -f --filter until=10m >/dev/null 2>&1 || true
  docker image prune -f >/dev/null 2>&1 || true
  docker network prune -f >/dev/null 2>&1 || true
  docker volume prune -f >/dev/null 2>&1 || true
  echo "Runyard: pruned unused Docker data"
fi
HOOK
    fi
    echo 'exit 0'
  } >"$hook"
  chmod 755 "$hook"
  printf 'ACTIONS_RUNNER_HOOK_JOB_COMPLETED=%s\n' "$hook" >>"$kept"
  mv "$kept" .env
  printf '%s\n' "$RF_CLEANUP" >.runyard-cleanup
  echo "Set the runner to clear its workspace after each job$([ "$RF_CLEANUP" = docker ] && echo ' and prune unused Docker data')."
fi

# The runner reads .env when it starts.
if [ -f .service ]; then
  if [ -f /etc/NIXOS ]; then
    run_as_root systemctl restart "$(cat .service)"
  elif [ "$RF_SERVICE_MODE" = systemd ]; then
    run_as_root ./svc.sh stop >/dev/null && run_as_root ./svc.sh start >/dev/null
  else
    ./svc.sh stop >/dev/null && ./svc.sh start >/dev/null
  fi
  echo "Restarted the runner."
fi
