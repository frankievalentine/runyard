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
    rm -rf "$dir"
    printf 'RJ\texited\t%s\n' "$name"
  fi
done
printf 'RJ_END\n'
