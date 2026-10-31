# Reference

## Requirements

**The Runyard host**, the machine Runyard runs on:

- macOS on Apple silicon, Linux (x64 or arm64, with glibc), or Windows x64. Or Docker.
- The OpenSSH client: `ssh`, `ssh-keygen` and `ssh-keyscan`.
- Optional, recommended: [Tailscale](https://tailscale.com), with MagicDNS and HTTPS Certificates
  turned on, for the HTTPS dashboard address, device discovery, sign-in by Tailscale login, and
  the one-command machine setup. See [Without Tailscale](operating.md#without-tailscale) for what
  changes without it.

**Machines that run runners:** anything Runyard can reach over SSH.

| System  | GitHub runners        | Forgejo runners | On-demand pools |
| ------- | --------------------- | --------------- | --------------- |
| macOS   | Yes (LaunchAgent)     | No              | Yes             |
| Linux   | Yes (systemd)         | Yes             | Yes             |
| Windows | Yes (Windows service) | No              | No              |

Linux installs need root for tools and services: passwordless sudo, or the password entered in
the review. NixOS needs `apps/server/scripts/nixos-runner-prerequisites.nix` imported first.

**Forges:** GitHub (personal accounts and organizations) and Forgejo 15 or later.

## Configuration

Runyard needs no configuration to start.

| Variable                  | Effect                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUNYARD_HOST`            | Address to listen on (default `127.0.0.1`).                                                                                                                                                                         |
| `RUNYARD_PORT`            | Port (default `7420`); the dashboard dev proxy follows it.                                                                                                                                                          |
| `RUNYARD_DATA_DIR`        | Where the database, SSH key and generated secret key live. Defaults to `~/Library/Application Support/Runyard` on macOS and `$XDG_DATA_HOME/runyard` (`~/.local/share/runyard`) elsewhere. Created with mode `700`. |
| `RUNYARD_SECRET_KEY`      | Base64 32-byte key (`openssl rand -base64 32`) that encrypts stored credentials.                                                                                                                                    |
| `RUNYARD_SECRET_KEY_FILE` | File holding that key, used when `RUNYARD_SECRET_KEY` is unset. Defaults to `secret.key` in the data directory, generated with mode `600` on first start.                                                           |
| `RUNYARD_TAILNET`         | `off` turns off the tailnet HTTPS listener.                                                                                                                                                                         |
| `RUNYARD_TAILNET_PORT`    | Tailnet HTTPS port (default `7443`). macOS lets any user listen on `443`; Linux needs extra privileges for it.                                                                                                      |
| `RUNYARD_TAILSCALE`       | Path to the `tailscale` CLI, if it isn't on `PATH`.                                                                                                                                                                 |
| `RUNYARD_WEBHOOK_PORT`    | Port on `127.0.0.1` for GitHub webhooks (default `7444`).                                                                                                                                                           |
| `RUNYARD_WEBHOOKS`        | `off` turns off the webhook listener.                                                                                                                                                                               |
| `RUNYARD_SSH`             | Path to `ssh` (default `/usr/bin/ssh` where it exists, else `ssh` on `PATH`).                                                                                                                                       |
| `RUNYARD_SSH_KEYGEN`      | Path to `ssh-keygen`, which creates Runyard's own key (default `/usr/bin/ssh-keygen` where it exists).                                                                                                              |
| `RUNYARD_SSH_KEYSCAN`     | Path to `ssh-keyscan`, which reads machines' host keys (default `/usr/bin/ssh-keyscan` where it exists).                                                                                                            |
| `RUNYARD_ORIGIN`          | The dashboard's public URL, such as `https://runyard.example.com`. Only needed behind a reverse proxy that handles HTTPS, so passkeys and the setup command use the address the browser uses.                       |

A key file in the data directory protects only a copy of the database taken on its own, such as a
backup. To keep the two apart, pass the key through the environment or a file stored elsewhere.
Runyard refuses to start with a key that doesn't match the database, or a key file other users
can read.

## Troubleshooting

Listed by what you see.

| You see                                                                                     | Where                           | Cause and fix                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Too many authentication failures                                                            | A machine's connection          | Your SSH agent offers more keys than the machine allows before Runyard's. Add a `Host` block for the machine in `~/.ssh/config` with `IdentitiesOnly yes` and `IdentityAgent none`. |
| A job stays queued                                                                          | **Queued jobs**                 | Each job there says why. A label no runner has is usually a typo in `runs-on`; compare it with the pool page's **Use it in a workflow**.                                            |
| A webhook URL doesn't answer off your tailnet                                               | Your browser or `dig`           | Funnel's public name can take up to half an hour to appear after you turn it on. Check with `dig +short <machine>.<tailnet>.ts.net @1.1.1.1`.                                       |
| Tailscale unattended mode: Disabled                                                         | A Windows machine's Diagnostics | Turn on **Run unattended** in Tailscale, or the machine leaves your tailnet when you sign out.                                                                                      |
| PowerShell scripts: Restricted                                                              | Runner readiness                | Run `Set-ExecutionPolicy RemoteSigned -Scope LocalMachine` in an administrator PowerShell.                                                                                          |
| `The term '7z' is not recognized`, or another tool, in a Windows job                        | The job's log                   | The tool is installed for one account, or as an app alias. Check Runner readiness: **Only for this account** means install it for every account, or let a pool install it.          |
| `No application is associated with the specified file` or `Access is denied` running a tool | The job's log                   | The runner's account can't read the tool's files. Runner readiness shows **Runner can't run it**; run the machine's review, or the `icacls` command shown.                          |
| `running scripts is disabled on this system`                                                | A Windows job's log             | The PowerShell execution policy; see the PowerShell scripts row above.                                                                                                              |
| `externally-managed-environment` from `pip install`                                         | A Windows job's log             | Runyard's Python is managed by uv. Use a virtual environment or `uv pip`; see [Writing workflows](workflows.md#windows).                                                            |
| Couldn't install … (its download failed)                                                    | A review's tools step           | The package's download server didn't answer. The rest of the review still ran; review again later to install what's missing.                                                        |
