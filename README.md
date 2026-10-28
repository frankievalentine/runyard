<p align="center">
  <img src="docs/assets/runyard-mark.svg" width="96" height="96" alt="Runyard logomark: an orange locomotive pulling its train across an evening rail yard">
</p>
<h1 align="center">Runyard</h1>
<p align="center">CI runners for GitHub and Forgejo, on your machines and boat.dev.</p>
<p align="center"><sub>Builds on <a href="https://github.com/aarondfrancis/fleet">aarondfrancis/fleet</a></sub></p>

Runyard is a self-hosted control service and web dashboard for CI runners. It runs on one
always-on machine, watches your other machines over SSH and Tailscale, installs GitHub and
Forgejo runners on them after you review the changes, and starts one-job runners when work is
queued. Jobs that run on boat.dev's on-demand VMs show up alongside, with each VM's cost.

- **One view of your runners:** every machine's health, every runner's state, and the jobs
  waiting for them, across GitHub accounts, organizations and Forgejo.
- **Runners from pools, not by hand:** describe the capacity you want (labels, machines,
  repositories) and Runyard works out the runners and installs them, one reviewed change at a
  time.
- **On-demand runners:** a fresh one-job runner for each queued job, on your own machines.
- **Guided machine setup:** one command on a machine and Runyard can reach it.
- **Safe by default:** nothing changes on a machine without a review, busy runners are never
  touched, and public repositories are refused unless you say otherwise.

## Contents

- [Quick start](#quick-start)
- [Requirements](#requirements)
- [Machines](#machines)
- [Runners and pools](#runners-and-pools)
- [Forges and services](#forges-and-services): GitHub, Forgejo, boat.dev, webhooks
- [Running Runyard](#running-runyard): as a service, Docker, Tailscale, users
- [Security](#security)
- [Configuration](#configuration)
- [Development](#development)
- [Credits](#credits)

## Quick start

### 1. Install Runyard on an always-on machine

```sh
curl -fsSL https://<runyard-domain>/install.sh | sh
```

```powershell
irm https://<runyard-domain>/install.ps1 | iex
```

The installer picks the build for the machine (macOS on Apple silicon, Linux x64 or arm64,
Windows x64), checks it against the release's `SHA256SUMS`, and puts `runyard` in
`~/.local/bin` (`%LOCALAPPDATA%\Programs\Runyard` on Windows).

> **Releases aren't published yet.** Until they are, build one yourself: clone this repository,
> run `vp install` and `vp run release`, then
> `RUNYARD_BASE_URL=file://$PWD/apps/cli/dist/release sh install/install.sh`. See
> [Development](#development) for the tools it needs.

### 2. Start it

```sh
runyard                    # runs in the foreground and prints its address and a setup code
runyard service install    # or keep it running in the background (see Running as a service)
```

With Tailscale running on the machine, the dashboard is at
`https://<machine>.<tailnet>.ts.net:7443`, reachable from any device on your tailnet. Without
it, Runyard serves `http://127.0.0.1:7420` on that machine only.

### 3. Claim the install

Open the dashboard and enter the setup code from Runyard's output to create the first admin:

```
No admin yet. Open the dashboard and enter this setup code to create one:

    CVZR-SYJD-4HZP
```

The code changes at every start until an admin exists, so only someone who can read Runyard's
output can claim it.

### 4. Follow Getting started

The overview then shows **Getting started**, which checks the control machine (SSH, Runyard's
SSH key, Tailscale HTTPS, the secret key, disk space, the service) and walks through four steps.
Each one links to the page that does it and ticks itself off from what Runyard sees.

1. **Connect GitHub or Forgejo.** For GitHub, Runyard creates its own GitHub App with one
   confirmation on GitHub; install it on your account or organization and pick repositories.
   For Forgejo, paste an access token. See [GitHub](#github) and [Forgejo](#forgejo).
2. **Add a machine and connect it.** Pick a tailnet device or enter an SSH target, then run the
   one-line setup command the machine's page shows (on a fresh Linux LXC or VPS, the
   fresh-machine version, as root). See [Machines](#machines) and
   [Runner machines](#runner-machines).
3. **Create a pool:** labels, machines and the repositories to serve. Runyard suggests pools from
   queued jobs and idle machines. See [Runners and pools](#runners-and-pools).
4. **Install the runners.** On the machine's page, **Review changes** shows exactly what will
   happen; **Run** carries it out. Runners appear on GitHub or Forgejo and start taking jobs.

To look around first without touching anything real, run the demo yard (see
[Development](#development)).

## Requirements

**The machine Runyard runs on** (the control machine):

- macOS on Apple silicon, Linux (x64 or arm64, glibc), or Windows x64. Or Docker.
- The OpenSSH client: `ssh`, `ssh-keygen` and `ssh-keyscan`.
- Optional, recommended: [Tailscale](https://tailscale.com) with MagicDNS and HTTPS
  Certificates turned on, for the HTTPS dashboard address, device discovery, sign-in by tailnet
  identity, and the one-line machine setup command.

**Machines that run runners:** anything Runyard can reach over SSH.

| OS      | GitHub runners        | Forgejo runners | On-demand pools |
| ------- | --------------------- | --------------- | --------------- |
| macOS   | Yes (LaunchAgent)     | No              | Yes             |
| Linux   | Yes (systemd)         | Yes             | Yes             |
| Windows | Yes (Windows service) | No              | Not yet         |

Linux installs need root for dependencies and the service: non-interactive sudo, or the
password entered in the review. NixOS needs `apps/server/scripts/nixos-runner-prerequisites.nix`
imported first.

**Forges:** GitHub (personal accounts and organizations) and Forgejo 15 or later.

## Machines

Add machines under **Machines ▸ Add**: pick one of your tailnet's desktops and servers, or enter
any SSH target (`user@host` or a `Host` alias from `~/.ssh/config`). Only machines you add are
checked. Every minute Runyard reads CPU, memory, load, disks, uptime and selected power and
Tailscale settings over SSH, read-only, with at most four sessions at a time.

### Connecting a machine

Until Runyard has reached a machine once, its page shows **Connect Runyard to &lt;machine&gt;**:
the steps in the order SSH meets them (SSH server on, host key trusted, Runyard's key
authorized, connected), where the last check stopped, and the commands for that step on the
machine's OS.

The quickest way through is the **setup command** at the top of those steps. Run it on the
machine, as the account Runyard should sign in as:

```sh
curl -fsSL https://<runyard>/api/machine-setup/script.sh | sh -s -- <code>               # macOS, Linux
& ([scriptblock]::Create((irm https://<runyard>/api/machine-setup/script.ps1))) <code>   # Windows
```

It checks that the SSH server is on (and says how to turn it on if not), adds Runyard's public
key to `~/.ssh/authorized_keys` (`administrators_authorized_keys` for a Windows administrator,
from an administrator PowerShell) with agent, port and X11 forwarding off, and reports the
account name, OS and SSH host keys back. Runyard fills in the SSH user if the target had none,
trusts exactly those host keys, and checks the machine. The code works once, for 15 minutes. The
command is offered only when you use the dashboard over HTTPS, its tailnet address, so the
script and its report can't be altered on the way. It installs nothing.

On a **fresh Linux machine** (a new LXC or VPS with only `root`), run the fresh-machine version
the page shows instead, as root: the same command with `--prepare`. It also installs the SSH
server and `sudo` if they're missing, creates a `runyard` account that signs in with Runyard's
key only, keeps that account's processes running after it logs out (so one-job runners survive
the SSH session), and adds it to the `docker` group if Docker is installed. Runner installs need
root, so it gives the account sudo: passwordless with `--sudo` (or if you answer yes when it
asks), otherwise with a password you set, which Runyard asks for in each review. The plain
command refuses to run as root on Linux, because runners can't be installed as root.

By hand instead, the steps give the commands to copy, and **Read its host key** shows the
machine's host key fingerprint with the command that prints it on the machine. Trusting it reads
the key again and keeps only that fingerprint; when Tailscale publishes the machine's host keys,
the page says whether they match. A host key that changed is never replaced without an explicit
**Replace**.

### How Runyard signs in

Runyard has its own ed25519 key and `known_hosts`, created in its data directory (`ssh/`) on
first start. **Machines ▸ Add** shows the public key. Every connection offers that key and
checks those host keys alongside your own, so machines you already reach with `ssh` need nothing
new: your keys, agent and `~/.ssh/config` keep working. Machines that publish Tailscale SSH are
reached with `tailscale ssh`, which checks host keys and sign-in itself (your tailnet's SSH
rules must allow the user). Windows machines need their OS set to Windows, so Runyard talks
PowerShell. Removing a machine from Runyard leaves Runyard's key on it; delete the `runyard@`
line from its `authorized_keys`.

### Runner machines

What a machine needs to host runners, by kind:

- **Proxmox LXC.** On the Proxmox host, download the Debian 12 template (**local ▸ CT
  Templates**, or `pveam download local debian-12-standard_<version>_amd64.tar.zst`) and create
  an unprivileged container from it with the CPU, memory and disk your jobs need. Turn on
  **Options ▸ Features ▸ nesting** and **keyctl** if jobs will use Docker (Forgejo's Docker
  mode, or GitHub `container:` and `services:` jobs). To put the container on your tailnet, add
  Tailscale's device lines to `/etc/pve/lxc/<id>.conf`, then restart it and install Tailscale
  inside:

  ```
  lxc.cgroup2.devices.allow: c 10:200 rwm
  lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
  ```

  Without Tailscale, add it to Runyard by its LAN address instead. Then `pct enter <id>`,
  install `curl` if it's missing, and run the machine's fresh-machine setup command as root.

- **Linux VPS.** Install Tailscale (`curl -fsSL https://tailscale.com/install.sh | sh`, then
  `sudo tailscale up`) so Runyard reaches it privately and the setup command can report back,
  then run the fresh-machine setup command as root. A VPS reached over public SSH works with the
  by-hand steps too, but keep its SSH port firewalled to the machines that need it.
- **Mac.** Turn on **System Settings ▸ General ▸ Sharing ▸ Remote Login**, then run the setup
  command as the account the runners should use. Runners on macOS are LaunchAgents, which run
  only while that account is logged in: turn on automatic login for it (**Users & Groups**;
  unavailable while FileVault is on) and stop the Mac sleeping (`sudo pmset -a sleep 0`, and
  keep a laptop on power). Runyard flags a Mac in a pool when automatic login is off or is for another account, and when it sleeps.
- **Windows.** Turn on OpenSSH Server (the setup command prints how), then run the Windows setup
  command as the runners' account; for an administrator account, from an administrator
  PowerShell. Runners run as Windows services.

### Alerts and history

A machine alerts when it's offline on the tailnet for three minutes, or when disk space is below
10% on readings a minute apart (clearing at 12%). Reboots and SSH failures are recorded too.
History is kept for 30 days, up to 5,000 events. **Maintenance for 1 hour** pauses a machine's
alerts.

## Runners and pools

A **pool** is runner capacity: labels, the machines it runs on (with how many runners each), and
the accounts or repositories it serves. Create one under **Pools ▸ +**, which opens with
suggestions Runyard can justify from what it sees: queued jobs no runner has the labels for, and
connected machines not yet in a pool. The form shows the runners the pool calls for before you
save it. An organization gets one runner per slot; a personal GitHub account's repositories each
get their own, because GitHub can't share a personal account's runner across repositories.

Saving a pool changes nothing on machines. On a machine's page, **Review changes** reads the
machine and the forge and shows the plan; **Run** reads both again and does nothing if anything
changed since the review. Runners live under `~/runyard-runners` (`C:\runyard-runners` on
Windows), as a LaunchAgent on macOS (it starts after the user logs in), a systemd service on
Linux, or a Windows service.

### On-demand pools

A pool is **persistent** (each slot is a registered runner waiting for jobs) or **on demand**.
An on-demand pool keeps no registered runners. Its review installs the runner software once per
machine, under `~/runyard-runners/<pool>/template-*`. After that, when a job is queued that no
idle runner can take and the pool serves its repository and has its labels, Runyard:

1. mints a single-use registration at that moment (GitHub's just-in-time config, or an
   ephemeral Forgejo runner);
2. copies the runner software into its own directory and starts a one-job runner there;
3. lets the runner take one job and deregister itself, then removes the directory.

Each job gets at most one runner; slots cap how many run at once per machine, and a pool can be
paused. A runner that never shows up on the forge is deleted after 10 minutes. Starts and
results appear on the pool page and in each machine's history. On-demand pools run on Linux and
macOS for now.

### Runners Runyard didn't install

Runners registered another way show under **Unassigned runners**. On a runner's page, choose
the machine it **Runs on** to show it there. To hand it over to Runyard, **Move into pool**
picks a persistent pool on that machine that serves its scope (or creates one from the runner's
labels). The pool's own runner is installed through the usual review; once it's online, idle
and labeled, the machine's review offers to **Retire** the old one, which deregisters it on the
forge and shows the steps to remove its service. Runyard never changes the old runner's
directory.

## Forges and services

### GitHub

Under **Settings ▸ Connections ▸ GitHub**, Runyard creates a GitHub App for itself through
GitHub's manifest flow: you confirm it on GitHub, then install it on your personal account or an
organization and choose its repositories. The app's credentials are stored encrypted. Runyard
reads runners and queued jobs for the installation's repositories, and registers runners with
tokens it mints at the moment of use.

### Forgejo

Connect a Forgejo instance (15 or later) under **Settings ▸ Connections ▸ Forgejo** with an
access token whose user, organization and repository scopes are set to read and write. Runyard
watches that user's runners and those of every organization they belong to. A pool can serve
the account or an organization. Jobs run on the machine (host mode) or, per pool, in Docker
containers from a default image; Docker must already be installed and usable by the SSH user.
forgejo-runner is published for Linux only, so Forgejo runners install on Linux machines as
`runyard-forgejo-<name>` systemd services, from the latest forgejo-runner release with its
SHA-256 checked.

### boat.dev

Runyard shows jobs that ask for [boat.dev](https://docs.boat.dev/ci.md)'s labels (`boat`,
`boat-small`, `boat-large`, `boat-xlarge`) as "Starts on boat.dev", since boat.dev starts a VM
per job. The sidebar's **boat.dev** row opens its running and queued jobs. Optionally, connect
boat.dev there with a key limited to `sandbox.read` and `account.read`: Runyard then shows each
job's VM size and cost so far, your plan's limits, and VMs still billing outside a CI job. Costs
are this UTC month at list price. Runyard only reads; it never starts, stops or changes a VM.

### GitHub webhooks

Optional: without them Runyard notices queued jobs within about 45 seconds; with them, within
seconds. Runyard listens for webhooks only on `127.0.0.1:7444`, and that listener accepts nothing
but signed deliveries. Under **Settings ▸ Connections ▸ GitHub ▸ Webhooks**:

1. Expose the listener, for example with `tailscale funnel --bg http://127.0.0.1:7444`. Runyard
   shows the command; it never changes what's public on your tailnet itself.
2. Set each app's webhook: Runyard points it at the public address with a fresh secret.
3. In the app's settings on GitHub, tick **Active** and the **Workflow job** event.

A delivery only makes Runyard re-read jobs and runners through the API; nothing in a payload is
acted on.

## Running Runyard

### As a service

`runyard service install` keeps Runyard running as your user, which it needs for your own SSH
keys and `~/.ssh/config`:

| OS      | How                                                                    | Starts          |
| ------- | ---------------------------------------------------------------------- | --------------- |
| Linux   | `/etc/systemd/system/runyard.service` with `User=` you (asks for sudo) | At boot         |
| macOS   | `~/Library/LaunchAgents/dev.runyard.plist`                             | When you log in |
| Windows | A `Runyard` scheduled task, without a stored password                  | When you log on |

`RUNYARD_*` settings in your environment carry into the service, except `RUNYARD_SECRET_KEY`
(service definitions are readable by other users; use `RUNYARD_SECRET_KEY_FILE`). Add
`--dry-run` to see what would change. `runyard service status` and `runyard service uninstall`
do what they say; uninstalling keeps Runyard's data. The log is `journalctl -u runyard` on Linux
and `runyard.log` in the data directory elsewhere, and a fresh install prints its setup code
there. On Linux, let the user fetch tailnet certificates with
`sudo tailscale set --operator=$USER`.

### Docker

`docker/compose.yaml` runs Runyard beside the official Tailscale container. Runyard shares the
sidecar's network and tailscaled socket and serves HTTPS on the tailnet itself, at
`https://<RUNYARD_HOSTNAME>.<tailnet>.ts.net:7443/` and nowhere else. The image is built from a
local release:

```sh
vp run release
cp docker/.env.example docker/.env                 # set TS_AUTHKEY
openssl rand -base64 32 > docker/runyard.key && chmod 600 docker/runyard.key
docker compose -f docker/compose.yaml up -d --build
docker compose -f docker/compose.yaml logs runyard # the setup code
```

Runyard's own SSH key and `known_hosts` live in the `runyard-data` volume, so machines set up
from the dashboard need nothing mounted. Your `~/.ssh` (or `RUNYARD_SSH_DIR`) is also mounted
read-only, for machines you already reach with your own keys. The container runs as root,
because `tailscale cert` through the sidecar needs it. Back up `docker/runyard.key` apart from
the `runyard-data` volume.

### Over Tailscale

When Tailscale runs on the same machine, Runyard serves HTTPS on its tailnet addresses with a
certificate from `tailscale cert`, renewed on its own; no `tailscale serve` setup is needed, and
any Tailscale install works. The tailnet needs **MagicDNS** and **HTTPS Certificates** turned
on. Until they are, or while Tailscale is down, Runyard serves on loopback only and says why.

### Users and passkeys

On the tailnet, Runyard identifies each connection's device with `tailscale whois`, so people
whose Tailscale login is added under **Settings ▸ Users** are signed in automatically, as an
admin or a viewer. On loopback, users sign in with a username and password, and can add
passkeys under **Account**. Passkeys need HTTPS or `localhost`, and work only on the address
they were added from.

## Security

- **Reading is read-only.** Monitoring never changes a machine or a forge, and never mints a
  token.
- **Every change is reviewed.** A review shows each step; running it re-reads the machine and
  the forge and refuses if the plan changed. Reviews work once and expire after 15 minutes.
- **Runners are handled carefully.** Runyard never uses `--replace`, never moves or deletes a
  configured runner directory, never restarts or removes a busy runner, changes one runner at a
  time, and stops at the first failure. A runner is retired only once its replacement is
  online, idle, labeled and running.
- **Tokens are short-lived.** Registration and removal tokens are minted at the moment of use and
  sent only over SSH stdin, never as arguments or files.
- **Public repositories are refused** by default: anyone who can open a fork pull request could
  run code on a persistent runner. A public repository needs its name typed by an admin, and an
  organization whose Default runner group admits public repositories is refused.
- **SSH is hardened:** batch mode, strict host key checking, no agent or port forwarding, and
  host keys trusted only after you compare them or a machine reports them with its setup code.
- **Credentials are encrypted** at rest with a key from the environment or a key file (see
  [Configuration](#configuration)).
- **Webhooks are only a nudge:** signatures are checked, and a delivery only triggers a re-read
  through the API.

## Configuration

| Variable                  | Effect                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUNYARD_HOST`            | Server bind address (default `127.0.0.1`).                                                                                                                                                                    |
| `RUNYARD_PORT`            | Server port (default `7420`); the dashboard dev proxy follows it.                                                                                                                                             |
| `RUNYARD_DATA_DIR`        | Database, SSH key and generated secret key location. Defaults to `~/Library/Application Support/Runyard` on macOS and `$XDG_DATA_HOME/runyard` (`~/.local/share/runyard`) elsewhere. Created with mode `700`. |
| `RUNYARD_SECRET_KEY`      | Base64 32-byte key (`openssl rand -base64 32`) that encrypts stored credentials.                                                                                                                              |
| `RUNYARD_SECRET_KEY_FILE` | File holding that key. Used when `RUNYARD_SECRET_KEY` is unset; defaults to `secret.key` in the data directory, generated with mode `600` on first start.                                                     |
| `RUNYARD_TAILNET`         | `off` disables the tailnet HTTPS listener.                                                                                                                                                                    |
| `RUNYARD_TAILNET_PORT`    | Tailnet HTTPS port (default `7443`). macOS lets any user bind `443`; Linux needs extra privileges for it.                                                                                                     |
| `RUNYARD_TAILSCALE`       | Path to the `tailscale` CLI, if it isn't on `PATH`.                                                                                                                                                           |
| `RUNYARD_WEBHOOK_PORT`    | Loopback port for GitHub webhooks (default `7444`).                                                                                                                                                           |
| `RUNYARD_WEBHOOKS`        | `off` to skip the webhook listener.                                                                                                                                                                           |
| `RUNYARD_SSH`             | Path to `ssh` (default `/usr/bin/ssh` where it exists, else `ssh` on `PATH`).                                                                                                                                 |
| `RUNYARD_SSH_KEYGEN`      | Path to `ssh-keygen`, which creates Runyard's own key (default `/usr/bin/ssh-keygen` where it exists).                                                                                                        |
| `RUNYARD_SSH_KEYSCAN`     | Path to `ssh-keyscan`, which reads machines' host keys (default `/usr/bin/ssh-keyscan` where it exists).                                                                                                      |
| `RUNYARD_ORIGIN`          | The dashboard's public URL, such as `https://runyard.example.com`. Only needed behind a TLS-terminating reverse proxy, so passkeys and the machine setup command use the address the browser uses.            |

A key file in the data directory only protects a copy of the database taken on its own, such as a
backup. To keep the two apart, pass the key through the environment or a file stored elsewhere.
Runyard refuses to start with a key that doesn't match the database, or a key file other users
can read.

## Development

Runyard is in early development: everything is built and tested against fakes, and the parts
still to try on real forges and machines are listed in [docs/PLAN.md](docs/PLAN.md), with the
design and roadmap. It needs [Vite+](https://viteplus.dev) (`vp`) and [Bun](https://bun.sh).

```sh
vp install
vp run dev        # server on 127.0.0.1:7420 and the dashboard dev server with /api proxied to it
vp run ready      # format, lint and type checks, then every package's tests and builds
vp run ci         # ready, then a smoke test of the compiled binary (CI runs locally for now)
vp run release    # cross-compiled binaries, SHA256SUMS and the installers in apps/cli/dist/release
```

`vp run -r build` produces `apps/cli/dist/runyard`, a single binary with the dashboard embedded.
To try the dashboard against a fictional yard, without touching real machines or forges, run
`vp run -r build` and then `bun apps/server/scripts/demo.ts`.
`vp run @runyard/server#check-powershell` parses every PowerShell script Runyard ships or
generates, in Microsoft's PowerShell container (needs Docker).

## Credits

Runyard builds on [fleet](https://github.com/aarondfrancis/fleet) by Aaron Francis. Its SSH
hardening, machine health and diagnostics scripts, alert rules, plan-and-apply safety rules, and
the runner install and retire scripts for macOS, Linux and Windows are ported from fleet, as is
the shape of much of the dashboard.
