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
3. **GitHub monitoring**
   - Set up the GitHub App manifest flow and the installation repository picker.
   - Read runners and jobs for `org` and `repo` scopes.
   - Add runner and queue views.
4. **Desired state**
   - Pools and registration derivation (fan-out).
   - Review and re-verified execution.
   - Port the GitHub runner install and retire scripts for macOS, Linux and Windows.
   - Add the public repository guard.
5. **Forgejo**
   - Monitoring, then the `forgejo-runner` lifecycle (host and Docker modes).
   - Verify the runner and job listing endpoints against target Forgejo versions before designing
     around them.
6. **Setup**
   - A first-run wizard (dependency checks, App creation, first machine and pool).
   - The Docker image and compose file with a Tailscale sidecar.
   - Showing the tailnet address and Tailscale setup status in the wizard.
7. **Webhooks and JIT**
   - Opt-in webhooks (Funnel or a public URL, HMAC verified).
   - A dispatcher that mints just-in-time runner configs for queued jobs and runs single-job
     runners on idle machines.

## Reference

Fleet's sources are the reference for ports:
`git clone https://github.com/aarondfrancis/fleet`. The useful parts are:

- `crates/fleet/scripts/`: health, diagnostics, install and retire scripts.
- `machine.rs` and `machine_diagnostics.rs`: interpreting the machine data.
- `monitoring/`: alert thresholds and hysteresis.
- `desired/`: the guards above.
