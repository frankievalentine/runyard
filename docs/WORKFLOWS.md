# Writing workflows for your runners

A pool's runners take the jobs whose `runs-on` asks for the pool's labels. Each pool's page has
**Use it in a workflow**, with the exact `runs-on` line and a file to start from. This page
explains what goes into one.

## Point a job at a pool

**GitHub.** Ask for `self-hosted` and every label you gave the pool. A runner takes the job only
when it has all of them:

```yaml
jobs:
  build:
    runs-on: [self-hosted, linux-build]
    steps:
      - uses: actions/checkout@v4
      - run: make test
```

The file goes in `.github/workflows/` in a repository the pool serves. GitHub also gives every
runner its system (`linux`, `macos` or `windows`) and architecture (`x64` or `arm64`), so
`[self-hosted, linux-build, arm64]` keeps a job off x64 machines in the same pool.

**Forgejo.** Ask for one of the pool's labels, in `.forgejo/workflows/`:

```yaml
jobs:
  build:
    runs-on: linux-build
    steps:
      - uses: actions/checkout@v4
      - run: make test
```

Whether the job runs on the machine or in a container is the pool's choice, not the
workflow's: see [Forgejo jobs](#forgejo-jobs-on-the-machine-or-in-docker).

## The labels each runner carries

| Label                     | On                             | Use it to                                              |
| ------------------------- | ------------------------------ | ------------------------------------------------------ |
| The pool's labels         | Every runner in the pool       | Ask for what a job needs, such as `linux-build`        |
| `runyard`                 | Every runner Runyard installed | Keep a job on Runyard's runners                        |
| `runyard-pool-<pool>`     | Every runner in that pool      | Pick one pool when two share labels                    |
| `runyard-runner-<runner>` | One GitHub runner              | Reach exactly one runner, as **Test this runner** does |

GitHub matches labels in any case. A label a pool promises, such as `docker`, `gpu` or `xcode-16`, is
checked on each machine, and a machine that can't honor it shows under **Needs attention**.

## What a job can use

A runner sees what's installed on its machine. Each machine's **Runner readiness** lists what's
there, and a pool's **Tools to install where they're missing** fills the gaps (see
[Runner readiness](GUIDE.md#runner-readiness)). On Windows, some tools go by other names:

| Ask for      | Linux and macOS | Windows                                 |
| ------------ | --------------- | --------------------------------------- |
| A C compiler | `cc`            | `gcc`                                   |
| Python 3     | `python3`       | `python` or `python3`                   |
| Zip archives | `zip`, `unzip`  | `7z`, or Windows' own `tar -xf` to open |
| Signing keys | `gpg`           | Git for Windows' own, for git           |

Persistent runners on Linux and macOS run as the account Runyard signs in as. On Windows they run
as `NETWORK SERVICE`, which can't see anything installed for one account only.

## Windows

- **Use PowerShell steps.** Set it once for the job:

  ```yaml
  jobs:
    build:
      runs-on: [self-hosted, windows-build]
      defaults:
        run:
          shell: powershell
  ```

  `pwsh` works too where PowerShell 7 is installed.

- **Allow local scripts.** The runner runs each step as a script file, which Windows' default
  execution policy blocks. When readiness shows **PowerShell scripts** as Restricted, run
  `Set-ExecutionPolicy RemoteSigned -Scope LocalMachine` in an administrator PowerShell.
- **Python comes from uv,** in `C:\ProgramData\Runyard\python`. That Python refuses a bare
  `pip install`, so use a virtual environment or uv:

  ```yaml
  - run: python -m venv .venv
  - run: .venv\Scripts\python -m pip install -r requirements.txt
  ```

## Persistent runners and one-job runners

A **persistent** pool's runners stay registered and take job after job. Their workspace and any
Docker data stay between jobs unless the pool's **After each job** clears them, so a build that
depends on a clean checkout should clear it, or check out with `clean: true` (the default for
`actions/checkout`).

An **on-demand** pool starts a fresh runner for each job and removes it afterwards, so nothing
carries over. It takes a little longer to start, and runs on Linux and macOS.

Either way, a runner runs whatever the workflow says with its account's access to the machine.
That's why Runyard refuses public repositories unless you allow them: anyone who can open a pull
request from a fork could run code there.

## Forgejo jobs: on the machine or in Docker

A Forgejo pool runs its jobs one of two ways, set on the pool:

- **On the machine:** steps run directly, like a GitHub runner. JavaScript actions such as
  `actions/checkout` need Node.js, which the pool installs.
- **In Docker:** each job runs in a container from the pool's image (`node:22-bookworm` unless
  you change it). Steps see the image's tools, not the machine's. The pool installs Docker.

## When a job doesn't start

**Queued jobs** lists every self-hosted job that's waiting and why: no pool serves its
repository, a label no runner has, its runners are offline or busy, or a pool isn't set up on its
machines yet. A label typo shows as a label no runner has.

## Check a runner

On GitHub, a runner's page has **Test this runner**: it runs a short workflow on exactly that
runner and shows whether it passed. The first time, it shows the file to add to your repository.
