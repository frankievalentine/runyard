# Planned: documentation audit

Status: **agreed, not started.** Decided with the user on 2026-10-29: after live testing (Rounds
7 to 12) and before release, so labels stop moving first.

## Shape

Split `docs/GUIDE.md` into task pages under `docs/`, with the README as a short index:

- **Getting started:** install, claim, run as a service.
- **Machines:** connecting, and a recipe per kind: Proxmox LXC, Debian or Ubuntu VM, Mac, Windows.
- **Pools:** persistent, on demand, tools, cleanup, pausing, changes waiting and reviews.
- **Taking over existing runners**, including registering one by hand for testing.
- **Forges:** the GitHub App, webhooks with Funnel, Forgejo, boat.dev.
- **Operating:** upgrades, the Docker install, logs (one-job runner logs, `journalctl`),
  uninstalling.
- **Security model** and **Reference:** settings, environment variables, troubleshooting by
  the error message people actually see.

## How

- Every click instruction checked against the dashboard's own button and label text.
- Every command checked against the scripts it describes.
- Steps that need real hardware (Proxmox, Funnel, Windows) flagged for confirming in
  `docs/LIVE-TESTING.md`.

## Findings from live testing, to cover

- Tailscale Funnel is off by default and must be turned on for the tailnet before webhooks
  (now said in the Webhooks section, the guide and the README).
- Funnel publishes the webhook listener on port 443; the dashboard stays on 7443, tailnet only.
- The LXC was Debian 13, not 12; the Tailscale `/dev/net/tun` lines; a DNS note for the Proxmox
  recipe, pending which case it was.
- On the control Mac, an SSH agent offering many keys gives "Too many authentication failures";
  the fix is a Host block with `IdentitiesOnly yes` (and `IdentityAgent none`).
- The `runyard` account can't read system journals: `sudo journalctl -u 'actions.runner.*'`.
- One-job runner logs are kept in `~/runyard-runners/<pool>/jobs/.logs` and shown by **Show log**.
- Registering a runner by hand (GitHub's steps, `./svc.sh install <user>`), for takeovers.
- A retired runner notices within its next poll, deletes its credentials and exits; systemd stops
  the service. Only the unit and directory are left for the cleanup commands.
- Runners installed before cleanup was recorded need one review that sets cleanup before edits
  show as changes waiting.
