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
version. Open dashboard tabs say when the server is serving a newer dashboard than they loaded.

## Docker

`docker/compose.yaml` runs Runyard beside the official Tailscale container. Runyard shares that
container's network and serves HTTPS only on your tailnet, at
`https://<RUNYARD_HOSTNAME>.<tailnet>.ts.net:7443/`. You need a Tailscale auth key (Tailscale's
admin console, **Settings ▸ Keys**), and MagicDNS and HTTPS Certificates turned on for your
tailnet.

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

1. **Machines.** On each machine's page, click **Remove**. While Runyard has runners there, the
   dialog offers **Decommission machine**, which takes the machine out of every pool. Review and
   run its changes to remove the runners, then **Remove** the machine. Runyard refuses to remove a
   machine, a GitHub App or a Forgejo connection that still has runners, and names them.
2. **What setup left on each machine.** The Remove dialog shows a teardown command to run on the
   machine. It deletes Runyard's runner folder and its key from `authorized_keys`; with
   `--prepared`, run as root, it also removes the `runyard` account, its sudoers file and
   lingering. It refuses while a runner there is still configured. Tools a pool installed stay.
3. **Connections.** Remove each GitHub App and Forgejo connection under **Settings ▸
   Connections**, then delete the GitHub App in its settings on GitHub. If you made webhooks
   public with Funnel, run `tailscale funnel reset`.
4. **Runyard itself.** `runyard uninstall` stops and removes the service and the binary;
   `--purge` also deletes the data directory (the database, Runyard's SSH key and known hosts, and
   a generated secret key). It refuses while Runyard still has runners on machines, unless you
   add `--force`. `--dry-run` shows every step. With Docker, run
   `docker compose -f docker/compose.yaml down -v`.
