#!/bin/sh
# Runyard machine setup, for macOS and Linux. Run on the machine, as the
# account Runyard should sign in as:
#   curl -fsSL <runyard>/api/machine-setup/script.sh | sh -s -- <code>
# It adds Runyard's public key to ~/.ssh/authorized_keys (without agent, port
# or X11 forwarding), then reports this account's name, the OS and the SSH
# host keys back to Runyard, which trusts exactly those keys. Nothing is
# installed.
#
# On a fresh Linux machine, run it as root with --prepare instead:
#   curl -fsSL <runyard>/api/machine-setup/script.sh | sh -s -- <code> --prepare [--sudo]
# That also installs the SSH server (and sudo) if missing, creates a `runyard`
# account that signs in with Runyard's key only, keeps its processes running
# after it logs out, adds it to the docker group if Docker is installed, and
# gives it sudo: passwordless with --sudo (or if you say yes when asked),
# otherwise with a password you set.
set -eu

code="${1:-}"
case "$code" in
  "" | *[!A-Za-z0-9]*)
    echo "Run it with the code Runyard showed: ... | sh -s -- <code>" >&2
    exit 2
    ;;
esac
shift
prepare=no
nopasswd=ask
for arg in "$@"; do
  case "$arg" in
    --prepare) prepare=yes ;;
    --sudo) nopasswd=yes ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done
report_url='__RUNYARD_ORIGIN__/api/machine-setup/report'
key='__RUNYARD_KEY__'
account=runyard

case "$(uname -s)" in
  Darwin) os=macos ;;
  Linux) os=linux ;;
  *)
    echo "This script sets up macOS and Linux. On Windows, use the PowerShell command." >&2
    exit 2
    ;;
esac

# Appends Runyard's key to an account's authorized_keys once: authorize_key <home> <owner>.
authorize_key() {
  ssh_dir="$1/.ssh"
  authorized="$ssh_dir/authorized_keys"
  body="$(printf '%s' "$key" | awk '{print $2}')"
  (
    umask 077
    mkdir -p "$ssh_dir"
    if [ -f "$authorized" ] && grep -qF "$body" "$authorized"; then
      echo "Runyard's key is already authorized for $2."
    else
      printf 'no-agent-forwarding,no-port-forwarding,no-X11-forwarding %s\n' "$key" >>"$authorized"
      echo "Authorized Runyard's key for $2."
    fi
  )
  chmod 700 "$ssh_dir"
  chmod 600 "$authorized"
  if [ "$(id -u)" = 0 ]; then chown -R "$2:" "$ssh_dir"; fi
}

# Installs packages with whichever package manager the machine has.
install_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q "$@"
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q "$@"
  elif command -v zypper >/dev/null 2>&1; then
    zypper --non-interactive install "$@"
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm --needed "$@"
  else
    echo "No supported package manager (apt, dnf, yum, zypper or pacman); install $* by hand." >&2
    exit 1
  fi
}

# Whether there's a terminal to ask on: /dev/tty can exist without one, so open it to find out.
has_tty() { (: </dev/tty >/dev/tty) 2>/dev/null; }

# Asks a yes/no question on the terminal (stdin is this script). No terminal means no.
ask() {
  if has_tty; then
    printf '%s [y/N] ' "$1" >/dev/tty
    read -r answer </dev/tty || answer=""
    case "$answer" in [Yy]*) return 0 ;; esac
  fi
  return 1
}

if [ "$prepare" = yes ]; then
  if [ "$os" != linux ]; then
    echo "--prepare is for Linux. On a Mac, run the command without it, as the account Runyard should use." >&2
    exit 2
  fi
  if [ "$(id -u)" != 0 ]; then
    echo "--prepare needs root: run it as root, or pipe it to 'sudo sh -s -- ...'." >&2
    exit 2
  fi
  if [ -e /etc/NIXOS ]; then
    echo "On NixOS, declare the account and SSH server in your configuration instead (see Runyard's docs/reference.md, Requirements)." >&2
    exit 2
  fi

  missing=""
  if ! command -v sshd >/dev/null 2>&1 && [ ! -x /usr/sbin/sshd ]; then
    if command -v pacman >/dev/null 2>&1 || command -v zypper >/dev/null 2>&1; then
      missing="openssh"
    else
      missing="openssh-server"
    fi
  fi
  command -v sudo >/dev/null 2>&1 || missing="$missing sudo"
  if [ -n "$missing" ]; then
    echo "Installing$(printf ' %s' $missing)..."
    # shellcheck disable=SC2086 # one word per package
    install_packages $missing
  fi
  # systemd where it runs; `service` where systemctl exists but systemd isn't PID 1.
  if ! { systemctl enable --now ssh || systemctl enable --now sshd; } >/dev/null 2>&1 &&
    ! { service ssh start || service sshd start; } >/dev/null 2>&1; then
    echo "Couldn't start the SSH server; start it by hand and make it start at boot." >&2
  fi

  if id "$account" >/dev/null 2>&1; then
    echo "The $account account already exists; keeping it."
  else
    shell=/bin/sh
    [ -x /bin/bash ] && shell=/bin/bash
    useradd -m -s "$shell" "$account"
    # No password: '*' rather than a locked '!', which sshd refuses even for keys when PAM is off.
    usermod -p '*' "$account"
    echo "Created the $account account; it signs in with Runyard's key only."
  fi
  home="$(getent passwd "$account" | cut -d: -f6)"
  authorize_key "$home" "$account"

  # Runyard's one-job runners keep running after its SSH session ends.
  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$account" >/dev/null 2>&1 || true
  fi
  if getent group docker >/dev/null 2>&1; then
    usermod -aG docker "$account"
    echo "Added $account to the docker group."
  fi

  if [ "$nopasswd" = ask ]; then
    if ask "Give $account passwordless sudo? Runner installs need root; without it, Runyard asks for $account's password at each review."; then
      nopasswd=yes
    else
      nopasswd=no
    fi
  fi
  if [ "$nopasswd" = yes ]; then
    rule="$(mktemp)"
    printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$account" >"$rule"
    if visudo -cf "$rule" >/dev/null 2>&1; then
      mkdir -p /etc/sudoers.d
      install -m 0440 "$rule" "/etc/sudoers.d/$account"
      echo "Gave $account passwordless sudo (/etc/sudoers.d/$account)."
    else
      echo "visudo rejected the sudo rule; $account has no sudo." >&2
    fi
    rm -f "$rule"
  else
    admin_group=sudo
    getent group sudo >/dev/null 2>&1 || admin_group=wheel
    usermod -aG "$admin_group" "$account"
    if has_tty; then
      echo "Set a password for $account; Runyard asks for it when a review needs sudo."
      passwd "$account" </dev/tty >/dev/tty 2>&1
    else
      echo "Set a password for $account with 'passwd $account'; Runyard asks for it when a review needs sudo." >&2
    fi
  fi
  user="$account"
else
  user="$(id -un)"
  case "$user" in
    "" | *[!A-Za-z0-9._-]*)
      echo "Runyard can't sign in as '$user'; use an account with a plain name." >&2
      exit 2
      ;;
  esac
  if [ "$(id -u)" = 0 ] && [ "$os" = linux ]; then
    echo "Runners can't be installed as root. Rerun as the account Runyard should use, or with --prepare to create one." >&2
    exit 2
  fi
fi

# The SSH server has to be on: Runyard connects to it.
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
    echo "  (or run this script as root with --prepare)" >&2
  fi
  exit 1
fi

if [ "$prepare" = no ]; then authorize_key "$HOME" "$user"; fi

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

json="{\"code\":\"$code\",\"user\":\"$user\",\"os\":\"$os\",\"prepared\":$([ "$prepare" = yes ] && echo true || echo false),\"hostKeys\":[$host_keys]}"
if ! answer="$(curl -fsS -X POST -H 'Content-Type: application/json' -H 'Accept: text/plain' --data "$json" "$report_url" 2>&1)"; then
  echo "Runyard didn't take the report: $answer" >&2
  echo "The code may have expired or been used; show a new one on the machine's page." >&2
  exit 1
fi
[ -n "$answer" ] && echo "$answer"
echo "Done. Runyard is checking this machine now; its page in the dashboard shows the result."
