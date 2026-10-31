# Getting started

From nothing to a job running on your own machine. Each step links to the page with the
details.

## 1. Install Runyard

Install it on the machine that will run the dashboard, the Runyard host. It reaches your other
machines from there, over SSH.

```sh
curl -fsSL https://<runyard-domain>/install.sh | sh   # macOS or Linux; install.ps1 on Windows
runyard service install                                # keep it running
```

Releases aren't published yet. Until they are, build one: clone this repository, run
`vp install && vp run release`, then `RUNYARD_BASE_URL=file://$PWD/apps/cli/dist/release sh
install/install.sh`. To run it in Docker instead, see [Docker](operating.md#docker).

With [Tailscale](https://tailscale.com) on the Runyard host, with MagicDNS and HTTPS Certificates
turned on for your tailnet, Runyard serves the dashboard at
`https://<machine>.<tailnet>.ts.net:7443`. Without it, it serves `http://127.0.0.1:7420` only.
Tailscale is optional, but the one-command machine setup needs the HTTPS address.

## 2. Claim it

Runyard prints a one-time setup code when it first starts: in the terminal, or in its log when
it runs as a service (see [Logs](operating.md#logs)). Open the dashboard, enter the code and
create the first admin. The overview's **Getting started** then walks through the rest.

## 3. Connect your forge

Under **Settings ▸ Connections**:

- **GitHub:** Runyard creates its own GitHub App. You confirm it on GitHub, then install it on
  your account or organization and choose its repositories.
- **Forgejo:** paste an access token with read and write on the user, organization and
  repository scopes.

See [Forges](forges.md).

## 4. Add a machine

Click **+** beside **Machines** in the sidebar, pick a device from your tailnet or enter an SSH
target, and open the machine. Its page shows **Connect Runyard to &lt;machine&gt;** with one
command to run on it. On a fresh Linux container or VPS, run the fresh-machine version as root.

The machine needs a few things first, which depend on what it is: see the recipes in
[Machines](machines.md#recipes).

## 5. Create a pool

Click **+** beside **Pools**. A pool says which repositories its runners serve, which labels
they carry, and which machines they run on. See [Pools](pools.md).

## 6. Review and run

**Create and review** shows exactly what each machine will get: tools, runners, hooks. Click
**Run** on each. The runners come online within a minute.

## 7. Send it a job

The pool's page shows **Use it in a workflow**: the `runs-on` line and a file to copy into your
repository. Push it, and the job runs on your machine. See [Writing workflows](workflows.md).
