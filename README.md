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
```

| Variable       | Effect                                                            |
| -------------- | ----------------------------------------------------------------- |
| `RUNYARD_HOST` | Server bind address (default `127.0.0.1`).                        |
| `RUNYARD_PORT` | Server port (default `7420`); the dashboard dev proxy follows it. |
