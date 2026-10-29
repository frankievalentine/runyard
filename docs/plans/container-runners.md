# Planned: container runners ("Use this machine for CI")

Status: **agreed, not started.** Decided with the user on 2026-10-28, to build after live
testing has moved along. Everything below was agreed; open points are marked as such.

## Why

Users want to run CI on Runyard's own machine (the control plane) too. Runners under Runyard's
own account would let any job read Runyard's data directory: the database, the secret key that
decrypts forge credentials, and Runyard's SSH key, which signs in to every other machine. A
separate macOS account runs into LaunchAgents only running while their account is logged in.
A fresh container per job avoids both: nothing from the host is mounted, and no macOS service
is involved.

## The user's setup

1. **Machines ▸ Add ▸ Use this machine for CI.** Runyard checks its own machine's Docker
   directly (no SSH, no setup command): the engine (OrbStack, Docker Desktop, colima, Docker
   Engine), architecture, and the CPU and memory Docker can use.
2. If Docker is missing or stopped, show the easiest one-line install for the OS, with
   **Check again**:
   - Mac: `brew install --cask orbstack`, then open OrbStack once (it starts at login); a link to
     OrbStack's download without Homebrew.
   - Linux: `curl -fsSL https://get.docker.com | sudo sh`, then
     `sudo usermod -aG docker $USER` for Runyard's account.
     Runyard doesn't install Docker on its own machine itself.
3. It adds **This machine** to Machines (readiness: Docker's state, free disk, containers
   running) and offers a filled-in pool, **Containers on this machine**.
4. The review has one step, pulling the image. Run it and the pool is live.

## Design

### 1. "This machine"

- A new machine connection, **local**, only for Runyard's own machine: the existing read-only
  health and readiness scripts run directly as Runyard's account (`bash -s` locally instead of
  over SSH). Everything else keeps using SSH.
- Readiness adds Docker facts: whether it answers, the engine (`docker info`'s
  `OperatingSystem`), `NCPU`, `MemTotal`, architecture, and Docker's free disk.

### 2. Container pools

- A third pool mode, **Containers**, beside Persistent and On demand:
  - **image**: `ghcr.io/actions/actions-runner`, pinned to a version, overridable per pool (a
    pool can name an image built on it, for more tools; tool profiles don't apply);
  - **jobs at once**: the pool's slots;
  - **per-job CPU and memory**: automatic by default, Docker's CPU and memory divided by the jobs
    at once, never below 1 GB per job (the form says to lower the jobs at once instead);
    overridable per pool;
  - **maximum job time**: 6 hours (GitHub's own limit);
  - **Docker inside jobs**: off by default (section 3).
- **Review**: pulls the image if it's missing (so the first job doesn't wait), and removes the
  old Runyard image after a version change. Nothing else is installed.
- **Dispatch**: reuses the on-demand dispatcher. For a queued job matching the pool's labels,
  mint a single-use registration (`generate-jitconfig`) and run
  `docker run -d --rm` with the CPU and memory limits, labels `runyard.pool` and
  `runyard.job`, and a dedicated `runyard` network. The registration reaches the container as
  `ACTIONS_RUNNER_INPUT_JITCONFIG` through the `docker` command's own environment
  (`-e ACTIONS_RUNNER_INPUT_JITCONFIG` without a value), never on a command line.
- **Cleanup**, so containers don't use up the machine:
  - `--rm`: each container is deleted as soon as its job ends;
  - a sweep every minute removes Runyard-labeled containers that are stopped, orphaned by a
    Runyard or Docker restart, or past the maximum job time; the dispatch ends done, failed or
    timed out;
  - new containers wait while Docker's free disk is below 10%.
- **Isolation**: never mount host folders or the Docker socket; jobs run as the image's own
  non-root user.
- **Labels** in the preset: `self-hosted`, `linux`, the architecture (e.g. `arm64`) and
  `runyard-container`.

### 3. Docker inside jobs (opt-in)

- Off by default. Opting in gives each job a privileged `docker:dind` container beside its
  runner container on a private per-job network, with `DOCKER_HOST` pointing at it (the pattern
  GitHub's Actions Runner Controller uses). The runner container itself stays unprivileged.
  Marked as weaker isolation on the pool page. Both containers are removed together.
- Mounting the host's Docker socket is refused: it hands jobs the whole machine.

### 4. Dashboard and docs

- Machines ▸ Add: **Use this machine for CI**.
- Pool form: the **Containers on this machine** preset. Pool page: running containers with
  their job, how long they've run and their limits.
- Docs: a README line; a guide section (setup, limits, Docker-in-Docker, Linux jobs only, so
  Xcode still needs a real Mac); a live testing round.

## Limits accepted

- Linux jobs only: containers on a Mac are Linux (arm64 natively on Apple silicon; x64 images
  run emulated and slowly). macOS jobs still need a real Mac runner, or macOS VMs (a separate,
  much larger project).
- GitHub first. Forgejo container pools later.
- A Windows control-plane machine isn't covered yet.

## Later step (agreed)

The same container pools on other machines over SSH: any machine whose readiness shows a usable
Docker.

## Build order

Four commits, each with `vp run ci` passing:

1. "This machine" (local connection) and Docker readiness, with the install hints.
2. Container pools: the mode, dispatcher, cleanup sweep, limits and the review's image pull.
3. Docker-in-Docker opt-in.
4. The dashboard preset, pool page containers list, and docs.

Testing: Docker faked in the command runner for the dispatcher, sweep, limits and review tests;
then one real end-to-end run on a machine with OrbStack against a throwaway GitHub App
installation, **only with the user's approval at that time**.

## Not decided yet

- The pinned runner image version (pick the current one when building).
- Whether Runyard should show estimated costs or warnings when the jobs at once would exceed
  what Docker has.
