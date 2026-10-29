# Runyard guide

The full reference for using Runyard. For what it is and how to start, see the
[README](../README.md).

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
  bring it up to date (`apt update && apt full-upgrade -y`, since templates lag behind on
  security updates), install `curl` if it's missing, and run the machine's fresh-machine setup
  command as root.

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

### Runner readiness

Each check also reads whether a machine has what CI jobs commonly need, shown under **Runner
readiness** on its page:

- **Required:** git, curl and tar (plus the Command Line Tools on a Mac, and Node.js where a
  Forgejo pool runs jobs on the machine itself), a clock within a minute of Runyard's, and the
  forges reachable over HTTPS.
- **Its pools' labels:** `docker` needs a Docker this account can use, `xcode` or `xcode-16`
  needs that Xcode, and `gpu`, `cuda` or `nvidia` need an NVIDIA GPU with `nvidia-smi`. Other
  labels aren't checked.
- **Recommended:** unzip, zip, xz, zstd, jq, gpg, a C compiler and make, Python 3, and Docker.

Each missing item says how to install it, and a pool can install them for you: under **Tools
to install where they're missing**, pick **Essentials** (git, curl, tar, unzip, zip, xz, zstd,
jq, gpg), **Build tools** (a C compiler, make, Python 3) or **Docker**. Each machine's review then
shows an **Install tools** step for just what its last check found missing, ahead of the
runners, and carries it out with the package manager (apt, dnf, zypper or pacman, with the
review's sudo) or Homebrew on a Mac. Docker comes from the distribution's own packages and the
runner's account joins the `docker` group; on a Mac, Docker and the Command Line Tools stay
manual, and Homebrew must already be installed (readiness shows whether it is). Runyard also puts Homebrew's directories on the
PATH its Mac runners start with, so jobs find what it installs. A machine in a pool that's missing something required
or promised shows under **Needs attention** and on the pool's page, and the pool form suggests
labels every chosen machine can carry. The check itself only reads.

### Alerts and history

A machine alerts when it's offline on the tailnet for three minutes, or when disk space is below
10% on readings a minute apart (clearing at 12%). Reboots and SSH failures are recorded too.
History is kept for 30 days, up to 5,000 events. **Maintenance for 1 hour** pauses a machine's
alerts.

## Runners and pools

A **pool** is runner capacity: labels, the machines it runs on (with how many runners each), and
the accounts or repositories it serves. Create one under **Pools ▸ +** in three steps:

1. **What it's for:** a suggestion from what Runyard sees (queued jobs no runner has the labels
   for, connected machines not yet in a pool), or repositories and labels you choose.
2. **Where it runs:** your connected machines, each saying what its review would install.
3. **Check and create:** a summary with defaults (one persistent runner per machine, Essentials
   and Build tools installed where missing, the workspace cleared after each job), each with
   **Change**, and the runners it registers.

An organization gets one runner per slot; a personal GitHub account's repositories each get
their own, because GitHub can't share a personal account's runner across repositories.

Saving a pool changes nothing on machines. **Create and review** opens the pool with each
machine's review already prepared: what it will do there, and **Run**, one machine at a time.
**Run** reads the machine and the forge again and does nothing if anything changed since the
review. Until every machine is set up, the pool page keeps showing the reviews still to run; a
machine's own page has the same **Review changes**.

When Runyard knows a machine has changes waiting (a runner to install or remove, tools its pools
want, labels or cleanup that changed, a runner ready to retire), the machine shows them in the
sidebar ("2 changes"), under Needs attention, and on its button: **Review 2 changes**. It works
that out from its own records and the forges' runner lists; the review itself reads the machine
again and may find more, such as a runner changed by hand.

Runners live under `~/runyard-runners` (`C:\runyard-runners` on
Windows), as a LaunchAgent on macOS (it starts after the user logs in), a systemd service on
Linux, or a Windows service.

### Queued jobs

**Queued jobs** lists self-hosted jobs waiting for a runner. Each one that no runner can take
says why: no runner or pool serves its repository, the labels a runner or pool lacks, the
matching runners are offline or busy, an on-demand pool is paused or not installed yet, or a
pool's runners aren't installed yet. The MCP tool `list_queued_jobs` returns the same reasons.

### Testing a runner

A GitHub runner Runyard installed has **Test this runner** on its page: pick a repository it
serves and Runyard starts a short workflow on exactly that runner, through the label only it
carries (`runyard-runner-<name>`), then shows whether it passed, with a link to the run. The
check prints the runner's tools, compiles and runs a small C program, and optionally runs a
container. The workflow lives in your repository: the first time, Runyard shows the file to add
at `.github/workflows/runyard-runner-check.yml` (it never writes to your repositories). Starting
it needs the GitHub App's **Actions: Read and write** permission; apps created before that need
it changed in the app's settings on GitHub and the change accepted on each installation.

### Cleanup after each job

Persistent runners keep their workspace and Docker data between jobs, which keeps builds warm
but lets one job affect the next. A persistent pool's **After each job** setting can clear the
job's workspace, or the workspace and unused Docker data (stopped containers, dangling images,
unused networks and anonymous volumes). Runyard sets it up through GitHub's job hooks, the same
ones that record run history: the review's **Set job hooks** step writes
`runyard-job-started.sh` and `runyard-job-completed.sh` into each runner's directory, points the
runner's `.env` at them and restarts the runner, only while it's idle. The cleanup deletes only
inside the job's workspace under that runner's `_work` directory and never fails a job. It's for
GitHub runners on Linux and macOS; forgejo-runner has no job hooks, and on-demand runners start
clean anyway.

### Run history

Each machine, pool and runner page has **Jobs**: the last 7 days' counts ("41 passed · 2
failed") and the newest jobs with their result, how long they took, the repository and runner,
a link to the run, and **Show log**, which fetches the job's log from GitHub when you open it
and keeps nothing (GitHub keeps logs 90 days by default). The overview's machine table counts
each machine's jobs, failures in red. Runs of the **Test this runner** workflow are marked
**Test**. Jobs are kept 30 days.

A job that failed its steps is counted but doesn't flag the machine, since that's usually the
code. A job whose runner said it started but never that it finished, after GitHub finished it,
shows **Runner lost** and raises a Needs attention item on the machine: the runner or the machine
stopped mid-job.

Webhooks fill it in within seconds. Without them it still works: each GitHub runner's job hooks
append a line to `~/runyard-runners/.runyard-jobs.log` when a job starts and ends, the minute
check reads new lines, and Runyard asks GitHub once per finished job for its result. Runners set
up before run history show **Set job hooks** as a change waiting; review and run it (it restarts
each runner while idle). Forgejo jobs aren't recorded yet.

### On-demand pools

A pool is **persistent** (each slot is a registered runner waiting for jobs) or **on demand**.
An on-demand pool keeps no registered runners. Its review installs the runner software once per
machine, under `~/runyard-runners/<pool>/template-*`. After that, when a job is queued that no
idle runner can take and the pool serves its repository and has its labels, Runyard:

1. mints a single-use registration at that moment (GitHub's just-in-time config, or an
   ephemeral Forgejo runner);
2. copies the runner software into its own directory and starts a one-job runner there;
3. lets the runner take one job and deregister itself, then removes the directory.

A one-job runner takes whichever matching job the forge hands it, and can end without running
one. So a job still queued after its runner ended gets another (marked **Ended early** on the
first), up to three in all; a runner that failed to start is retried after 10 minutes. After
three, the job says so under Queued jobs, with **Try again**. Slots cap how many run at once per
machine, and a pool can be paused. A runner that never shows up on the forge is deleted after 10
minutes. Each runner's log (its output, then the end of its own diagnostic logs) is kept on the
machine in `~/runyard-runners/<pool>/jobs/.logs`, the last 20 for up to 7 days; **Show log** on
the pool page reads it. Starts and
results appear on the pool page and in each machine's history. On-demand pools run on Linux and
macOS for now.

### Runners Runyard didn't install

Runners registered another way show under **Unassigned runners**, and Needs attention lists
them until you say which machine each runs on. A runner's page has **Take over this runner**, in
three steps:

1. **Choose the machine it runs on.** It then shows on that machine's page. You can stop here:
   Runyard shows it but never changes it.
2. **Move it into a pool**: a persistent pool on that machine that serves its scope, or
   **Create a pool from this runner** with its labels. The pool's own runner is installed through
   the machine's usual review.
3. **Review and retire it.** Once the pool's runner is online, idle and labeled, the machine's
   review offers **Retire**, which deregisters the old runner on the forge and shows the steps to
   remove its service. The old runner exits on its own when it notices; Runyard never changes its
   directory.

## Forges and services

### GitHub

Under **Settings ▸ Connections ▸ GitHub**, Runyard creates a GitHub App for itself through
GitHub's manifest flow: you confirm it on GitHub, then install it on your personal account or an
organization and choose its repositories. The app's credentials are stored encrypted. Runyard
reads runners and queued jobs for the installation's repositories, and registers runners with
tokens it mints at the moment of use. It also asks for Actions read and write, to start a runner's test job. Only repositories with an Actions workflow are polled (checked every 5 minutes, so one that
gets its first workflow is picked up within that), which keeps the load low even when the App is
installed on every repository of a personal account with many of them.

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

1. Turn on Tailscale Funnel for your tailnet; it's off by default. Allow it for the control
   machine in the admin console (the `funnel` node attribute in Access controls), or run the
   command in the next step: while Funnel is off, it prints a link that turns it on, and you run
   it again afterwards.
2. Expose the listener: `tailscale funnel --bg http://127.0.0.1:7444`. Funnel publishes it at
   the machine's `https://<machine>.<tailnet>.ts.net` on port 443; the dashboard stays on 7443,
   tailnet only. Runyard shows the command; it never changes what's public on your tailnet
   itself. Any HTTPS reverse proxy to that port works too. To check it's public, open
   `https://<machine>.<tailnet>.ts.net/webhooks/github` from a device off your tailnet: it should
   say `Not found`. When Funnel is new, its public name can take up to half an hour to appear
   (`dig +short <machine>.<tailnet>.ts.net @1.1.1.1` returns nothing until then).
3. Set each app's webhook: Runyard points it at the public address with a fresh secret.
4. In the app's settings on GitHub, tick **Active** under Webhook on its **General** page. Runyard's
   app is created subscribed to **Workflow job**; if it isn't, tick it under **Permissions &
   events ▸ Subscribe to events**.

A delivery makes Runyard re-read jobs and runners through the API, and a `workflow_job` one is
recorded in run history (its job, runner and result). Nothing on a machine or a forge is ever
changed because of what a payload says.

## AI agents (MCP)

Runyard serves an [MCP](https://modelcontextprotocol.io) server at `/api/mcp` (Streamable HTTP),
so an agent such as Claude Code can ask about your CI and prepare changes for you. Create a token
under **Settings ▸ Account ▸ Access tokens**, then, for Claude Code:

```sh
claude mcp add --scope user --transport http runyard https://<runyard>/api/mcp \
  --header "Authorization: Bearer <token>"
```

`--scope user` makes it available wherever you start Claude Code; without it, only in the folder
you ran the command in. A token's access can be changed later with the menu beside **Revoke**.

- **Read only** tokens can call `yard_summary`, `list_machines`, `get_machine` (health,
  readiness, the steps to connect it with commands, recent history), `list_runners`,
  `list_queued_jobs` (with why each one waits), `list_pools` and `list_test_jobs`.
- **Read and prepare** tokens (admins only) can also `add_machine`, `save_pool`,
  `prepare_review`, `machine_setup_command` and `start_test_job`.

No tool runs a review or deletes anything. `prepare_review` returns the plan and a link to the
machine's page with that review open, marked with the token that prepared it, for you to check
and **Run**. Everything a token prepares is recorded in the machine's history as yours, via that
token. A token never has more access than its user, is shown once and stored hashed, can expire,
and works only on `/api/mcp`. Use the dashboard's HTTPS address, so the token travels encrypted;
the machine setup command needs it too.

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
admin or a viewer. **Sign out** sets that aside in the browser you use it in (others stay
signed in); the sign-in screen then offers **Continue as** your login, or a password. On loopback, users sign in with a username and password, and can add
passkeys under **Account**. Passkeys need HTTPS or `localhost`, and work only on the address
they were added from.

## Uninstalling

Take things down in this order, so nothing is left registered where Runyard can no longer reach
it:

1. **Machines.** On each machine's page, **Remove** becomes **Decommission** while Runyard has
   runners there: it takes the machine out of every pool. Review and run its changes to remove
   the runners (each is deregistered and its service removed), then **Remove** the machine.
   Runyard refuses to remove a machine, a GitHub App or a Forgejo connection that still has
   runners, naming them.
2. **What setup left on each machine.** The Remove dialog shows a teardown command to run on
   the machine: it deletes `~/runyard-runners` and Runyard's key from `authorized_keys`, and with
   `--prepared` (as root) also the `runyard` account, its sudoers file and lingering. It refuses
   while a runner there is still configured. Tools installed through tool profiles stay.
3. **Connections.** Remove each GitHub App and Forgejo connection under **Settings ▸
   Connections**, then delete the GitHub App in its settings on GitHub. If you exposed webhooks
   with Funnel, `tailscale funnel reset`.
4. **Runyard itself.** `runyard uninstall` stops and removes the service and the binary;
   `--purge` also deletes the data directory (the database, Runyard's SSH key and known hosts,
   and a generated secret key). It refuses while Runyard still has runners on machines, unless
   `--force`; `--dry-run` shows every step. With Docker, `docker compose -f docker/compose.yaml
   down -v`.

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
  through the API and adds to run history; it never changes a machine or a forge.
- **Agents prepare, people run:** MCP access tokens can read and prepare changes, never run a
  review; only a dashboard session can.

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
