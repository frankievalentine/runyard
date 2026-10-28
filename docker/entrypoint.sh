#!/bin/sh
# Copies the host's SSH keys, config and known_hosts from the read-only mount at
# /ssh into ~/.ssh with the ownership and modes ssh insists on, then runs Runyard.
set -eu
if [ -d /ssh ]; then
  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh"
  for f in /ssh/*; do
    [ -f "$f" ] || continue
    case "$(basename "$f")" in
      authorized_keys) continue ;;
      *.pub | known_hosts | known_hosts.old | config) mode=644 ;;
      *) mode=600 ;;
    esac
    install -m "$mode" "$f" "$HOME/.ssh/$(basename "$f")"
  done
fi
exec "$@"
