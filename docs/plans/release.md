# Planned: a release

Status: **scoped, to plan after live testing.** Decided with the user on 2026-10-29.

## What ships

Three ways to install the control plane, all from published builds. No Mac app, menu bar app or
installer package for now.

1. **A curl install.** `curl -fsSL <url>/install.sh | sh` (and `install.ps1` on Windows)
   downloads the binary for the machine, checks it against `SHA256SUMS`, and puts `runyard` on
   the PATH. Today the scripts need `RUNYARD_BASE_URL`; a release gives them a default.
2. **Homebrew.** A formula in a tap (`brew install <owner>/tap/runyard`), downloading the same
   release binaries. A formula rather than a cask: casks are for apps and installer packages,
   and Runyard is a command-line binary. `brew services` could run it, alongside
   `runyard service install`.
3. **Docker compose.** `docker/compose.yaml` with the Tailscale sidecar, pulling a published
   image instead of building one.

## To decide

- Where builds are published: GitHub Releases is the obvious place once the repository is
  public, with `SHA256SUMS` beside the binaries.
- How releases are built: a script run locally (CI is local for now), or GitHub Actions on a
  tag.
- Versions: a scheme, a changelog, and how an install upgrades (re-run the installer, `brew
  upgrade`, a new image tag; migrations already run on start).
- The image registry, such as `ghcr.io`, and which architectures it carries.
- Whether the macOS binary is signed and notarized. Not needed for curl or Homebrew installs.
- Making the repository public: a security contact, the social preview image, and a check that
  no test data or tokens are in the history.

The documentation audit ([docs-audit.md](docs-audit.md)) finishes before release.
