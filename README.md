<p align="center">
  <img src="docs/assets/runyard-mark.svg" width="96" height="96" alt="Runyard logomark: an orange locomotive pulling its train across an evening rail yard">
</p>
<h1 align="center">Runyard</h1>
<p align="center">CI runners for GitHub and Forgejo, on your machines and boat.dev.</p>
<p align="center"><sub>Builds on <a href="https://github.com/aarondfrancis/fleet">aarondfrancis/fleet</a></sub></p>

Runyard is a self-hosted dashboard and control service for CI runners. It runs on one machine,
reaches your others over SSH and Tailscale, and installs GitHub and Forgejo runners on them
after you review exactly what will change.

- **See everything:** machine health, every runner, and every queued job with why it's waiting.
- **Describe capacity, not runners:** a pool's labels, machines and repositories become
  runners, persistent or one per job.
- **Set up a machine with one command:** Runyard authorizes its key, trusts the host and checks
  it's ready to build, installing missing tools if you ask.
- **Prove it works:** run a short test job on any runner.
- **Safe by default:** nothing changes without a review, busy runners are never touched, and
  public repositories are refused unless you allow them.
- **Works with agents:** an MCP server lets AI agents read your CI and prepare changes for you
  to run.

## Quick start

```sh
curl -fsSL https://<runyard-domain>/install.sh | sh   # macOS or Linux; install.ps1 on Windows
runyard service install                                # keep it running
```

> Releases aren't published yet. Until they are, build one: clone this repository, run
> `vp install && vp run release`, then
> `RUNYARD_BASE_URL=file://$PWD/apps/cli/dist/release sh install/install.sh`.

Runyard prints its address (`https://<machine>.<tailnet>.ts.net:7443` with Tailscale, otherwise
`http://127.0.0.1:7420`) and a one-time setup code. Open it, enter the code to create the first
admin, and follow **Getting started** on the overview:

1. **Connect GitHub or Forgejo:** Runyard creates its own GitHub App, or takes a Forgejo token.
2. **Add a machine** and run the one-line setup command its page shows. On a fresh Linux LXC
   or VPS, use the fresh-machine version as root: it also installs the SSH server and creates a
   `runyard` account.
3. **Create a pool:** labels, machines and the repositories it serves.
4. **Review and run** the machine's changes. Its runners start taking jobs.

To remove Runyard later, decommission its machines in the dashboard first, then run
`runyard uninstall --purge`; the [guide](docs/GUIDE.md#uninstalling) has the full order.

## Requirements

- **Runyard's machine:** macOS on Apple silicon, Linux (x64 or arm64, glibc) or Windows x64, or
  Docker, with the OpenSSH client. [Tailscale](https://tailscale.com) is optional and
  recommended: it gives the HTTPS address, device discovery, sign-in by tailnet identity and
  the one-line machine setup.
- **Runner machines:** anything reachable over SSH.

  | OS      | GitHub runners | Forgejo runners | One per job |
  | ------- | -------------- | --------------- | ----------- |
  | macOS   | Yes            | No              | Yes         |
  | Linux   | Yes            | Yes             | Yes         |
  | Windows | Yes            | No              | Not yet     |

- **Forges:** GitHub (personal accounts and organizations) and Forgejo 15 or later.

## How it works

- **Machines.** Runyard checks each machine every minute over SSH, read-only, and shows its
  health, history and **runner readiness**: the tools jobs need, the clock, and whether it
  reaches your forges. Until a machine connects, its page walks through the setup steps.
- **Pools.** A pool is **persistent** (registered runners that wait for jobs) or **on demand**
  (a fresh one-job runner for each queued job). It can install missing tools (Essentials, Build
  tools, Docker) and clean up after each job.
- **Reviews.** Saving a pool changes nothing. **Create and review** shows each machine's exact
  plan right away; **Run** re-reads everything first and does nothing if anything changed.
- **Testing.** **Test this runner** runs a short workflow on exactly that runner.
- **boat.dev.** Jobs for boat.dev's VMs show alongside, with each VM's cost.
- **Webhooks** (optional) make Runyard notice queued GitHub jobs in seconds instead of about 45.
  They need a public address for Runyard's webhook listener, such as Tailscale Funnel, which is
  off by default and has to be turned on for your tailnet first (see the guide's GitHub webhooks).
- **AI agents.** Agents read everything and can prepare pools and reviews; only you run a
  review. Create a token under **Settings ▸ Account**, then, for Claude Code:

  ```sh
  claude mcp add --scope user --transport http runyard https://<runyard>/api/mcp \
    --header "Authorization: Bearer <token>"
  ```

The [guide](docs/GUIDE.md) covers each in detail, along with Docker, running as a service,
Tailscale, users and passkeys, runner machines (Proxmox LXC, VPS, Mac, Windows), and moving
existing runners into a pool.

## Safety

- Every change is a review you run; reviews work once and expire after 15 minutes.
- Runyard never uses `--replace`, never moves or deletes a runner's directory, and never
  restarts or removes a busy runner.
- Registration tokens are minted at the moment of use and sent only over SSH stdin.
- Public repositories are refused unless an admin types the repository's name.
- SSH runs in batch mode with strict host key checking and no forwarding; credentials are
  encrypted at rest.
- Agents' access tokens can prepare changes but never run them.

## Configuration

Runyard needs no configuration to start. The most useful settings:

| Variable                  | Effect                                                                        |
| ------------------------- | ----------------------------------------------------------------------------- |
| `RUNYARD_DATA_DIR`        | Where the database, SSH key and secret key live.                              |
| `RUNYARD_SECRET_KEY_FILE` | The key that encrypts stored credentials; keep it apart from the data.        |
| `RUNYARD_PORT`            | Local port (default `7420`); `RUNYARD_TAILNET_PORT` for the tailnet (`7443`). |
| `RUNYARD_TAILNET`         | `off` to skip the tailnet HTTPS listener.                                     |
| `RUNYARD_ORIGIN`          | The public URL, only behind a TLS-terminating reverse proxy.                  |

All settings are in the [guide](docs/GUIDE.md#configuration).

## Development

Runyard is in early development: it's built and tested against fakes, and what's still to try on
real forges and machines is listed in [docs/PLAN.md](docs/PLAN.md), with a step-by-step
[live testing checklist](docs/LIVE-TESTING.md). It needs
[Vite+](https://viteplus.dev) (`vp`) and [Bun](https://bun.sh).

```sh
vp install
vp run dev                                         # server and dashboard, with live reload
vp run ci                                          # checks, tests, build and a smoke test
vp run -r build && bun apps/server/scripts/demo.ts # a fictional yard, nothing real contacted
vp run @runyard/server#check-powershell           # parse the PowerShell scripts (needs Docker)
```

## Credits

Runyard builds on [fleet](https://github.com/aarondfrancis/fleet) by Aaron Francis: its SSH
hardening, machine health scripts, alert rules, plan-and-apply safety rules and runner scripts
are ported from fleet.
