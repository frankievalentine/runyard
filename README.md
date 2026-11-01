<p align="center">
  <img src="docs/assets/runyard-mark.svg" width="96" height="96" alt="Runyard logomark: an orange locomotive pulling its train across an evening rail yard">
</p>
<h1 align="center">Runyard</h1>
<p align="center">CI runners for GitHub and Forgejo, on your machines and boat.dev.</p>
<p align="center"><sub>Builds on <a href="https://github.com/aarondfrancis/fleet">aarondfrancis/fleet</a></sub></p>

Runyard is a self-hosted dashboard and control service for CI runners. It runs on one machine,
reaches your others over SSH and Tailscale, and installs GitHub and Forgejo runners on them
after you review exactly what will change.

https://github.com/user-attachments/assets/c089671d-8b51-4d2c-9823-d7363ed98225

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
curl -fsSL https://frankievalentine.github.io/runyard/install.sh | sh   # macOS or Linux
runyard service install                                                 # keep it running
```

On Windows, in PowerShell: `irm https://frankievalentine.github.io/runyard/install.ps1 | iex`,
then `runyard service install`. The installers download the latest
[release](https://github.com/frankievalentine/runyard/releases) and check its checksum;
`RUNYARD_VERSION=0.1.0` pins a version.

> The first release isn't out yet. Until it is, build one: clone this repository, run
> `vp install && vp run release`, then
> `RUNYARD_BASE_URL=file://$PWD/apps/cli/dist/release sh install/install.sh`.

Runyard prints its address (`https://<machine>.<tailnet>.ts.net:7443` with Tailscale, otherwise
`http://127.0.0.1:7420`) and a one-time setup code. Open it, enter the code to create the first
admin, and follow **Getting started** on the overview (or [Getting started](docs/getting-started.md)
here):

1. **Connect GitHub or Forgejo:** Runyard creates its own GitHub App, or takes a Forgejo token.
2. **Add a machine** and run the one-line setup command its page shows. On a fresh Linux LXC
   or VPS, use the fresh-machine version as root: it also installs the SSH server and creates a
   `runyard` account.
3. **Create a pool:** labels, machines and the repositories it serves.
4. **Review and run** the machine's changes. Its runners start taking jobs.
5. **Point a workflow at the pool:** its page shows the `runs-on` line and a file to start
   from. [Writing workflows](docs/workflows.md) covers labels, Windows and Forgejo.

To remove Runyard later, run `runyard uninstall --purge`. It lists the machines and connections
to remove in the dashboard first; [Uninstalling](docs/operating.md#uninstalling) has the full
order.

## Docker

Runyard also runs in Docker, beside the official Tailscale container, and serves HTTPS on your
tailnet only. You need:

- Docker with Compose, on Linux, macOS (Docker Desktop or OrbStack) or Windows.
- A tailnet with **MagicDNS** and **HTTPS Certificates** turned on (the admin console's DNS page).
- A Tailscale auth key from the admin console's **Settings ▸ Keys**. It doesn't need to be
  reusable. Leave **Ephemeral** off, or Runyard leaves your tailnet whenever it stops. Turn on
  **Pre-approved** if your tailnet requires device approval.

```sh
git clone https://github.com/frankievalentine/runyard && cd runyard
cp docker/.env.example docker/.env                  # set TS_AUTHKEY and RUNYARD_HOSTNAME
openssl rand -base64 32 > docker/runyard.key && chmod 600 docker/runyard.key
docker compose -f docker/compose.yaml up -d
docker compose -f docker/compose.yaml logs runyard  # the address and setup code
```

> Images aren't published yet. Until they are, build one with [Vite+](https://viteplus.dev)
> and [Bun](https://bun.sh): `vp install && vp run release`, then
> `docker compose -f docker/compose.yaml -f docker/compose.build.yaml up -d --build`.

Open `https://<RUNYARD_HOSTNAME>.<tailnet>.ts.net:7443/`, enter the setup code, and continue from
step 1 of the Quick start. Back up `docker/runyard.key` somewhere other than this machine: it
decrypts the credentials Runyard stores. Upgrades, backups and webhooks are in
[Docker](docs/operating.md#docker).

### Set it up with an agent

Paste this into Claude Code or another coding agent on the machine that will run Runyard:

```text
Set up Runyard in Docker on this machine, following the Docker section of the README in
https://github.com/frankievalentine/runyard and docs/operating.md#docker.

1. Check that Docker with Compose v2 is running. Stop and tell me if it isn't.
2. Clone the repository and work from its root.
3. Copy docker/.env.example to docker/.env. Ask me for Runyard's machine name on my tailnet
   (default: runyard) and set RUNYARD_HOSTNAME to it.
4. Ask me to create a Tailscale auth key (admin console, Settings > Keys: not reusable, not
   ephemeral, pre-approved if my tailnet requires device approval) and to paste it into
   docker/.env after TS_AUTHKEY= myself. Never ask for the key in this chat, and never print
   docker/.env. Wait until I say it's done.
5. If docker/runyard.key doesn't exist, create it with
   `openssl rand -base64 32 > docker/runyard.key && chmod 600 docker/runyard.key`.
   Never overwrite an existing one.
6. Start it with `docker compose -f docker/compose.yaml up -d`. If the image can't be pulled
   because it isn't published yet, check that vp (Vite+) and bun are installed, run
   `vp install && vp run release`, then
   `docker compose -f docker/compose.yaml -f docker/compose.build.yaml up -d --build`.
7. Wait until `docker compose -f docker/compose.yaml ps` shows runyard as healthy and its log
   shows "listening on https://...ts.net:7443/ (tailnet)". If the log says the tailnet can't
   issue HTTPS certificates, tell me to turn on MagicDNS and HTTPS Certificates on the DNS
   page of the Tailscale admin console, then check again.
8. Tell me the dashboard address and the setup code from
   `docker compose -f docker/compose.yaml logs runyard`, and remind me to back up
   docker/runyard.key somewhere other than this machine.

Don't change my Tailscale settings, open ports, or connect to any other machine.
```

## Requirements

- **Runyard host:** a Mac (Apple silicon), Linux (x64 or arm64, glibc), Windows x64 or Docker,
  with `ssh`.
- **Tailscale (recommended):** gives the HTTPS dashboard, device discovery, Tailscale sign-in and
  one-line machine setup. Turn on MagicDNS and HTTPS Certificates. Docker needs it;
  [without it](docs/operating.md#without-tailscale), you connect machines by hand.
- **Forges:** GitHub, and Forgejo 15 or later.
- **Runner machines:** anything Runyard reaches over SSH.
  - **Linux:** GitHub and Forgejo runners, persistent or on demand.
  - **macOS:** GitHub runners, persistent or on demand.
  - **Windows:** GitHub runners, persistent.

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
- **Run history.** Every job on your runners, per machine, pool and runner: results, durations
  and logs, with a runner lost mid-job flagged as the machine's problem. Kept 30 days.
- **boat.dev.** Jobs for boat.dev's VMs show alongside, with each VM's cost.
- **Webhooks** (optional) make Runyard notice queued GitHub jobs in seconds instead of about 45.
  They need a public address for Runyard's webhook listener, such as Tailscale Funnel, which is
  off by default and has to be turned on for your tailnet first (see
  [Webhooks](docs/forges.md#webhooks)).
- **AI agents.** Agents read everything and can prepare pools and reviews; only you run a
  review. Create a token under **Settings ▸ Account**, then, for Claude Code:

  ```sh
  claude mcp add --scope user --transport http runyard https://<runyard>/api/mcp \
    --header "Authorization: Bearer <token>"
  ```

The [documentation](docs/GUIDE.md) covers each in detail, along with Docker, running as a
service, Tailscale, users and passkeys, recipes for runner machines (Proxmox LXC, VPS, Mac,
Windows), and taking over existing runners.

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

All settings are in [Configuration](docs/reference.md#configuration).

## Development

It needs [Vite+](https://viteplus.dev) (`vp`) and [Bun](https://bun.sh).

```sh
vp install
vp run dev                                         # server and dashboard, with live reload
vp run ci                                          # checks, tests, build and a smoke test
vp run -r build && bun apps/server/scripts/demo.ts # a fictional yard, nothing real contacted
vp run @runyard/server#check-powershell           # parse the PowerShell scripts (needs Docker)
```

GitHub Actions runs `vp run ci` on every push and pull request.

**Releasing:** set the version in `apps/server/package.json` (the one `runyard version` prints),
commit, then tag and push it: `git tag v0.1.0 && git push origin v0.1.0`. The release workflow
builds the binaries for every platform, pushes the Docker image to
`ghcr.io/frankievalentine/runyard` (tagged `0.1.0`, `0.1` and `latest`), and drafts a GitHub
Release with the binaries, checksums and installers. Publishing the draft makes it the latest
release, which the installers download, and updates the installers on GitHub Pages. A tag with a
suffix, such as `v0.2.0-rc.1`, makes a pre-release instead. Run the workflow by hand from the
Actions tab for a dry run that builds everything and publishes nothing.

## Built with

- **Runtime and language:** [Bun](https://bun.sh) and [TypeScript](https://www.typescriptlang.org).
  The CLI is a single binary compiled with `bun build --compile`, with the dashboard embedded.
- **Server:** [Hono](https://hono.dev), [Drizzle ORM](https://orm.drizzle.team) on Bun's SQLite,
  [Zod](https://zod.dev), [SimpleWebAuthn](https://simplewebauthn.dev) for passkeys and the
  [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) for agents.
- **Dashboard:** [React](https://react.dev), [TanStack Router](https://tanstack.com/router) and
  [Query](https://tanstack.com/query), [Base UI](https://base-ui.com) and
  [Tailwind CSS](https://tailwindcss.com).
- **Toolchain:** [Vite+](https://viteplus.dev): Vite, Vitest, Oxlint and Oxfmt, with Bun's test
  runner for the server.
- **On your machines:** OpenSSH and [Tailscale](https://tailscale.com), GitHub's
  [actions/runner](https://github.com/actions/runner) and
  [Forgejo Runner](https://code.forgejo.org/forgejo/runner). Tools install with Homebrew on
  macOS, the system package manager on Linux, and winget and [uv](https://docs.astral.sh/uv/)
  on Windows.

## Credits

Runyard builds on [fleet](https://github.com/aarondfrancis/fleet) by Aaron Francis: its SSH
hardening, machine health scripts, alert rules, plan-and-apply safety rules and runner scripts
are ported from fleet.
