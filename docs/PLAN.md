# Runyard plan

Runyard is a self-hosted control service and web dashboard for self-hosted CI runners
on GitHub Actions and Forgejo Actions. It runs on one always-on machine and is reachable from any
browser on your tailnet. It takes its operating principles from
[aarondfrancis/fleet](https://github.com/aarondfrancis/fleet) (agentless SSH monitoring, reviewed
and re-verified changes, native runner services) and removes its limits: organization-only GitHub
support, a single forge, a macOS desktop app tied to one control machine, and a hand-edited
inventory.

## Goals

- **Any GitHub account.** Organizations and personal accounts. A personal account picks the
  repositories its runners serve in the dashboard.
- **Forgejo.** Instance, organization, user and repository scoped `forgejo-runner` registrations.
- **Accessible anywhere.** A web dashboard served by the control service, exposed over Tailscale.
- **Any OS.** The control service runs on macOS, Linux and Windows, so users start on whatever
  machine they have.
- **Easy setup.** One binary or one compose file, a first-run wizard, and configuration in the UI
  instead of TOML.

## Decisions

| Area             | Decision                                                                                           | Notes                                                                                                                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Form factor      | Control service + web dashboard                                                                    | The service polls, holds credentials and runs changes; any browser views it.                                                                                                                                                                                                                   |
| Language         | TypeScript on Bun                                                                                  | One language across the stack. Machine scripts (sh/PowerShell) are ported from aarondfrancis/fleet.                                                                                                                                                                                            |
| Toolchain        | Vite+ (`vp`) with Bun workspaces                                                                   | `vp check` for format, lint and types; `vp run -r` for workspace tasks.                                                                                                                                                                                                                        |
| Server           | Hono                                                                                               | Typed RPC client (`hc`) shared with the dashboard; no codegen.                                                                                                                                                                                                                                 |
| Storage          | SQLite (`bun:sqlite`) + Drizzle                                                                    | One file. Forge credentials encrypted at rest with a key from env or a key file.                                                                                                                                                                                                               |
| Dashboard auth   | Required                                                                                           | On the tailnet, Runyard serves HTTPS itself (`tailscale cert`) and identifies each connection with `tailscale whois`; a user allowlist maps logins to roles. Elsewhere, passwords and passkeys. A first-run setup code claims a fresh install.                                                 |
| GitHub auth      | GitHub App, created through the manifest flow                                                      | The installation's repository picker is the multi-repo selection for personal accounts.                                                                                                                                                                                                        |
| Events           | Polling by default, webhooks opt-in                                                                | A tailnet-only service isn't reachable by GitHub; webhooks need Funnel or a public URL.                                                                                                                                                                                                        |
| Machines         | Agentless SSH                                                                                      | Nothing installed on machines besides the runners themselves.                                                                                                                                                                                                                                  |
| Machine access   | Runyard's own ed25519 key and known_hosts in its data directory, beside the user's own             | Created at first start with `ssh-keygen`; machines authorize it. The user's keys, agent and `~/.ssh/config` keep working. Host keys stay strictly checked.                                                                                                                                     |
| Network          | Any SSH-reachable machine; Tailscale optional                                                      | Tailscale (or Headscale) adds discovery, Tailscale SSH and the tailnet HTTPS listener. Any Tailscale variant works, including the sandboxed macOS apps: Runyard only calls the `tailscale` CLI.                                                                                                |
| Distribution     | `bun build --compile` binary (primary) and a Docker image + compose with a Tailscale sidecar       | The binary uses Runyard's own key (or the host's) and Tailscale directly.                                                                                                                                                                                                                      |
| Runner execution | GitHub runners as native services; Forgejo runners in host mode by default, Docker mode per runner |                                                                                                                                                                                                                                                                                                |
| Forgejo auth     | One user's access token per connection, encrypted at rest; Forgejo 15 or later                     | Registration through the API (`POST …/actions/runners`) needs 15+. forgejo-runner is published for Linux only, so Forgejo runners install on Linux machines with systemd; Docker mode is set per pool. The pool installs what its runners need: Node.js for host mode, Docker for Docker mode. |

## Domain model

- **Forge**: a GitHub or Forgejo instance plus its credentials (GitHub App or Forgejo token).
- **Scope**: where a registration lives: `instance`, `org`, `user` or `repo`. GitHub personal
  accounts only have `repo` scopes; GitHub orgs use `org`; Forgejo supports all four.
- **Machine**: anything reachable over SSH. Optionally matched to a tailnet node.
- **Pool**: named runner capacity: a set of machines, a slot count per machine, labels, and the
  scopes it serves.
- **Registration**: derived, never authored. A pool serving a multi-repo scope (`org`, `user`,
  `instance`) needs one registration per slot. A pool serving N GitHub `repo` scopes fans out to
  one registration per slot per repository, because GitHub runners can't be shared across a
  personal account's repositories. JIT dispatch (Phase 7) replaces fan-out with on-demand,
  single-job runners.

Derivation and plan generation are pure functions in `packages/core`, so they're tested without
GitHub, Forgejo or machines.

## Safety rules carried over

- Plan and apply stay separate. Read paths never mint tokens or change forges or machines.
- Every change opens a review. Execution re-reads the machine and refuses unless the regenerated
  plan matches the reviewed one. Reviews are single-use and expire.
- A busy runner is never restarted or removed. Never `--replace`; never move or delete a
  configured runner directory; no glob-based deletion.
- Retire needs an online, idle, labeled, active replacement. Decommission is declared first.
- OpenSSH runs with `StrictHostKeyChecking=yes`, no agent forwarding and no port forwarding.
  Scripts and short-lived tokens travel on SSH stdin, never as arguments or files.
- Registration and removal tokens are minted at the moment of use and never stored.

New, because there's no GitHub runner group to enforce policy outside organizations:

- **Public repositories are refused by default.** Anyone who can open a fork pull request could
  run code on a persistent runner. Registering to a public repository needs an explicit
  per-repository override. The override is shown with the repository's fork pull request
  approval setting.
- GitHub organizations keep the runner group policy check from aarondfrancis/fleet.

## Layout

| Path             | Responsibility                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `apps/server`    | Bun + Hono control service: API, pollers, SSH, forge clients, desired-state engine. Serves the built dashboard in production. |
| `apps/dashboard` | React SPA, built with Vite+. Talks to the server through the typed Hono client.                                               |
| `packages/core`  | Domain model and pure logic (scopes, derivation, status rules, plans). No I/O.                                                |

Further packages are extracted when a boundary is proven, not up front.

## Phases

1. **Foundation**
   - SQLite and Drizzle schema, encrypted secrets, and configuration.
   - Dashboard authentication. (Done.)
   - The production build: the server serves the dashboard from the compiled binary.
   - CI.
   - Choose the dashboard's routing, data-fetching and styling libraries.
2. **Machines**
   - Port SSH transport hardening, the health and diagnostics scripts, stale-data rules, and the
     event journal with offline and low-disk alerts.
   - Add Tailscale discovery.
   - Build the machine monitoring views. Useful before any forge is connected.
   - (Done. Only machines added to Runyard are checked; tailnet peers are offered under Add.)
3. **GitHub monitoring**
   - Set up the GitHub App manifest flow and the installation repository picker.
   - Read runners and jobs for `org` and `repo` scopes.
   - Add runner and queue views.
4. **Desired state**
   - Pools and registration derivation (fan-out).
   - Review and re-verified execution.
   - Port the GitHub runner install and retire scripts for macOS, Linux and Windows.
   - Add the public repository guard.
   - (Done. Windows logon tasks are left for later.)
   - **Moving runners Runyard didn't install into a pool** (done, against fakes): migrate rather
     than adopt in place, so the safety rules stand. An admin places the runner on its machine,
     then picks a persistent pool on that machine serving its scope (or creates one prefilled from
     the runner). The pool installs its own runner there as usual; the machine's review then shows
     a **retire** item for the old one, blocked until a pool runner on the same machine and scope
     is online, idle, labeled and running, while the old runner is busy, or while it has labels
     the pool lacks. Retiring deregisters it on the forge only (busy re-checked at the last
     moment) and shows the steps to stop and remove its service by hand; Runyard runs nothing
     outside `~/runyard-runners`. A directory, if given, only fills in those steps.
5. **Forgejo**
   - Monitoring, then the `forgejo-runner` lifecycle (host and Docker modes).
   - Verify the runner and job listing endpoints against target Forgejo versions before designing
     around them.
   - (Done, tested against a fake built from Codeberg's API spec, Forgejo 16. One user's access
     token per connection, Forgejo 15 or later. Pools serve the user's own account and the
     organizations they belong to; instance and single-repository scopes are left for later.
     Runners register through `POST …/actions/runners` and install as `runyard-forgejo-<name>`
     systemd services on Linux only, in host mode or Docker mode per pool. An account that owns
     public repositories needs its name typed before Runyard registers runners for it. Not yet run
     against a real instance or machine.)
6. **Setup**
   - Setup checks on the control machine (`/api/setup/status`): ssh and a key, the Tailscale CLI,
     login, HTTPS certificates and the tailnet URL, the secret key's source (warn to back up a
     generated key file), and a writable data directory.
   - A setup checklist on the overview, derived from current state (no saved wizard progress): checks,
     then connect a forge, add a machine, create a pool, review changes. Each step links to the
     page that does it. The tailnet URL is printed at startup and shown on the setup screen.
   - `runyard service install|uninstall|status`, running Runyard as the user (it needs their
     SSH keys): a systemd system unit with `User=` on Linux (starts at boot), a LaunchAgent on
     macOS (starts at login), a scheduled task at logon on Windows (no stored password).
   - Release builds: `vp run release` cross-compiles macOS arm64, Linux x64 and arm64, and
     Windows x64 binaries with SHA-256 sums into `dist/`. `install.sh` and `install.ps1` take a
     base URL and verify the checksum. Nothing is published while the repository is private.
   - A Docker image (the binary on Debian slim, with the ssh client and Tailscale CLI) and a
     compose file with the official Tailscale container as a sidecar: Runyard shares its network
     and socket; SSH keys and `known_hosts` are mounted read-only.
   - (Done, except the live tests listed under Pending live verification.)
7. **Webhooks and JIT**
   - Decided: JIT runners first (both forges, on polling), webhooks second (GitHub only:
     Forgejo has no confirmed webhook for a queued job). Per-pool approval: a pool is
     **Persistent** or **On demand**; one machine can be in both kinds of pool.
   - **On-demand pools** call for one runner template per machine, not registrations: the runner
     software unpacked under `~/runyard-runners/<pool>/template`, never configured. The existing
     review installs and removes templates (`installTemplate`, `removeTemplate`), with the same
     re-verification and public-repository guard; switching a pool from persistent to on demand
     turns its persistent runners into ordinary `remove` items.
   - **The dispatcher** runs after each queue refresh. For a queued job no online runner matches,
     it picks an on-demand pool whose scopes serve the job's repository and whose labels (plus the
     machine's built-in OS and architecture labels) cover the job's, then one of its machines with
     a ready template, a free slot and no operation in progress. It mints a single-use
     registration at the moment of use (GitHub `generate-jitconfig`; Forgejo `ephemeral: true`),
     sends it over SSH stdin, and starts the runner detached in its own directory under
     `<pool>/jobs/<name>`, removed when the runner exits. GitHub's JIT runner and forgejo-runner's
     `one-job` take one job and deregister themselves.
   - Every dispatch is recorded (pool, machine, runner, job, state). A job is dispatched at most
     once; a runner that hasn't appeared after 10 minutes is deleted on the forge and the dispatch
     marked failed. A sweep removes job directories whose runner process is gone. Each pool has a
     slot limit per machine, a start rate limit, and a pause switch; dispatches and their results
     go in the event journal.
   - Linux and macOS first (detached processes over SSH); Windows on-demand pools are refused
     until there's a Windows design.
   - Webhooks: GitHub `workflow_job` on a separate listener that accepts only signed webhook POSTs
     (HMAC), exposed through Tailscale Funnel or a public URL. A speed-up only: polling stays.
   - (Done, against fakes. Decided: Runyard shows the Funnel command and reads Funnel's status
     but never runs it; a delivery is only a nudge to re-read through the API. New apps
     subscribe to `workflow_job` with the hook inactive; existing ones need Active and the event
     ticked in GitHub, which the API can't change.)

Pool creation is three steps ending in each machine's review on the pool page
([docs/plans/pool-flow.md](plans/pool-flow.md), built during live testing).

## Machine setup

Getting Runyard into a machine is guided, built against fakes:

- **Runyard's own key** (`<data>/ssh/id_ed25519`, made with `ssh-keygen` at first start) and
  `known_hosts`, offered and checked beside the user's own. Its comment is kept to safe
  characters, because the setup commands quote it.
- **SSH failures are sorted** by where they stopped (connection refused or unreachable, host key
  unknown or changed, login refused, timeout), and the machine page shows the steps in SSH's
  order with the commands for the failing one per OS. Getting started reads the same steps
  (`accessSteps` in `packages/core`).
- **Host keys from the dashboard:** `ssh-keyscan` at the host and port `ssh -G` resolves, a
  fingerprint the person compares, and a second read that writes only that key. Never a silent
  replace; Tailscale's published keys are shown as a match when they agree.
- **The setup command:** a single-use, 15-minute code (kept hashed, in memory) for one machine,
  offered over HTTPS only. The script checks the SSH server, authorizes Runyard's key with
  forwarding off, and reports the user, OS and host keys; Runyard sets the user when the target
  had none and trusts exactly the reported keys. It installs nothing.
- **Prepare mode** (`--prepare`, as root, Linux only): installs the SSH server and sudo if
  missing, creates a `runyard` account with no password (`*`, not a locked `!`, which sshd
  refuses even for keys when PAM is off), authorizes the key, enables lingering, joins the
  `docker` group if present, and gives sudo: passwordless with `--sudo` or a yes at the
  terminal, otherwise a password the person sets. Checked end to end in a Debian container.
  Without it, Linux reviews still ask for the sudo password.

## Runner readiness

Planned in four parts, decided with the user; part 1 is done, against fakes and a bare Debian
container:

1. **Readiness and label checks (done):** `machine-readiness.sh`/`.ps1` run with the
   diagnostics and report tools, Docker usable by the account, Xcode, an NVIDIA GPU, the clock
   and an HTTPS request to each forge host; `evaluateReadiness` in `packages/core` sorts them
   into required, label and recommended items. Pool machines missing a required or promised
   item show under Needs attention and on the pool page; the pool form suggests labels.
2. **Baseline install (done, against fakes and a Debian container):** tool profiles per pool (Essentials, Build tools, Docker) installed as a
   reviewed plan item with the package manager; Docker from distribution packages; blocked with
   the command on Macs without Homebrew. Windows installs with winget at machine scope, with
   Windows stand-ins (7-Zip, WinLibs GCC, Python 3.13 from uv), and gives runners the machine PATH through
   their `.env` (**Update PATH**, waiting for idle runners). A pool also installs what its runners
   need whatever its profiles: Node.js for Forgejo host mode, Docker for Forgejo Docker mode
   (Linux only, where forgejo-runner runs); readiness warns on Node.js older than 20.

3. **Cleanup (done, against fakes and a Debian container):** an optional per-pool job-completed hook for persistent GitHub runners (workspace,
   optionally Docker prune), off by default. forgejo-runner documents no job-completed hook, so GitHub runners only.
4. **Test job (done, against fakes; the workflow passes actionlint):** a per-runner label, a workflow file the user adds, and a dispatch of it on that
   runner with the result shown; needs Actions read and write on the GitHub App. Forgejo later.

## AI agents (MCP)

Done, against fakes and the official MCP client: `/api/mcp`, Streamable HTTP, stateless, with the
SDK's web-standard transport (`@modelcontextprotocol/sdk` 1.29, pinned while the SDK splits into
v2 packages). Personal access tokens (`read` or `prepare`, hashed, expiring) authenticate it and
nothing else. Read tools mirror the dashboard; prepare tools save settings and prepare reviews,
recorded as `agentPrepared` events; running a review stays with a dashboard session.
`waitingReasons` in `packages/core` explains queued jobs for both the MCP tool and the Queued
jobs page.

## Planned

- **A live job feed**: one SSH session per machine with runners, printing new job lines every
  2 seconds, so a job shows as Running within seconds of starting instead of at the minute
  check. Agreed for after Round 9.

- **Container runners ("Use this machine for CI")**: a fresh container per job on Runyard's
  own machine, then on SSH machines with Docker. Agreed and designed, not started:
  [docs/plans/container-runners.md](plans/container-runners.md).
- **Documentation audit**: the guide split into task pages, every step checked against the
  dashboard, with live testing's findings. Agreed, after live testing and before release:
  [docs/plans/docs-audit.md](plans/docs-audit.md).
- **The rest of the copy pass**: pools and runners, settings, and core's waiting and plan
  reasons, compacted the way the machine pages were, plus a check on jobs that stay Running:
  [docs/plans/copy-pass.md](plans/copy-pass.md).
- **Release**: a curl install, a Homebrew formula
  and the Docker compose file for the control
  plane, from published builds. No Mac app for now. To plan after live testing:
  [docs/plans/release.md](plans/release.md).
- **Live testing still to run**: Forgejo (Round 9), Windows and Docker (Round 11), boat.dev
  (Round 11b) and taking it all down (Round 12).

## Link previews

The dashboard serves `og.png` and a 10 s `og.mp4` loop (rendered from `docs/assets/og/og.html`
by `docs/assets/og/render.sh`) with Open Graph tags, `og:video` included, made absolute for the
address each request came to. To do later:

- Previews appear only where the fetcher can reach the install. Slack and Discord fetch from
  their own servers, which can't reach a tailnet address, so a tailnet link shows none; iMessage
  fetches on the sender's device, so it can. A public project page (docs site or landing page)
  would carry the same tags where every service can read them.
- The GitHub repository's social preview is an image uploaded in its settings (no video, no
  API): upload `docs/assets/og/og.png` once the repository is public.
- Confirm a real unfurl of `og:video` (Discord is the likeliest to play it).

## Live verification

[docs/LIVE-TESTING.md](LIVE-TESTING.md) runs everything for real, in order, on a test tailnet.
Rounds 0 to 8, 8b and 10 passed on 2026-10-28 and 29: a macOS control machine, a Debian 13
Proxmox LXC and a macOS 27 VM (UTM) as runner machines, a GitHub App on a personal account with
private repositories, and webhooks through Tailscale Funnel. Fixes found along the way are in
the history, and their lessons in [docs/plans/docs-audit.md](plans/docs-audit.md).

**Verified live:**

- Install, claim and `runyard service install` on macOS; Tailscale HTTPS and the tailnet
  sign-in, including signing out.
- The GitHub App: manifest flow, installation, runner and job reads, a real runner install,
  label reconciliation and webhooks (`PATCH /app/hook/config`, `tailscale funnel status
  --json`, signed deliveries through Funnel).
- Machine setup on Debian and macOS: the setup scripts, `ssh -G` and `ssh-keyscan` on real
  hosts, the quoted `UserKnownHostsFile` list with a space in the data directory's path, and
  Runyard's key only with an SSH agent holding many keys.
- Runner readiness on Debian and macOS (Command Line Tools, Homebrew), tool installs with apt
  and Homebrew, the cleanup hook in real jobs, and test jobs including a container.
- Persistent runners as systemd services and LaunchAgents.
- On-demand pools: the runner's `ACTIONS_RUNNER_INPUT_JITCONFIG`, `generate-jitconfig`, runners
  surviving the SSH session (with lingering), pausing, and kept runner logs.
- Taking over a hand-registered runner: `DELETE …/runners/{id}` on an online runner, after which
  the old runner deletes its credentials, exits 0 and systemd stops its service.
- Run history from webhooks and from runner hooks, and the MCP server with read and prepare
  tokens, including revoking one.

**Still unverified:**

- Forgejo (Round 9): the token scopes, the `.runner` file Runyard writes, runner status values,
  host and Docker modes, `one-job` runners, and run history for Forgejo once it's built.
- Windows (Round 11): runner installs, the setup, readiness and teardown scripts (they parse
  but have never run), the scheduled task `runyard service install` sets up, and `install.ps1`.
- `runyard service install` on Linux.
- The Docker compose file with a real `TS_AUTHKEY` (Round 11): joining a tailnet and `tailscale
  cert` inside it.
- boat.dev (Round 11b): `runs-on: boat` labels, whether boat's runners show in GitHub's runner
  list, the per-VM `cost` fields and the `ci-<repo>-<job id>` VM names.
- Other Linux distributions: tool installs with dnf, zypper and pacman, and Docker from
  `moby-engine`.
- Organization installations: runner groups (the Default group's public repositories guard) and
  an organization-wide pool; only personal-account repositories ran live.
- Allowing a public repository by typing its name.
- On systemd hosts with `KillUserProcesses=yes`, whether a one-job runner survives logout.
- A runner lost mid-job showing as **Runner lost** (8b.5, skipped), and the Mac automatic-login
  warning (10.2; detection works, the warning is covered by tests).
- Whether Tailscale's published host keys match the OpenSSH server's.
- Taking it all down (Round 12): decommissioning, the teardown command and `runyard uninstall`.

## Reference

aarondfrancis/fleet's sources are the reference for ports:
`git clone https://github.com/aarondfrancis/fleet`. The useful parts are:

- `crates/fleet/scripts/`: health, diagnostics, install and retire scripts.
- `machine.rs` and `machine_diagnostics.rs`: interpreting the machine data.
- `monitoring/`: alert thresholds and hysteresis.
- `desired/`: the guards above.
