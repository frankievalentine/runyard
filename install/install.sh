#!/bin/sh
# Installs runyard from a release directory (the files `vp run release` writes),
# checking the binary against that directory's SHA256SUMS. The checksum catches
# a corrupt or swapped download only when SHA256SUMS comes from a source you trust.
#
#   RUNYARD_BASE_URL=https://example.com/runyard/0.1.0 sh install.sh
#
# RUNYARD_INSTALL_DIR overrides where it goes (default ~/.local/bin).
set -eu

base="${RUNYARD_BASE_URL:-${1:-}}"
if [ -z "$base" ]; then
  echo "Set RUNYARD_BASE_URL to the release directory's address." >&2
  exit 2
fi
case "$base" in
  https://* | file://*) ;;
  *) echo "RUNYARD_BASE_URL must start with https:// or file://" >&2; exit 2 ;;
esac
base="${base%/}"
dir="${RUNYARD_INSTALL_DIR:-$HOME/.local/bin}"

os="$(uname -s)"
arch="$(uname -m)"
case "$os-$arch" in
  Darwin-arm64) target=darwin-arm64 ;;
  Linux-x86_64 | Linux-amd64) target=linux-x64 ;;
  Linux-aarch64 | Linux-arm64) target=linux-arm64 ;;
  Darwin-x86_64) echo "Runyard is built for Apple silicon Macs only." >&2; exit 2 ;;
  *) echo "There's no runyard build for $os $arch." >&2; exit 2 ;;
esac
if [ "$os" = Linux ] && ldd --version 2>&1 | grep -qi musl; then
  echo "runyard needs glibc; musl systems such as Alpine aren't supported. Use the Docker image." >&2
  exit 2
fi

tmp="$(mktemp -d "${TMPDIR:-/tmp}/runyard.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
fetch() { curl --fail --location --silent --show-error --proto '=https,file' "$base/$1" --output "$tmp/$2"; }

fetch VERSION VERSION
version="$(tr -d '[:space:]' < "$tmp/VERSION")"
file="runyard-$version-$target"
fetch SHA256SUMS SHA256SUMS
expected="$(awk -v f="$file" '$2 == f { print $1 }' "$tmp/SHA256SUMS")"
if [ -z "$expected" ]; then
  echo "SHA256SUMS lists no $file." >&2
  exit 3
fi
echo "Downloading $file"
fetch "$file" runyard
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/runyard" | awk '{ print $1 }')"
else
  actual="$(shasum -a 256 "$tmp/runyard" | awk '{ print $1 }')"
fi
if [ "$actual" != "$expected" ]; then
  echo "SHA-256 mismatch for $file; nothing was installed." >&2
  exit 4
fi

mkdir -p "$dir"
install -m 755 "$tmp/runyard" "$dir/runyard"
echo "Installed runyard $version at $dir/runyard"
case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "Add $dir to your PATH to run it as \`runyard\`." ;;
esac
cat <<NEXT

Next:
  runyard                    start it in this terminal
  runyard service install    keep it running in the background
Already running as a service? Run \`runyard service install\` again to restart on the new version.
NEXT
