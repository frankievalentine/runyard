#!/usr/bin/env bash
# Deletes an on-demand pool's template directory, after checking it is one.
set -euo pipefail
: "${RF_ROOT:?}"
case "$RF_ROOT" in
  "$HOME/runyard-runners"/*/template-actions | "$HOME/runyard-runners"/*/template-forgejo) ;;
  *) echo "refusing template path outside $HOME/runyard-runners/<pool>/template-*: $RF_ROOT" >&2; exit 2 ;;
esac
if [ ! -e "$RF_ROOT" ]; then
  echo "no template at $RF_ROOT; nothing to remove"
  exit 0
fi
test -f "$RF_ROOT/.runyard-template" || { echo "refusing to delete $RF_ROOT: it isn't a Runyard template" >&2; exit 3; }
rm -rf "$RF_ROOT"
echo "removed the template at $RF_ROOT"
