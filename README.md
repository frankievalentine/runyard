<p align="center">
  <img src="docs/assets/runyard-mark.svg" width="96" height="96" alt="Runyard logomark: an orange locomotive pulling its train across an evening rail yard">
</p>
<h1 align="center">Runyard</h1>
<p align="center">CI runners for GitHub and Forgejo, on your machines and boat.dev.</p>

Runyard is a control service and web dashboard for CI runners. It runs on one always-on machine,
watches your other machines over SSH and Tailscale, installs GitHub and Forgejo runners on them
after you review the changes, and starts one-job runners when work is queued. Jobs that run on
boat.dev's on-demand VMs show up alongside, with each VM's cost and any left running. The
dashboard is served to any browser on your tailnet.

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

The overview's **Getting started** list then walks through the rest: connect GitHub or Forgejo,
add a machine and connect it (one command on the machine, see [Connecting a
machine](#connecting-a-machine)), create a pool, and review the runner install.

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
an interface Runyard can listen on. Runyard's own SSH key and `known_hosts` live in the
`runyard-data` volume, so machines set up from the dashboard need nothing mounted. Your `~/.ssh`
(or `RUNYARD_SSH_DIR`) is also mounted read-only and copied in with the modes ssh requires, for
machines you already reach with your own keys. The
container runs as root, because `tailscale cert` through the sidecar needs root. Back up
`docker/runyard.key` apart from the `runyard-data` volume.

## Running as a service

`runyard service install` keeps Runyard running as your user, which it needs for your own SSH
keys and `~/.ssh/config`:

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
on the machines until you review a runner change.

### Connecting a machine

Until Runyard has reached a machine once, its page shows **Connect Runyard to <machine>**: the
steps in the order SSH meets them (SSH server on, host key trusted, Runyard's key authorized,
connected), where the last check stopped, and the commands for that step on the machine's OS.
**Getting started** names the first machine that isn't connected yet and the step it's stuck on.

The quickest way through is the **setup command** at the top of those steps. Run it on the
machine, as the account Runyard should sign in as:

```sh
curl -fsSL https://<runyard>/api/machine-setup/script.sh | sh -s -- <code>     # macOS, Linux
& ([scriptblock]::Create((irm https://<runyard>/api/machine-setup/script.ps1))) <code>   # Windows
```

It checks that the SSH server is on (and prints how to turn it on if not), adds Runyard's public
key to `~/.ssh/authorized_keys` (to `administrators_authorized_keys` for a Windows administrator,
which needs an administrator PowerShell) without agent, port or X11 forwarding, and reports the
account name, OS and SSH host keys back. Runyard then fills in the SSH user if the target had
none, trusts exactly those host keys, and checks the machine. The code works once, for 15
minutes, and the command is offered only when you use the dashboard over HTTPS (its tailnet
address), so the script and its report can't be altered on the way.

By hand instead, the steps give the commands to copy, and **Read its host key** shows the
machine's host key fingerprint with the command that prints it on the machine. Trusting it reads
the key again and keeps only that fingerprint, in Runyard's own `known_hosts`; when Tailscale
publishes the machine's host keys, the page says whether they match. A key that changed is never
replaced without an explicit **Replace**.

### How Runyard signs in

Runyard has its own ed25519 key, created in its data directory (`ssh/id_ed25519`) on first start
with `ssh-keygen`, and its own `ssh/known_hosts`. **Machines ▸ Add** shows the public key. Every
connection offers that key and checks those host keys alongside your own: your keys, agent and
`~/.ssh/config` keep working, so machines you already reach with `ssh` need nothing new. On top
of that, aarondfrancis/fleet's hardening: batch mode, strict host key checking, and no agent or
port forwarding. Machines that publish Tailscale SSH are reached with `tailscale ssh`, which
checks host keys and sign-in itself (your tailnet's SSH access rules must allow the user).
Windows machines need their OS set to Windows, so Runyard talks PowerShell. Removing a machine
from Runyard doesn't remove Runyard's key from it; delete the `runyard@` line from its
`authorized_keys`.

Alerts follow aarondfrancis/fleet's rules: offline for three minutes on the tailnet, or disk space below 10% on
readings a minute apart (clearing at 12%). Reboots and SSH failures are recorded too. History is
kept for 30 days, up to 5,000 events. **Maintenance for 1 hour** pauses a machine's alerts.

To try the dashboard without touching real machines, `vp run -r build` then
`bun apps/server/scripts/demo.ts` runs Runyard against a fictional yard.

## Runners and pools

A **pool** is runner capacity: labels, the machines it runs on (with how many runners each), and
the GitHub organizations or repositories it serves. Create one under **Pools ▸ +**. An
organization gets one runner per slot; a personal account's repositories each get their own,
because GitHub can't share a personal account's runner across repositories.

**Pools ▸ +** opens with suggestions Runyard can justify from what it sees: queued jobs no
runner has the labels for, and connected machines not yet in a pool. Picking one fills in the
form; either way, the form shows the runners the pool calls for before you save it.

Saving a pool changes nothing on machines. On a machine's page, **Review changes** reads the
machine over SSH and GitHub and shows the plan; **Run** reads both again and does nothing if
anything changed since the review. Reviews expire after 15 minutes and work once. Runyard keeps
aarondfrancis/fleet's guards: it never uses `--replace`, never moves or deletes a runner directory, never
touches a busy runner, changes one runner at a time, and stops at the first failure.
Registration tokens are minted at the moment of use and sent only over SSH stdin.

Runners live under `~/runyard-runners` (`C:\runyard-runners` on Windows) as a per-user
LaunchAgent on macOS (it starts after the user logs in), a systemd service on Linux, or a
Windows service. Linux needs root for dependencies and the service: use non-interactive sudo or
enter the password in the review, used for that run only. NixOS needs
`apps/server/scripts/nixos-runner-prerequisites.nix` imported and rebuilt first.

Runyard refuses to register runners for a public personal repository until an admin types its
name, and for an organization whose Default runner group allows public repositories.

Runners Runyard didn't register show under **Unassigned runners**, grouped by account. On a
runner's page an admin can choose the machine it **Runs on**, so it shows with that machine.
That's display only: Runyard doesn't manage it.

### On-demand pools

A pool is **persistent** (each slot is a registered runner that waits for jobs) or **on demand**.
An on-demand pool keeps no registered runners. Reviewing a machine's changes installs the runner
software once, under `~/runyard-runners/<pool>/template-*`, with the same public repository
guard as persistent runners. After that, when a job is queued that no idle runner can take and
the pool serves its repository and has its labels, Runyard:

1. mints a single-use registration at that moment (GitHub's `generate-jitconfig`, or a Forgejo
   runner registered as ephemeral);
2. copies the runner software into its own directory and starts a one-job runner there,
   detached from the SSH session;
3. lets the runner take one job and deregister itself, then removes the directory.

Each job gets at most one runner; slots cap how many run at once per machine, and a pool can
be paused. A runner that never shows up on the forge is deleted after 10 minutes. Starts and
results appear on the pool page and in each machine's history. On-demand pools run on Linux and
macOS machines for now. The registration reaches the runner through its environment or its own
config file, never on a command line.

### GitHub webhooks

Optional: without them Runyard notices queued jobs within about 45 seconds of polling; with
them, within seconds. Runyard listens for webhooks only on `127.0.0.1:7444`
(`RUNYARD_WEBHOOK_PORT`; `RUNYARD_WEBHOOKS=off` turns it off), and that listener serves nothing
but signed `POST /webhooks/github` deliveries. Under **Settings ▸ Connections ▸ GitHub ▸
Webhooks**:

1. Expose the listener, for example with `tailscale funnel --bg http://127.0.0.1:7444` (Funnel
   must be allowed for the machine in your tailnet policy). Runyard shows the command; it never
   changes what's public on your tailnet itself.
2. Set each app's webhook: Runyard points it at the public address with a fresh secret through
   GitHub's API.
3. In the app's settings on GitHub, tick **Active** and the **Workflow job** event. GitHub's API
   can't change those.

Each delivery's signature is checked against its app's secret and repeated deliveries are
ignored. A delivery only makes Runyard re-read jobs and runners through the API and run a
dispatch round; nothing in a payload is acted on.

### On-demand runners (boat.dev)

Runyard shows jobs that ask for [boat.dev](https://docs.boat.dev/ci.md)'s labels (`boat`,
`boat-small`, `boat-large`, `boat-xlarge`, matched exactly) in Queued jobs as "Starts on
boat.dev", since boat.dev starts a VM per job and no runner exists beforehand. The sidebar's
**boat.dev** row (once boat.dev is connected or a boat job has been seen) opens a page with its
running and queued jobs. Without a key, Runyard reads only what GitHub reports. A running
self-hosted or boat job whose runner isn't in GitHub's runner list still shows, known from the
job itself.

Optionally, connect boat.dev on that page with a key limited to `sandbox.read` and
`account.read`. Runyard then shows each boat job's VM size and cost so far, your plan's VM and
start limits (queued boat jobs say when they're waiting on them), and VMs billing outside a
running CI job, listed under Needs attention. Costs are this UTC month at list price, as
boat.dev reports them. Runyard only reads; it never starts, stops or changes a VM.

### Forgejo

Connect a Forgejo instance (15 or later) under **Settings ▸ Connections ▸ Forgejo** with an access token
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
| `RUNYARD_WEBHOOK_PORT`    | Loopback port for GitHub webhooks (`7444`).                                                                                                                                                                                                |
| `RUNYARD_WEBHOOKS`        | `off` to skip the webhook listener.                                                                                                                                                                                                        |
| `RUNYARD_SSH`             | Path to `ssh` (default `/usr/bin/ssh` where it exists, else `ssh` on `PATH`).                                                                                                                                                              |
| `RUNYARD_ORIGIN`          | The dashboard's public URL, such as `https://runyard.example.com`. Only needed behind a TLS-terminating reverse proxy on TCP, so passkeys verify against the address the browser uses.                                                     |

A key file in the data directory only protects a copy of the database taken on its own, such as a
backup. To keep the two apart, pass the key through the environment or a file stored elsewhere.
Runyard refuses to start with a key that doesn't match the database, or a key file other users
can read.
