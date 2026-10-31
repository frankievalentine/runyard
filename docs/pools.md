# Pools

A **pool** is runner capacity: the repositories its runners serve, the labels they carry, and
the machines they run on, with how many each. You describe the pool; Runyard works out the
runners and installs them through each machine's review.

## Create a pool

Click **+** beside **Pools** in the sidebar. The form has three steps:

1. **What it's for:** a suggestion from what Runyard sees (queued jobs no runner can take,
   connected machines not yet in a pool), or the repositories and labels you choose.
2. **Where it runs:** your connected machines, each saying what its review would install. The
   form suggests labels every chosen machine can carry, such as `docker` or `gpu`.
3. **Check and create:** a summary with defaults you can **Change**: one persistent runner per
   machine, Essentials and Build tools installed where missing, and the workspace cleared after
   each job.

An organization gets one runner per slot. A personal GitHub account's repositories each get
their own runner, because GitHub can't share a personal account's runner across repositories.

Once a pool exists, its page shows **Use it in a workflow**, the `runs-on` line that sends jobs
to it. See [Writing workflows](workflows.md).

## Review and run

Saving a pool changes nothing on your machines. **Create and review** opens the pool with each
machine's review ready: every step it will take there, and **Run**. Run checks the machine and
the forge again first, and does nothing if anything changed since the review. Reviews work once
and expire after 15 minutes.

When a machine has changes waiting (a runner to install or remove, tools to install, labels or
hooks that changed, a runner to retire), it says so in the sidebar ("2 changes"), under **Needs
attention**, and on its button: **Review 2 changes**. The review reads the machine again and may
find more, such as a runner someone changed by hand.

Runners live under `~/runyard-runners` (`C:\ProgramData\Runyard\runners` on Windows): a
LaunchAgent on a Mac, a systemd service on Linux, a Windows service on Windows.

## Persistent or on demand

A **Persistent** pool's runners stay registered and take job after job. Each slot is one
runner. They start jobs fastest and keep caches warm, but what one job leaves behind, the next
one sees, unless the pool clears it (see [After each job](#after-each-job)).

An **On demand** pool keeps no runners registered. Its review installs the runner software once
per machine. Then, when a job is queued that no idle runner can take and the pool serves its
repository and has its labels, Runyard:

1. registers a single-use runner for it at that moment;
2. starts it in its own folder;
3. lets it take one job and deregister itself, then deletes the folder.

A one-job runner takes whichever matching job the forge hands it, and can end without running
one. A job still queued after its runner ended gets another, up to three in all, and a runner that
failed to start is retried after 10 minutes. After three, **Queued jobs** says so, with **Try
again**. Slots cap how many run at once per machine, and **Pause** stops new ones.

On-demand pools run on Linux and macOS.

## Tools

Under **Tools**, a pool can install what its jobs commonly need, where a machine's last check
found it missing:

- **Essentials:** git, curl, tar, unzip, zip, xz, zstd, jq and gpg.
- **Build tools:** a C compiler, make and Python 3.
- **Docker:** Docker Engine, with the runner's account able to use it. Linux only.

Each machine's review then shows an **Install tools** step for just what's missing, before the
runners. A pool also installs what its own runners need, listed as **Always included**: Node.js
for Forgejo jobs on the machine, Docker for Forgejo jobs in Docker.

| System  | Installs with                                      | Left to you                                                  |
| ------- | -------------------------------------------------- | ------------------------------------------------------------ |
| Linux   | apt, dnf, zypper or pacman, with the review's sudo |                                                              |
| macOS   | Homebrew, which must already be installed          | The Command Line Tools (`xcode-select --install`) and Docker |
| Windows | winget, for every account                          | Docker                                                       |

Runyard puts Homebrew's folders on the PATH its Mac runners start with, so jobs find what it
installs.

### On Windows

Windows gets its own tools in place of some Unix ones, and leaves gpg out: Windows jobs have no
apt keys to import, and Git for Windows has its own gpg for signing.

| Tool         | Windows gets                                            | Command in jobs                  |
| ------------ | ------------------------------------------------------- | -------------------------------- |
| git          | Git for Windows                                         | `git`                            |
| curl, tar    | Windows' own                                            | `curl`, `tar`                    |
| unzip, zip   | 7-Zip                                                   | `7z`, or `tar -xf` to open a zip |
| xz, zstd, jq | The official builds                                     | `xz`, `zstd`, `jq`               |
| C compiler   | GCC from WinLibs, a few hundred MB                      | `gcc`                            |
| make         | GNU make from ezwinports                                | `make`                           |
| Python 3     | Python 3.13 from uv, in `C:\ProgramData\Runyard\python` | `python` or `python3`            |

Python from uv sits beside any Python an account already has and doesn't change it. Jobs can't
`pip install` into it directly; use a virtual environment or uv (see
[Writing workflows](workflows.md#windows)).

A Windows runner reads its PATH from the `.env` file in its folder when it starts. When the
machine's PATH changes, after a tool install or a change of your own, the runner's review shows
**Update PATH**, which rewrites that file and restarts the runner once it's idle.

## After each job

Persistent runners keep their workspace and Docker data between jobs, which keeps builds warm
but lets one job affect the next. **After each job** sets what a pool's GitHub runners clear:

- **Keep everything:** nothing.
- **Clear the workspace:** the job's checkout and build output.
- **Workspace and Docker:** also stopped containers, dangling images, unused networks and
  anonymous volumes. Linux and macOS only.

It works through the runner's job hooks, the same ones that record its jobs. The review's **Set
job hooks** step writes them into the runner's folder and restarts the runner while it's idle.
Cleanup deletes only inside the job's workspace and never fails a job. Forgejo runners have no
job hooks, and one-job runners start clean anyway.

## Jobs

Each machine, persistent pool and runner page has **Jobs**: the last 7 days' counts ("41 passed
· 2 failed") and the newest jobs with their result, duration, repository and runner, a link to
the run, and **Show log**, which fetches the job's log from the forge when you open it. The
overview's machine table counts each machine's jobs, with failures in red. Jobs are kept 30
days.

A job that failed its own steps doesn't flag the machine, since that's usually the code. A job
whose runner said it started but never finished, after the forge finished it, shows **Runner
lost** and raises **Needs attention** on the machine: the runner or the machine stopped mid-job.

An on-demand pool lists its **One-job runners** instead, each with its job's result, **Runner
log** (from the machine; it explains a job that was lost) and **Job log** (from the forge). A
machine keeps its last 20 runner logs, for up to 7 days.

With GitHub webhooks, jobs appear within seconds; without them, within a minute or two. Runners
set up before Runyard recorded jobs show **Set job hooks** (GitHub) or **Record jobs** (Forgejo)
as a change waiting; review and run it.

**Forgejo** jobs need Forgejo 15 or later. **Show log** works on Forgejo 16 and later; on 15,
jobs link to their run with **Open on Forgejo**. forgejo-runner doesn't log when a job ends, so
Forgejo jobs are never marked **Runner lost**.

## Queued jobs

**Queued jobs** lists self-hosted jobs waiting for a runner. Each one no runner can take says
why: no runner or pool serves its repository, labels a runner or pool lacks, the matching runners
are offline or busy, an on-demand pool is paused or not installed yet, or a pool's runners aren't
installed yet.

## Test this runner

A GitHub runner Runyard installed has **Test this runner** on its page. Pick a repository it
serves, and Runyard starts a short workflow on exactly that runner: it prints the runner's
tools, compiles and runs a small C program, and can run a container. The page shows whether it
passed, with a link to the run.

The workflow lives in your repository. The first time, Runyard shows the file to add at
`.github/workflows/runyard-runner-check.yml`; it never writes to your repositories. Starting it
needs the GitHub App's **Actions: Read and write** permission. An app created before Runyard
asked for it needs the permission changed in its settings on GitHub, and the change accepted on
each installation.
