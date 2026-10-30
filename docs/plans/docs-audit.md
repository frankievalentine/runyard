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
- Funnel's public DNS record took 20 to 30 minutes to appear in live testing, past Tailscale's
  documented 10, even with the `funnel` node attribute, the Funnel label and `tailscale funnel
  status` all in order. Check it with `dig +short <machine>.<tailnet>.ts.net @1.1.1.1` (a public
  resolver; Tailscale's own answers with the tailnet address), or from a device off the tailnet.
  "Funnel serves it at …" in Runyard reflects only the local setting.
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
- `claude mcp add` defaults to the local scope, tied to the folder it ran in; the docs now use
  `--scope user`. A token created Read only (the default) can be changed in place.
- A fresh Mac has no Command Line Tools; `/usr/bin/git`, `cc`, `make`, `python3` and
  `xcodebuild` are stand-ins that open an install dialog when run. Readiness now skips them, so
  the Mac recipe should say the dialog only appears when someone runs `xcode-select --install`.

## Explanations moved out of the dashboard, to cover

The 2026-10-30 copy pass cut these from the dashboard, which now states what happens and what
to do. The docs should carry the why.

- Machine setup command: what it does (checks the SSH server, authorizes Runyard's key, reports
  the account and host keys back) and why it is offered over HTTPS only (so the script can't be
  changed in transit).
- "Sign in with Runyard's key only": an SSH agent holding many keys (1Password's) can use up a
  machine's sign-in attempts.
- A machine's page walks you through trusting its host key once it's added.
- Diagnostics and the SSH check run automatically every minute; Check now runs them at once.
- Disk alerts fire only once low disk space is confirmed on a second read.
- Review re-reads the machine and the forge, and running changes reads them again first.
- What a tailnet device's page offers (Add to check its health, Ignore to hide it).
- Runyard's own SSH key: machines authorize it, and your own keys and ~/.ssh/config still work.
- Linux sleep: Runyard reads systemd's sleep, suspend, hibernate, hybrid-sleep and
  suspend-then-hibernate targets; unmasked targets don't prove sleep is on, and desktop and
  logind policies can differ. Logind's setting includes drop-ins and may need a service reload.
- Where diagnostics come from: `tailscale status`, the RunSSH and ForceDaemon preferences,
  `pmset` on macOS and the active power plan on Windows, and their caveats (Modern Standby,
  Mac models without autorestart, wake-on-network not guaranteeing wake over Tailscale).
- Runners on a Mac are LaunchAgents, which is why automatic login matters.
- Install commands assume apt on Linux; other distributions need their own package names.
  Homebrew's install command is on brew.sh.
- Where run history comes from: webhooks when they're set up, otherwise the runners' hooks at
  the next minute check.
