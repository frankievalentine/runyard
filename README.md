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

## Configuration

| Variable                  | Effect                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RUNYARD_HOST`            | Server bind address (default `127.0.0.1`).                                                                                                                                                                                                 |
| `RUNYARD_PORT`            | Server port (default `7420`); the dashboard dev proxy follows it.                                                                                                                                                                          |
| `RUNYARD_DATA_DIR`        | Database and generated key location. Defaults to `~/Library/Application Support/Runyard` on macOS and `$XDG_DATA_HOME/runyard` (`~/.local/share/runyard`) elsewhere. Created with mode `700`; an existing directory keeps its permissions. |
| `RUNYARD_SECRET_KEY`      | Base64 32-byte key (`openssl rand -base64 32`) that encrypts stored credentials.                                                                                                                                                           |
| `RUNYARD_SECRET_KEY_FILE` | File holding that key. Used when `RUNYARD_SECRET_KEY` is unset; defaults to `secret.key` in the data directory, generated with mode `600` on first start.                                                                                  |

A key file in the data directory only protects a copy of the database taken on its own, such as a
backup. To keep the two apart, pass the key through the environment or a file stored elsewhere.
Runyard refuses to start with a key that doesn't match the database, or a key file other users
can read.
