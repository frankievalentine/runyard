# Sets a GitHub runner's job hooks: both record each job for run history, and
# the job-completed one also clears what RF_CLEANUP says (off, workspace or
# docker). Writes runyard-job-started.sh and runyard-job-completed.sh into its
# directory, points .env at them (absolute paths, as the runner needs), records
# the mode in .runyard-cleanup and the hooks in .runyard-history, and restarts
# the service so the runner reads .env again. Runyard only sends this for an
# idle runner.
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

agent="$(tr -d '[:space:]' < .runner | sed -n 's/.*"agentName":"\([^"]*\)".*/\1/p')"
extra="$(mktemp "$root/.cleanup.XXXXXX")"
trap 'rm -f "$extra"' EXIT
if [ "$RF_CLEANUP" != off ]; then
  {
    echo "# Clears the job's workspace, only inside this runner's _work directory."
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
  } >"$extra"
fi
runyard_job_hooks "$root" "${agent:-runner}" "$extra"
if [ "$RF_CLEANUP" = off ]; then
  rm -f .runyard-cleanup
  echo "Set the runner to record its jobs for run history; it clears nothing after them."
else
  printf '%s\n' "$RF_CLEANUP" >.runyard-cleanup
  echo "Set the runner to record its jobs and clear its workspace after each one$([ "$RF_CLEANUP" = docker ] && echo ', pruning unused Docker data')."
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
