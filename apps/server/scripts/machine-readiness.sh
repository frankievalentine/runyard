# Read-only: whether this machine has what CI jobs commonly need. Runs after
# the diagnostics, in the same subshell, with RUNYARD_FORGE_HOSTS set to the
# forges' hosts. Reports presence (and a few versions) only; changes nothing.
# SSH sessions on a Mac leave Homebrew out of PATH; Runyard's runners get it.
if [ "$(uname -s)" = Darwin ]; then
  for dir in /usr/local/bin /opt/homebrew/bin; do
    if [ -d "$dir" ]; then PATH="$dir:$PATH"; fi
  done
  fact tool_brew "$(command -v brew 2>/dev/null)"
fi
for tool in git curl tar unzip zip xz zstd jq gpg cc make python3 node; do
  fact "tool_$tool" "$(command -v "$tool" 2>/dev/null)"
done
fact tool_git_version "$(git --version 2>/dev/null | head -n 1)"
if command -v docker >/dev/null 2>&1; then
  # The server's version answers only when this account can use the daemon.
  fact docker_server "$(docker version --format '{{.Server.Version}}' 2>/dev/null | head -n 1)"
  fact docker_cli "present"
fi
if [ "$(uname -s)" = Darwin ]; then
  fact xcode_clt "$(xcode-select -p 2>/dev/null)"
  fact xcode_version "$(xcodebuild -version 2>/dev/null | head -n 1)"
fi
if command -v nvidia-smi >/dev/null 2>&1; then
  fact nvidia_gpu "$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n 1)"
fi
fact epoch "$(date +%s)"
# Any HTTP answer means the forge is reachable; 000 means no connection.
i=0
for host in ${RUNYARD_FORGE_HOSTS:-}; do
  if command -v curl >/dev/null 2>&1; then
    code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "https://$host/" 2>/dev/null || true)"
    fact "reach_$i" "$host ${code:-000}"
  else
    fact "reach_$i" "$host unknown"
  fi
  i=$((i + 1))
done
fact readiness_complete 1
