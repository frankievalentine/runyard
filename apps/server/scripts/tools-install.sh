# Installs the tools a machine's pools call for and its last check found
# missing: RF_TOOLS, space-separated, from Runyard's fixed list. Linux uses
# the distribution's package manager through run_as_root; macOS uses Homebrew
# as this account. Docker comes from the distribution's own packages, is
# started, and this account joins the docker group.
set -eu

tools="${RF_TOOLS:-}"
for tool in $tools; do
  case "$tool" in
    git | curl | tar | unzip | zip | xz | zstd | jq | gpg | cc | make | python3 | docker) ;;
    *)
      echo "unknown tool: $tool" >&2
      exit 2
      ;;
  esac
done
[ -n "$tools" ] || { echo "Nothing to install."; exit 0; }

if [ "$(uname -s)" = Darwin ]; then
  brew=""
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$candidate" ]; then brew="$candidate"; break; fi
  done
  [ -n "$brew" ] || { echo "Homebrew isn't installed." >&2; exit 1; }
  packages=""
  for tool in $tools; do
    case "$tool" in
      gpg) packages="$packages gnupg" ;;
      python3) packages="$packages python" ;;
      git | cc | make | docker) echo "Skipping $tool: it doesn't come from Homebrew here." ;;
      *) packages="$packages $tool" ;;
    esac
  done
  [ -n "$packages" ] || exit 0
  # shellcheck disable=SC2086 # one word per package
  HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_ENV_HINTS=1 "$brew" install $packages
  echo "Installed with Homebrew:$packages"
  exit 0
fi

if command -v apt-get >/dev/null 2>&1; then pm=apt
elif command -v dnf >/dev/null 2>&1; then pm=dnf
elif command -v yum >/dev/null 2>&1; then pm=yum
elif command -v zypper >/dev/null 2>&1; then pm=zypper
elif command -v pacman >/dev/null 2>&1; then pm=pacman
else
  echo "No supported package manager (apt, dnf, yum, zypper or pacman)." >&2
  exit 1
fi

# The package that provides a tool on this package manager.
package_for() {
  case "$pm:$1" in
    apt:curl) echo "curl ca-certificates" ;;
    apt:xz) echo xz-utils ;;
    apt:gpg) echo gnupg ;;
    apt:cc | apt:make) echo build-essential ;;
    apt:docker) echo docker.io ;;
    dnf:gpg | yum:gpg) echo gnupg2 ;;
    dnf:cc | yum:cc) echo gcc ;;
    dnf:docker | yum:docker) echo moby-engine ;;
    zypper:gpg) echo gpg2 ;;
    zypper:cc | pacman:cc) echo gcc ;;
    pacman:gpg) echo gnupg ;;
    pacman:python3) echo python ;;
    *) echo "$1" ;;
  esac
}

packages=""
for tool in $tools; do
  for package in $(package_for "$tool"); do
    case " $packages " in *" $package "*) ;; *) packages="$packages $package" ;; esac
  done
done
echo "Installing:$packages"
# shellcheck disable=SC2086 # one word per package
case "$pm" in
  apt)
    run_as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq
    run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $packages
    ;;
  dnf | yum)
    if ! run_as_root "$pm" install -y -q $packages; then
      case " $packages " in
        *" moby-engine "*) echo "This distribution has no moby-engine package; install Docker from docker.com's repository for it instead." >&2 ;;
      esac
      exit 1
    fi
    ;;
  zypper) run_as_root zypper --non-interactive install $packages ;;
  pacman) run_as_root pacman -Sy --noconfirm --needed $packages ;;
esac

case " $tools " in
  *" docker "*)
    if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
      run_as_root systemctl enable --now docker
    else
      run_as_root service docker start || true
    fi
    run_as_root usermod -aG docker "$(id -un)"
    echo "Added $(id -un) to the docker group. Runners already running pick it up when they restart."
    ;;
esac
echo "Done."
