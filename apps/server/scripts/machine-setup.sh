#!/bin/sh
# Runyard machine setup, for macOS and Linux. Run on the machine, as the
# account Runyard should sign in as:
#   curl -fsSL <runyard>/api/machine-setup/script.sh | sh -s -- <code>
# It adds Runyard's public key to ~/.ssh/authorized_keys (without agent, port
# or X11 forwarding), then reports this account's name, the OS and the SSH
# host keys back to Runyard, which trusts exactly those keys. Nothing else on
# the machine changes, and nothing is installed.
set -eu

code="${1:-}"
case "$code" in
  "" | *[!A-Za-z0-9]*)
    echo "Run it with the code Runyard showed: ... | sh -s -- <code>" >&2
    exit 2
    ;;
esac
report_url='__RUNYARD_ORIGIN__/api/machine-setup/report'
key='__RUNYARD_KEY__'

case "$(uname -s)" in
  Darwin) os=macos ;;
  Linux) os=linux ;;
  *)
    echo "This script sets up macOS and Linux. On Windows, use the PowerShell command." >&2
    exit 2
    ;;
esac

user="$(id -un)"
case "$user" in
  "" | *[!A-Za-z0-9._-]*)
    echo "Runyard can't sign in as '$user'; use an account with a plain name." >&2
    exit 2
    ;;
esac

# The SSH server has to be on first: Runyard connects to it.
listening=unknown
if command -v nc >/dev/null 2>&1; then
  if nc -z -w 2 127.0.0.1 22 >/dev/null 2>&1; then listening=yes; else listening=no; fi
elif command -v ss >/dev/null 2>&1; then
  if ss -ltn 2>/dev/null | grep -Eq '[:.]22[[:space:]]'; then listening=yes; else listening=no; fi
elif command -v netstat >/dev/null 2>&1; then
  if netstat -an 2>/dev/null | grep -Eq '[:.]22[[:space:]].*LISTEN'; then listening=yes; else listening=no; fi
fi
if [ "$listening" = no ]; then
  echo "Nothing is listening for SSH on port 22. Turn the SSH server on, then run this again:" >&2
  if [ "$os" = macos ]; then
    echo "  System Settings > General > Sharing > Remote Login, or: sudo systemsetup -setremotelogin on" >&2
  else
    echo "  sudo apt install -y openssh-server && sudo systemctl enable --now ssh" >&2
    echo "  (Fedora: sudo dnf install -y openssh-server && sudo systemctl enable --now sshd)" >&2
  fi
  exit 1
fi

# Runyard's key, once.
umask 077
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
authorized="$HOME/.ssh/authorized_keys"
body="$(printf '%s' "$key" | awk '{print $2}')"
if [ -f "$authorized" ] && grep -qF "$body" "$authorized"; then
  echo "Runyard's key is already authorized for $user."
else
  printf 'no-agent-forwarding,no-port-forwarding,no-X11-forwarding %s\n' "$key" >>"$authorized"
  echo "Authorized Runyard's key for $user."
fi
chmod 600 "$authorized"

# The host's public keys: type and key only, which hold no characters JSON needs escaped.
host_keys=""
for file in /etc/ssh/ssh_host_*_key.pub; do
  [ -r "$file" ] || continue
  line="$(awk '{print $1 " " $2; exit}' "$file")"
  case "$line" in *[!A-Za-z0-9+/=@.\ -]*) continue ;; esac
  host_keys="${host_keys:+$host_keys,}\"$line\""
done
if [ -z "$host_keys" ]; then
  echo "Couldn't read this machine's SSH host keys in /etc/ssh; trust its key from the dashboard instead." >&2
fi

json="{\"code\":\"$code\",\"user\":\"$user\",\"os\":\"$os\",\"hostKeys\":[$host_keys]}"
if ! answer="$(curl -fsS -X POST -H 'Content-Type: application/json' --data "$json" "$report_url" 2>&1)"; then
  echo "Runyard didn't take the report: $answer" >&2
  echo "The code may have expired or been used; show a new one on the machine's page." >&2
  exit 1
fi
echo "Done. Runyard is checking this machine now; its page in the dashboard shows the result."
