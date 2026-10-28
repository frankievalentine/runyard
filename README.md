# Runyard

A self-hosted control service and web dashboard for fleets of self-hosted GitHub Actions and
Forgejo Actions runners. Runyard runs on one always-on machine, reaches your other machines over
SSH, and serves its dashboard to any browser on your tailnet.

Early development. See [docs/PLAN.md](docs/PLAN.md) for the design and roadmap.

## Development

Requires [Vite+](https://viteplus.dev) (`vp`) and Bun.

```sh
vp install
vp run dev        # server on 127.0.0.1:7420 and the dashboard dev server with /api proxied to it
vp run ready      # format, lint and type checks, then every package's tests and builds
vp run ci         # ready, then a smoke test of the compiled binary (CI runs locally for now)
```

`vp run -r build` also produces `apps/cli/dist/runyard`, a single binary with the dashboard
embedded.

## First run

Start Runyard and look at its output. With no admin yet, it prints a one-time setup code:

```
No admin yet. Open the dashboard and enter this setup code to create one:

    CVZR-SYJD-4HZP
```

Open the dashboard and enter the code to create the first admin. The code changes at every start
until an admin exists, so only someone who can read Runyard's output can claim the install.

## Access over Tailscale

Runyard listens on loopback TCP and on a private Unix socket. Expose the socket on your tailnet
with HTTPS:

```sh
tailscale serve --bg unix:"$HOME/Library/Application Support/Runyard/runyard.sock"   # macOS
tailscale serve --bg unix:"$HOME/.local/share/runyard/runyard.sock"                  # Linux
```

The sandboxed Mac App Store build of Tailscale may not be able to reach a socket in your Library
folder; the standalone or Homebrew `tailscaled` can. This hasn't been verified yet.

Requests through the socket carry Tailscale's identity, so users whose Tailscale login is added in
**Users** are signed in automatically. Tailscale identity is trusted only on the socket; on TCP,
users sign in with a username and password.

## Passkeys

Signed-in users can add passkeys under **Account** and then sign in without a password. Passkeys
need HTTPS or `localhost`, so they're available through `tailscale serve` but not over plain HTTP.
A passkey works only on the address it was added from.

## Configuration

| Variable                  | Effect                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RUNYARD_HOST`            | Server bind address (default `127.0.0.1`).                                                                                                                                                                                                 |
| `RUNYARD_PORT`            | Server port (default `7420`); the dashboard dev proxy follows it.                                                                                                                                                                          |
| `RUNYARD_DATA_DIR`        | Database and generated key location. Defaults to `~/Library/Application Support/Runyard` on macOS and `$XDG_DATA_HOME/runyard` (`~/.local/share/runyard`) elsewhere. Created with mode `700`; an existing directory keeps its permissions. |
| `RUNYARD_SECRET_KEY`      | Base64 32-byte key (`openssl rand -base64 32`) that encrypts stored credentials.                                                                                                                                                           |
| `RUNYARD_SECRET_KEY_FILE` | File holding that key. Used when `RUNYARD_SECRET_KEY` is unset; defaults to `secret.key` in the data directory, generated with mode `600` on first start.                                                                                  |
| `RUNYARD_SOCKET`          | Unix socket for `tailscale serve` (default `runyard.sock` in the data directory, mode `600`); `off` disables it.                                                                                                                           |
| `RUNYARD_ORIGIN`          | The dashboard's public URL, such as `https://runyard.example.com`. Only needed behind a TLS-terminating reverse proxy on TCP, so passkeys verify against the address the browser uses.                                                     |

A key file in the data directory only protects a copy of the database taken on its own, such as a
backup. To keep the two apart, pass the key through the environment or a file stored elsewhere.
Runyard refuses to start with a key that doesn't match the database, or a key file other users
can read.
