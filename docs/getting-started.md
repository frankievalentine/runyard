# Getting started

From nothing to a job running on your own machine. Each step links to the page with the
details.

## 1. Install Runyard

Install Runyard once, on the machine that will run its dashboard and control plane: the
Runyard host. Your runner machines don't need it; Runyard reaches them from the host over
SSH, and you add each one from the dashboard with its own one-line setup command (step 4).

**macOS or Linux:**

```sh
curl -fsSL https://frankievalentine.github.io/runyard/install.sh | sh
runyard service install   # keep it running
```

**Windows, in PowerShell:**

```powershell
irm https://frankievalentine.github.io/runyard/install.ps1 | iex
runyard service install   # keep it running
```

The installers download the latest [release](https://github.com/frankievalentine/runyard/releases)
and check its checksum; `RUNYARD_VERSION=0.1.0` pins a version.

To run it in Docker instead, see [Docker](operating.md#docker).

With [Tailscale](https://tailscale.com) on the Runyard host, with MagicDNS and HTTPS Certificates
turned on for your tailnet, Runyard serves the dashboard at
`https://<machine>.<tailnet>.ts.net:7443`. Without it, it serves `http://127.0.0.1:7420` only, and
you connect machines by hand; see [Without Tailscale](operating.md#without-tailscale).

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
