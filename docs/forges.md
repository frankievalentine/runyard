# Forges

Runyard registers runners on GitHub and Forgejo, and shows jobs headed for boat.dev's VMs. Connect
each under **Settings ▸ Connections**.

## GitHub

Runyard creates a GitHub App for itself: on the **GitHub** page, click **Create a GitHub App**,
confirm it on GitHub, then install it on your personal account or an organization and choose its
repositories.

The app reads runners and queued jobs, registers runners with tokens Runyard creates at the
moment it needs them, and can start a runner's test job. Its credentials are stored encrypted.
Runyard watches only repositories that have a workflow, and picks up one that gets its first
workflow within 5 minutes.

### Webhooks

Optional. Without them, Runyard notices a queued job within about 45 seconds; with them, within
seconds. They need a public HTTPS address for Runyard's webhook listener, which answers only
signed deliveries. With Tailscale Funnel, on the **GitHub** page under **Webhooks**:

1. **Turn on Funnel for your tailnet;** it's off by default. Allow it for the Runyard host in the
   Tailscale admin console (the `funnel` node attribute in Access controls), or run the command in
   the next step: while Funnel is off, it prints a link that turns it on.
2. **Make the listener public:** `tailscale funnel --bg http://127.0.0.1:7444`. That publishes it
   at `https://<machine>.<tailnet>.ts.net` on port 443; the dashboard stays on 7443, on your
   tailnet only. Runyard shows the command but never changes what's public itself. Any HTTPS
   reverse proxy to that port works too.
3. **Check it's public:** open `https://<machine>.<tailnet>.ts.net/webhooks/github` from a device
   off your tailnet. It should say `Not found`. A new Funnel's public name can take up to half an
   hour to appear; `dig +short <machine>.<tailnet>.ts.net @1.1.1.1` returns nothing until then.
4. **Point the app at it:** Runyard sets each app's webhook to the public address, with a fresh
   secret.
5. **Turn it on at GitHub:** in the app's settings, tick **Active** under Webhook on its
   **General** page. The app is created subscribed to **Workflow job**; if it isn't, tick it under
   **Permissions & events ▸ Subscribe to events**.

A delivery only makes Runyard read jobs and runners again and adds the job to run history. Nothing
on a machine or a forge changes because of what a delivery says.

## Forgejo

Connect a Forgejo instance (15 or later) on the **Forgejo** page with an access token whose user,
organization and repository scopes are set to read and write. Runyard watches that user's
runners and those of every organization they belong to.

A pool can serve an account (a user or organization), whose runner serves every repository it
owns, or single repositories. Choosing an account covers its repositories, so a pool takes one or
the other. A single repository's runner registers on that repository.

Jobs run one of two ways, set per pool under **Forgejo jobs**:

- **On the machine:** steps run as the SSH account. The pool installs Node.js where it's
  missing, because JavaScript actions such as `actions/checkout` need it.
- **In Docker containers:** each job runs in a container from the pool's **Default image**. The
  pool installs Docker where it's missing.

forgejo-runner is published for Linux only, so Forgejo runners install on Linux machines, as
systemd services named `runyard-forgejo-<pool>-<scope>-<NN>`, from the latest forgejo-runner
release with its checksum verified.

## boat.dev

Jobs that ask for [boat.dev](https://docs.boat.dev/ci.md)'s labels (`boat`, `boat-small`,
`boat-large`, `boat-xlarge`) show as **Starts on boat.dev**, since boat.dev starts a VM for each.
The sidebar's **boat.dev** row opens their running and queued jobs.

To see costs, connect boat.dev there with a key limited to `sandbox.read` and `account.read`.
Runyard then shows each job's VM size and cost so far, your plan's limits, and VMs still billing
outside a CI job. Costs are this UTC month at list price. Runyard only reads; it never starts,
stops or changes a VM.
