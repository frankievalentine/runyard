# Runyard

A self-hosted control service and web dashboard for fleets of self-hosted GitHub Actions and
Forgejo Actions runners. Runyard runs on one always-on machine, reaches your other machines over
SSH, and serves its dashboard to any browser on your tailnet.

Early development. See [docs/PLAN.md](docs/PLAN.md) for the design and roadmap.

## Development

Requires [Vite+](https://viteplus.dev) (`vp`) and Bun.

```sh
vp install
vp run dev        # server on 127.0.0.1:7420 and the dashboard dev server with /api proxied to it
vp run ready      # format, lint and type checks, then every package's tests and builds
vp run ci         # ready, then a smoke test of the compiled binary (CI runs locally for now)
```

`vp run -r build` also produces `apps/cli/dist/runyard`, a single binary with the dashboard
embedded.

## First run

Start Runyard and look at its output. With no admin yet, it prints a one-time setup code:

```
No admin yet. Open the dashboard and enter this setup code to create one:

    CVZR-SYJD-4HZP
```

Open the dashboard and enter the code to create the first admin. The code changes at every start
until an admin exists, so only someone who can read Runyard's output can claim the install.

## Installing a release

`vp run release` runs the checks and tests, then cross-compiles `runyard` for macOS (Apple
silicon), Linux (x64 and arm64, glibc) and Windows (x64) into `apps/cli/dist/release`, with
`SHA256SUMS`, `VERSION` and the installers. Nothing is uploaded. Put that directory anywhere
reachable over HTTPS (or use it as a `file://` path), then:

```sh
RUNYARD_BASE_URL=https://example.com/runyard/0.1.0 sh install.sh      # ~/.local/bin/runyard
```

```powershell
$env:RUNYARD_BASE_URL = 'https://example.com/runyard/0.1.0'; .\install.ps1   # %LOCALAPPDATA%\Programs\Runyard
```

Both check the binary against `SHA256SUMS` before installing. That catches a corrupt or swapped
download only when `SHA256SUMS` comes from a source you trust. `RUNYARD_INSTALL_DIR` changes
where it goes. `vp run @runyard/server#check-powershell` parses every PowerShell script Runyard
ships or generates, in Microsoft's PowerShell container (needs Docker).

## Docker

`docker/compose.yaml` runs Runyard beside the official Tailscale container. Runyard shares the
sidecar's network and its tailscaled socket and serves HTTPS on the tailnet itself, so the
dashboard is at `https://<RUNYARD_HOSTNAME>.<tailnet>.ts.net:7443/` and nowhere else.

```sh
vp run release
cp docker/.env.example docker/.env                 # set TS_AUTHKEY
openssl rand -base64 32 > docker/runyard.key && chmod 600 docker/runyard.key
docker compose -f docker/compose.yaml up -d --build
docker compose -f docker/compose.yaml logs runyard # the setup code
```

The sidecar uses kernel networking (`/dev/net/tun`, `NET_ADMIN`), so the tailnet address is on
an interface Runyard can listen on. Your `~/.ssh` (or `RUNYARD_SSH_DIR`) is mounted read-only
and copied in with the modes ssh requires; `known_hosts` must already trust each machine. The
container runs as root, because `tailscale cert` through the sidecar needs root. Back up
`docker/runyard.key` apart from the `runyard-data` volume.

## Running as a service

`runyard service install` keeps Runyard running as your user, which it needs for your SSH keys:

| OS      | How                                                                    | Starts          |
| ------- | ---------------------------------------------------------------------- | --------------- |
| Linux   | `/etc/systemd/system/runyard.service` with `User=` you (asks for sudo) | At boot         |
| macOS   | `~/Library/LaunchAgents/dev.runyard.plist`                             | When you log in |
| Windows | A `Runyard` scheduled task, without a stored password                  | When you log on |

`RUNYARD_*` settings in your environment carry into the service, except `RUNYARD_SECRET_KEY`:
service definitions are readable by other users, so use `RUNYARD_SECRET_KEY_FILE`. Add
`--dry-run` to see what would change. `runyard service status` and `runyard service uninstall`
do what they say; uninstalling keeps Runyard's data. The log is `journalctl -u runyard` on
Linux and `runyard.log` in the data directory elsewhere; a fresh install prints its setup code
there. On Linux, let the user fetch tailnet certificates with
`sudo tailscale set --operator=$USER`. An SSH agent isn't available to the service; use key
files.

## Access over Tailscale

When Tailscale is running on the same machine, Runyard also serves HTTPS on the machine's tailnet
addresses, at `https://<machine>.<tailnet>.ts.net:7443`, with a certificate from `tailscale cert`
that it renews on its own. No `tailscale serve` setup is needed, and any Tailscale install works:
the Mac App Store or standalone app, `tailscaled` on Linux, or Windows.

The tailnet needs **MagicDNS** and **HTTPS Certificates** turned on (Tailscale admin console, DNS
page). Until they are, or while Tailscale is down, Runyard serves on loopback only and says why in
its output.

On the tailnet, Runyard identifies each connection's device with `tailscale whois`, so users whose
Tailscale login is added in **Users** are signed in automatically. No request header is trusted
for identity. On loopback TCP, users sign in with a username and password.

## Machines

Add machines under **Machines ▸ Add**: pick one of your tailnet's desktops and servers, or enter
any SSH target (`user@host` or a `Host` alias from `~/.ssh/config`). Only machines you add are
checked. Every minute Runyard reads CPU, memory, load, disks, uptime and selected power and
Tailscale settings over SSH, read-only, with at most four sessions at a time. Nothing is installed
on the machines.

SSH runs as the user Runyard runs as, with that user's keys and configuration, plus fleet's
hardening: batch mode, host keys must already be trusted (connect once with `ssh` to accept one),
and no agent or port forwarding. Machines that publish Tailscale SSH are reached with
`tailscale ssh`. Windows machines need their OS set to Windows, so Runyard talks PowerShell.

Alerts follow fleet's rules: offline for three minutes on the tailnet, or disk space below 10% on
readings a minute apart (clearing at 12%). Reboots and SSH failures are recorded too. History is
kept for 30 days, up to 5,000 events. **Maintenance for 1 hour** pauses a machine's alerts.

To try the dashboard without touching real machines, `vp run -r build` then
`bun apps/server/scripts/demo.ts` runs Runyard against a fictional fleet.

## Runners and pools

A **pool** is runner capacity: labels, the machines it runs on (with how many runners each), and
the GitHub organizations or repositories it serves. Create one under **Pools ▸ +**. An
organization gets one runner per slot; a personal account's repositories each get their own,
because GitHub can't share a personal account's runner across repositories.

Saving a pool changes nothing on machines. On a machine's page, **Review changes** reads the
machine over SSH and GitHub and shows the plan; **Run** reads both again and does nothing if
anything changed since the review. Reviews expire after 15 minutes and work once. Runyard keeps
fleet's guards: it never uses `--replace`, never moves or deletes a runner directory, never
touches a busy runner, changes one runner at a time, and stops at the first failure.
Registration tokens are minted at the moment of use and sent only over SSH stdin.

Runners live under `~/runyard-runners` (`C:\runyard-runners` on Windows) as a per-user
LaunchAgent on macOS (it starts after the user logs in), a systemd service on Linux, or a
Windows service. Linux needs root for dependencies and the service: use non-interactive sudo or
enter the password in the review, used for that run only. NixOS needs
`apps/server/scripts/nixos-runner-prerequisites.nix` imported and rebuilt first.

Runyard refuses to register runners for a public personal repository until an admin types its
name, and for an organization whose Default runner group allows public repositories.

### Forgejo

Connect a Forgejo instance (15 or later) under **Account menu ▸ Forgejo** with an access token
whose user, organization and repository scopes are set to read and write. Runyard stores it
encrypted and watches that user's own runners and those of every organization they belong to.
A pool can serve the account or an organization; its runners serve every repository the account
owns. Forgejo jobs run on the machine (host mode) or, per pool, in Docker containers from a
default image; Docker must already be installed and usable by the SSH user.

forgejo-runner is published for Linux only, so Forgejo runners install on Linux machines as
`runyard-forgejo-<name>` systemd services under `~/runyard-runners/<pool>/forgejo-<account>/`.
Runyard registers each runner through Forgejo's API at the moment of install, downloads the
latest forgejo-runner from code.forgejo.org, checks its published SHA-256, and deletes the
registration again if the install fails. An account that owns public repositories needs its name
typed on the pool's page before Runyard registers runners for it.

## Passkeys

Signed-in users can add passkeys under **Account** and then sign in without a password. Passkeys
need HTTPS or `localhost`, so they're available on the tailnet address but not over plain HTTP.
A passkey works only on the address it was added from.

## Configuration

| Variable                  | Effect                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RUNYARD_HOST`            | Server bind address (default `127.0.0.1`).                                                                                                                                                                                                 |
| `RUNYARD_PORT`            | Server port (default `7420`); the dashboard dev proxy follows it.                                                                                                                                                                          |
| `RUNYARD_DATA_DIR`        | Database and generated key location. Defaults to `~/Library/Application Support/Runyard` on macOS and `$XDG_DATA_HOME/runyard` (`~/.local/share/runyard`) elsewhere. Created with mode `700`; an existing directory keeps its permissions. |
| `RUNYARD_SECRET_KEY`      | Base64 32-byte key (`openssl rand -base64 32`) that encrypts stored credentials.                                                                                                                                                           |
| `RUNYARD_SECRET_KEY_FILE` | File holding that key. Used when `RUNYARD_SECRET_KEY` is unset; defaults to `secret.key` in the data directory, generated with mode `600` on first start.                                                                                  |
| `RUNYARD_TAILNET`         | `off` disables the tailnet HTTPS listener.                                                                                                                                                                                                 |
| `RUNYARD_TAILNET_PORT`    | Tailnet HTTPS port (default `7443`). macOS lets any user bind `443`; Linux needs extra privileges for it.                                                                                                                                  |
| `RUNYARD_TAILSCALE`       | Path to the `tailscale` CLI, if it isn't on `PATH`.                                                                                                                                                                                        |
| `RUNYARD_SSH`             | Path to `ssh` (default `/usr/bin/ssh` where it exists, else `ssh` on `PATH`).                                                                                                                                                              |
| `RUNYARD_ORIGIN`          | The dashboard's public URL, such as `https://runyard.example.com`. Only needed behind a TLS-terminating reverse proxy on TCP, so passkeys verify against the address the browser uses.                                                     |

A key file in the data directory only protects a copy of the database taken on its own, such as a
backup. To keep the two apart, pass the key through the environment or a file stored elsewhere.
Runyard refuses to start with a key that doesn't match the database, or a key file other users
can read.
