# Runyard plan

Runyard is a self-hosted control service and web dashboard for fleets of self-hosted CI runners
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

| Area             | Decision                                                                                           | Notes                                                                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Form factor      | Control service + web dashboard                                                                    | The service polls, holds credentials and runs changes; any browser views it.                                                                                                                                                                   |
| Language         | TypeScript on Bun                                                                                  | One language across the stack. Machine scripts (sh/PowerShell) are ported from fleet.                                                                                                                                                          |
| Toolchain        | Vite+ (`vp`) with Bun workspaces                                                                   | `vp check` for format, lint and types; `vp run -r` for workspace tasks.                                                                                                                                                                        |
| Server           | Hono                                                                                               | Typed RPC client (`hc`) shared with the dashboard; no codegen.                                                                                                                                                                                 |
| Storage          | SQLite (`bun:sqlite`) + Drizzle                                                                    | One file. Forge credentials encrypted at rest with a key from env or a key file.                                                                                                                                                               |
| Dashboard auth   | Required                                                                                           | On the tailnet, Runyard serves HTTPS itself (`tailscale cert`) and identifies each connection with `tailscale whois`; a user allowlist maps logins to roles. Elsewhere, passwords and passkeys. A first-run setup code claims a fresh install. |
| GitHub auth      | GitHub App, created through the manifest flow                                                      | The installation's repository picker is the multi-repo selection for personal accounts.                                                                                                                                                        |
| Events           | Polling by default, webhooks opt-in                                                                | A tailnet-only service isn't reachable by GitHub; webhooks need Funnel or a public URL.                                                                                                                                                        |
| Machines         | Agentless SSH                                                                                      | Nothing installed on machines besides the runners themselves.                                                                                                                                                                                  |
| Network          | Any SSH-reachable machine; Tailscale optional                                                      | Tailscale (or Headscale) adds discovery, Tailscale SSH and the tailnet HTTPS listener. Any Tailscale variant works, including the sandboxed macOS apps: Runyard only calls the `tailscale` CLI.                                                |
| Distribution     | `bun build --compile` binary (primary) and a Docker image + compose with a Tailscale sidecar       | The binary uses the host's SSH keys and Tailscale directly.                                                                                                                                                                                    |
| Runner execution | GitHub runners as native services; Forgejo runners in host mode by default, Docker mode per runner |                                                                                                                                                                                                                                                |
| Forgejo auth     | One user's access token per connection, encrypted at rest; Forgejo 15 or later                     | Registration through the API (`POST …/actions/runners`) needs 15+. forgejo-runner is published for Linux only, so Forgejo runners install on Linux machines with systemd; Docker mode is set per pool and needs Docker already installed.      |

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
- GitHub organizations keep the runner group policy check from fleet.

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
   - (Done. Legacy-runner migration, adopting hand-registered runners and Windows logon tasks are left for later.)
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
   - A Getting started checklist derived from current state (no saved wizard progress): checks,
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
7. **Webhooks and JIT**
   - Opt-in webhooks (Funnel or a public URL, HMAC verified).
   - A dispatcher that mints just-in-time runner configs for queued jobs and runs single-job
     runners on idle machines.

## Pending live verification

Built and tested only against fakes. Deferred until a real service or machine is available:

- The GitHub App: manifest flow, installation, runner and job reads, and a real runner install.
- Forgejo, on a real instance and Linux machine:
  - The access-token scopes the settings page asks for (user, organization and repository,
    read and write) are inferred, not tested.
  - Runyard writes forgejo-runner's `.runner` file itself after API registration; if its format
    is wrong, the runner won't start.
  - Runner status values are assumed to be `offline`, `idle` and `active`.
  - Docker mode.
- Real runner installs on macOS, Linux and Windows. The PowerShell scripts haven't been
  syntax-checked.
- `runyard service install` on each OS (only `--dry-run` has run, on macOS). The Windows
  scheduled task and its PowerShell launcher are untested.

## Reference

Fleet's sources are the reference for ports:
`git clone https://github.com/aarondfrancis/fleet`. The useful parts are:

- `crates/fleet/scripts/`: health, diagnostics, install and retire scripts.
- `machine.rs` and `machine_diagnostics.rs`: interpreting the machine data.
- `monitoring/`: alert thresholds and hysteresis.
- `desired/`: the guards above.
