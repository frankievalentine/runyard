#!/usr/bin/env bash
# Unpacks a runner program into an on-demand pool's template directory on a
# macOS or Linux machine, for one-job runners to be copied from. Nothing is
# configured or registered. Runyard supplies RF_* values on SSH stdin.
set -euo pipefail

: "${RF_ROOT:?}"
: "${RF_KIND:?}"
: "${RF_ASSET_URL:?}"
: "${RF_ASSET_NAME:?}"
: "${RF_VERSION:?}"

case "$RF_ROOT" in
  "$HOME/runyard-runners"/*/template-actions | "$HOME/runyard-runners"/*/template-forgejo) ;;
  *) echo "refusing template path outside $HOME/runyard-runners/<pool>/template-*: $RF_ROOT" >&2; exit 2 ;;
esac
case "$RF_KIND:$RF_ASSET_URL" in
  actions:https://github.com/actions/runner/releases/download/*) ;;
  forgejo:https://code.forgejo.org/forgejo/runner/releases/download/*) ;;
  *) echo "refusing unexpected download for $RF_KIND: $RF_ASSET_URL" >&2; exit 2 ;;
esac
if [ "$RF_KIND" = forgejo ] && [ "$(uname -s)" != Linux ]; then
  echo "forgejo-runner is only published for Linux" >&2
  exit 2
fi

if [ -f "$RF_ROOT/.runyard-template" ]; then
  echo "template already installed at $RF_ROOT: $(cat "$RF_ROOT/.runyard-template")"
  exit 0
fi
if [ -d "$RF_ROOT" ] && [ -n "$(find "$RF_ROOT" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "refusing non-empty directory that isn't a Runyard template: $RF_ROOT" >&2
  exit 3
fi

mkdir -p "$RF_ROOT"
download="$(mktemp "${TMPDIR:-/tmp}/runyard.XXXXXX")"
cleanup() { rm -f "$download"; }
trap cleanup EXIT HUP INT TERM
echo "downloading $RF_ASSET_NAME"
curl --fail --location --silent --show-error "$RF_ASSET_URL" --output "$download"
if [ -n "${RF_CHECKSUM:-}" ]; then
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$download" | awk '{print $1}')"
  else
    actual="$(sha256sum "$download" | awk '{print $1}')"
  fi
  if [ "$actual" != "$RF_CHECKSUM" ]; then
    echo "SHA-256 mismatch for $RF_ASSET_NAME" >&2
    exit 4
  fi
  echo "verified the published SHA-256"
else
  echo "warning: the release published no digest for $RF_ASSET_NAME" >&2
fi

if [ "$RF_KIND" = actions ]; then
  tar -xzf "$download" -C "$RF_ROOT"
  if [ "$(uname -s)" = Linux ] && [ ! -f /etc/NIXOS ]; then
    if [ -f /etc/arch-release ]; then
      run_as_root pacman -S --needed --noconfirm lttng-ust
    else
      (cd "$RF_ROOT" && run_as_root ./bin/installdependencies.sh)
    fi
  fi
else
  install -m 755 "$download" "$RF_ROOT/forgejo-runner"
fi
printf '%s %s\n' "$RF_KIND" "$RF_VERSION" > "$RF_ROOT/.runyard-template"
unset RF_SUDO_PASSWORD
echo "installed the $RF_KIND $RF_VERSION template at $RF_ROOT"
