# Running Runyard

## As a service

`runyard service install` keeps Runyard running as your user, which it needs for your SSH keys
and `~/.ssh/config`:

| System  | How                                                                    | Starts          |
| ------- | ---------------------------------------------------------------------- | --------------- |
| Linux   | `/etc/systemd/system/runyard.service` with `User=` you (asks for sudo) | At boot         |
| macOS   | `~/Library/LaunchAgents/dev.runyard.plist`                             | When you log in |
| Windows | A `Runyard` scheduled task, without a stored password                  | When you log on |

`RUNYARD_*` settings in your environment carry into the service, except `RUNYARD_SECRET_KEY`:
service definitions are readable by other users, so use `RUNYARD_SECRET_KEY_FILE`. Add
`--dry-run` to see what would change. `runyard service status` shows whether it's running, and
`runyard service uninstall` removes the service but keeps Runyard's data.

On Linux, let your user fetch tailnet certificates with `sudo tailscale set --operator=$USER`.

### Logs

- **Linux:** `journalctl -u runyard`.
- **macOS and Windows:** `runyard.log` in the data directory (see
  [Configuration](reference.md#configuration)).

A fresh install prints its setup code there.

## Upgrading

Run the installer again, then `runyard service install`, which restarts the service on the new
version. The installer takes the latest release; set `RUNYARD_VERSION` to install a particular
one, such as an earlier version to roll back. Open dashboard tabs say when the server is serving a newer dashboard than they loaded.

## Docker

`docker/compose.yaml` runs Runyard beside the official Tailscale container. Runyard shares that
container's network and serves HTTPS only on your tailnet, at
`https://<RUNYARD_HOSTNAME>.<tailnet>.ts.net:7443/`. You need MagicDNS and HTTPS Certificates
turned on for your tailnet, and a Tailscale auth key (Tailscale's admin console, **Settings ▸
Keys**). The key is used once, so it doesn't need to be reusable. Leave **Ephemeral** off, or
Runyard leaves your tailnet whenever its container stops, and turn on **Pre-approved** if your
tailnet requires device approval.

```sh
cp docker/.env.example docker/.env                 # set TS_AUTHKEY and RUNYARD_HOSTNAME
openssl rand -base64 32 > docker/runyard.key && chmod 600 docker/runyard.key
docker compose -f docker/compose.yaml up -d
docker compose -f docker/compose.yaml logs runyard # the setup code
```

The compose file pulls `ghcr.io/frankievalentine/runyard`. Until images are published, build one
from a local release instead:

```sh
vp run release
docker compose -f docker/compose.yaml -f docker/compose.build.yaml up -d --build
```

- **Health:** `docker compose -f docker/compose.yaml ps` shows Runyard as healthy once it
  answers on `/api/health`.
- **Logs:** `docker compose -f docker/compose.yaml logs runyard`.
- **Upgrading:** set `RUNYARD_VERSION` in `docker/.env` to the new version (or leave `latest`),
  then `docker compose -f docker/compose.yaml pull` and `up -d`. Runyard updates its database
  when it starts.
- **Backups:** the `runyard-data` volume holds the database, Runyard's SSH key and its known
  hosts. Keep a copy of `docker/runyard.key` somewhere else: it decrypts the stored credentials,
  and a backup is only safe while the two are apart.
- **SSH:** Runyard's own key lives in the volume, so machines set up from the dashboard need
  nothing mounted. Your `~/.ssh` (or `RUNYARD_SSH_DIR`) is mounted read-only too, for machines you
  already reach with your own keys.
- **Webhooks:** make the listener public through the Tailscale container with
  `docker compose -f docker/compose.yaml exec tailscale tailscale funnel --bg
  http://127.0.0.1:7444`, then follow [Webhooks](forges.md#webhooks) from step 3.
- The container runs as root, because getting a certificate through the Tailscale container needs
  it.

## Over Tailscale

With Tailscale on the Runyard host, Runyard serves HTTPS on its tailnet address with a certificate
from `tailscale cert`, renewed on its own. No `tailscale serve` setup is needed. Your tailnet needs
**MagicDNS** and **HTTPS Certificates** turned on in the Tailscale admin console. Until they are,
or while Tailscale is down, Runyard serves on `127.0.0.1` only and says why.

## Without Tailscale

Runyard runs without Tailscale, serving the dashboard at `http://127.0.0.1:7420` on the Runyard
host only. Pools, reviews, runners, jobs and forges work the same. You lose:

- **The setup command.** It's offered only over HTTPS. Connect each machine with the by-hand
  steps on its page instead: authorize Runyard's key, then **Read host key** and **Trust this
  key**.
- **Picking machines from your tailnet.** Enter each SSH target, such as `runner@10.0.0.5`.
- **Signing in by Tailscale login.** Sign in with a username and password, or a passkey.
- **The offline alert** and the Tailscale rows in Diagnostics. SSH failures are still recorded.

To use the dashboard from another device:

- **An SSH tunnel:** `ssh -L 7420:127.0.0.1:7420 <runyard-host>`, then open
  `http://localhost:7420`.
- **A reverse proxy that serves HTTPS,** such as Caddy or nginx on the Runyard host, forwarding
  to `127.0.0.1:7420`. Set `RUNYARD_ORIGIN` to its address (`https://runyard.example.com`), and
  the setup command works again for machines that can reach that address.

Don't serve the dashboard on your network with `RUNYARD_HOST=0.0.0.0` alone: it's plain HTTP, so
passwords and sign-ins travel unencrypted. The Docker compose file needs Tailscale; without it,
install Runyard directly.

## Users and passkeys

On your tailnet, Runyard knows who's connecting from their Tailscale login. People whose login
you add under **Settings ▸ Users** are signed in automatically, as an admin or a viewer. **Sign
out** sets that aside in the browser you use it in; the sign-in screen then offers **Continue
as** your login, or a password.

On `127.0.0.1`, people sign in with a username and password, and can add passkeys under
**Settings ▸ Account**. Passkeys need HTTPS or `localhost`, and work only on the address they
were added from.

## Uninstalling

Take things down in this order, so nothing stays registered where Runyard can no longer reach
it:

1. **Machines.** On each machine's page, click **Remove** and confirm. Runyard takes the machine
   out of every pool, removes its runners, then removes the machine. With **Also clean up**,
   Runyard deletes its runner folder and its key on the machine as it goes. On a machine set up
   with the fresh-machine command, run the root command shown afterwards to delete the `runyard`
   account. A machine that isn't connected keeps its runners until it is.
2. **Machines Runyard can't reach.** The Remove dialog shows a teardown command to run on the
   machine. It deletes Runyard's runner folder and its key from `authorized_keys`; with
   `--prepared`, run as root, it also removes the `runyard` account, its sudoers file and
   lingering. It refuses while a runner there is still configured. Tools a pool installed stay.
3. **Connections.** Remove each GitHub App and Forgejo connection under **Settings ▸
   Connections**, then delete the GitHub App in its settings on GitHub and revoke the Forgejo
   token. **Disconnect** boat.dev and delete its API key. If you made webhooks public with
   Funnel, run `tailscale funnel reset`; it turns off every Serve and Funnel setting on that
   machine.
4. **Runyard itself.** `runyard uninstall` stops and removes the service and the binary;
   `--purge` also deletes the data directory (the database, Runyard's SSH key and known hosts, and
   a generated secret key). While Runyard still has machines or connections, it refuses and lists
   each one with what to do, and the dashboard's address. `--force` uninstalls anyway and lists
   what stays behind. `--dry-run` shows every step. With Docker, run
   `docker compose -f docker/compose.yaml down -v`.
