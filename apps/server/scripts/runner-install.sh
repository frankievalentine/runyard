#!/usr/bin/env bash
# Adapted from aarondfrancis/fleet (worker-install.sh). Runs on a macOS or Linux
# machine. Runyard supplies RF_* values on SSH stdin, ahead of run_as_root
# (run-as-root.sh); no GitHub credential or generated config is written to disk.
set -euo pipefail

: "${RF_ROOT:?}"
: "${RF_NAME:?}"
: "${RF_URL:?}"
: "${RF_LABELS:?}"
: "${RF_TOKEN:?}"
: "${RF_ASSET_URL:?}"
: "${RF_ASSET_NAME:?}"
: "${RF_SERVICE_MODE:?}"

case "$RF_ASSET_URL" in
  https://github.com/actions/runner/releases/download/*) ;;
  *) echo "refusing unexpected runner asset URL: $RF_ASSET_URL" >&2; exit 2 ;;
esac

case "$RF_ROOT" in
  "$HOME/runyard-runners"/*) ;;
  *) echo "refusing root outside $HOME/runyard-runners: $RF_ROOT" >&2; exit 2 ;;
esac

if [ "$RF_SERVICE_MODE" != launchagent ] && [ "$RF_SERVICE_MODE" != systemd ]; then
  echo "unsupported service mode: $RF_SERVICE_MODE" >&2
  exit 2
fi

if [ -f /etc/NIXOS ]; then
  if [ ! -x /bin/bash ] || [ ! -e /run/current-system/sw/share/nix-ld/lib/libicuuc.so ]; then
    echo "NixOS needs Runyard's runner prerequisites module imported and rebuilt first (see the README, NixOS)" >&2
    exit 2
  fi
  export LD_LIBRARY_PATH="/run/current-system/sw/share/nix-ld/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

start_service() {
  if [ -f /etc/NIXOS ]; then
    run_as_root systemctl start "$(cat .service)"
  elif [ "$RF_SERVICE_MODE" = systemd ]; then
    run_as_root ./svc.sh start
  else
    ./svc.sh start
  fi
}

install_service() {
  if [ -f /etc/NIXOS ]; then
    run_as_root python3 -c "$RF_NIXOS_SERVICE_HELPER" "$RF_ROOT" "$RF_NAME" "$(id -un)"
  elif [ "$RF_SERVICE_MODE" = systemd ]; then
    run_as_root ./svc.sh install "$(id -un)"
  else
    ./svc.sh install
  fi
}

if [ -f "$RF_ROOT/.runner" ]; then
  if ! tr -d '[:space:]' < "$RF_ROOT/.runner" | grep -F "\"agentName\":\"$RF_NAME\"" >/dev/null; then
    echo "configured runner at exact path does not have expected name $RF_NAME" >&2
    exit 3
  fi
  cd "$RF_ROOT"
  [ -f .service ] || install_service
  start_service
  echo "runner $RF_NAME already configured; ensured its service is started"
  exit 0
fi

if [ -d "$RF_ROOT" ] && [ -n "$(find "$RF_ROOT" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "refusing non-empty unconfigured directory: $RF_ROOT" >&2
  exit 3
fi

mkdir -p "$RF_ROOT"
archive="$(mktemp "${TMPDIR:-/tmp}/runyard.XXXXXX")"
cleanup() { rm -f "$archive"; }
trap cleanup EXIT HUP INT TERM

echo "downloading $RF_ASSET_NAME"
curl --fail --location --silent --show-error "$RF_ASSET_URL" --output "$archive"
if [ -n "${RF_CHECKSUM:-}" ]; then
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$archive" | awk '{print $1}')"
  else
    echo "cannot verify GitHub SHA-256 digest: shasum/sha256sum not found" >&2
    exit 4
  fi
  if [ "$actual" != "$RF_CHECKSUM" ]; then
    echo "SHA-256 mismatch for $RF_ASSET_NAME" >&2
    exit 4
  fi
  echo "verified GitHub SHA-256 digest"
else
  echo "warning: GitHub release metadata did not publish an asset digest" >&2
fi

tar -xzf "$archive" -C "$RF_ROOT"
cd "$RF_ROOT"
if [ "$RF_SERVICE_MODE" = systemd ]; then
  if [ -f /etc/NIXOS ]; then
    : # Dependencies come from the NixOS prerequisites module.
  elif [ -f /etc/arch-release ]; then
    run_as_root pacman -S --needed --noconfirm lttng-ust
  else
    run_as_root ./bin/installdependencies.sh
  fi
fi

# macOS ships bash 3.2, where an empty array trips set -u; the +-form expands to nothing.
group_args=()
if [ -n "${RF_RUNNER_GROUP:-}" ]; then group_args=(--runnergroup "$RF_RUNNER_GROUP"); fi
./config.sh --unattended \
  --url "$RF_URL" \
  --token "$RF_TOKEN" \
  --name "$RF_NAME" \
  ${group_args[@]+"${group_args[@]}"} \
  --labels "$RF_LABELS"
unset RF_TOKEN

install_service
start_service
unset RF_SUDO_PASSWORD
echo "installed and started $RF_NAME at $RF_ROOT"
