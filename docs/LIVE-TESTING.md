# Live testing

Everything in Runyard is built and tested against fakes. This checklist runs it for real, in an
order where each round builds on the last. Each step says what to do and what should happen. When
something doesn't match, stop there and send the step number, what you saw, and the output it
asks for; that becomes a precise bug to fix before going on.

Use only disposable things: a test tailnet, a throwaway GitHub organization with **private**
repositories, and machines you can delete. Runyard installs software and registers runners on
them, which is the point.

## Round 0: the test environment

- [ ] **0.1** A separate tailnet with MagicDNS and HTTPS Certificates on (admin console, DNS).
- [ ] **0.2** A control machine on it for Runyard: your Mac works, or a small Linux VM.
- [ ] **0.3** A Proxmox LXC on the tailnet: unprivileged Debian 12, 2 CPUs, 4 GB, 20 GB disk,
      **nesting** and **keyctl** on, Tailscale's `/dev/net/tun` lines added (see the guide's
      Runner machines), Tailscale installed and logged in. Only `root` exists yet.
- [ ] **0.4** A GitHub organization for testing with one private repository (`runyard-test`)
      holding any small project, and a second private repository to spare.
- [ ] **0.5** Optional for later rounds: a Mac on the tailnet that can run runners, a Forgejo
      instance (Codeberg account or Forgejo in Docker), a Windows machine.

## Round 1: install and claim

- [ ] **1.1** On the control machine, build and install: `vp install && vp run release`, then
      `RUNYARD_BASE_URL=file://$PWD/apps/cli/dist/release sh install/install.sh`.
      Expect `runyard` in `~/.local/bin`, checked against `SHA256SUMS`.
- [ ] **1.2** Run `runyard`. Expect it to print `https://<machine>.<tailnet>.ts.net:7443` and a
      setup code. If it serves on loopback only, send the reason it prints.
- [ ] **1.3** Open the tailnet address from another device. Expect a valid certificate and the
      setup screen; enter the code and create the admin.
- [ ] **1.4** Getting started's control-machine checks: expect SSH, SSH key (Runyard's own key,
      with a fingerprint) and Tailscale HTTPS all green. Send any that aren't.
- [ ] **1.5** Stop it and run `runyard service install` (add `--dry-run` first to read it).
      Expect it to come back on its own at the same address. On Linux it asks for sudo; on
      macOS it starts at login.
- [ ] **1.6** Add a passkey under Settings ▸ Account on the tailnet address, sign out, sign back
      in with it.

## Round 2: GitHub

- [ ] **2.1** Settings ▸ Connections ▸ GitHub: create the GitHub App for the test organization.
      Expect GitHub to show the app's permissions, including **Actions: Read and write**, then
      return you to Runyard.
- [ ] **2.2** Install it on the organization with all repositories. Expect the installation and
      `runyard-test` to appear within a minute.
- [ ] **2.3** Push a workflow to `runyard-test` with `runs-on: [self-hosted, runyard-check]` and
      trigger it. Expect it under Queued jobs, saying no runner or pool serves it.

If 2.1 or 2.2 fails, send the URL you ended on and Runyard's log.

## Round 3: machine setup (the LXC)

- [ ] **3.1** Machines ▸ Add: pick the LXC from the tailnet list, leave the SSH user empty.
      Expect its page to show **Connect Runyard to …** with the first step failing.
- [ ] **3.2** Show the setup command, tick **passwordless sudo**, and run the fresh-machine
      version in `pct enter <id>` as root. Expect it to install the SSH server and sudo if
      missing, create `runyard`, and print `Done.`
- [ ] **3.3** Within a minute, expect the machine **Connected**, its SSH target now
      `runyard@<address>`, and its host key trusted (no host key step left).
- [ ] **3.4** Runner readiness: expect git, curl and tar present on Debian, the clock in sync,
      **Reaches github.com: Yes**, and zstd, jq, a C compiler and Docker listed as missing.
- [ ] **3.5** If the control machine is a Mac: Runyard's data directory has a space in its path
      (`Application Support`). 3.3 passing means OpenSSH accepted the quoted known_hosts list.

If 3.2 fails, send the script's output. If 3.3 doesn't connect, send the panel's failing step
and its message.

## Round 4: a persistent pool

- [ ] **4.1** Create a pool: the LXC with 1 slot, serving the test organization, label
      `runyard-check`, tool profiles **Essentials**, **Build tools** and **Docker**, After each
      job **Clear the workspace**.
- [ ] **4.2** Review the LXC. Expect **Install tools** (only what 3.4 found missing), then
      **Install**, then **Set cleanup**. Run it.
- [ ] **4.3** Expect every step to succeed, the runner online in GitHub with labels
      `runyard-check`, `runyard`, `runyard-pool-…` and `runyard-runner-<name>`, and readiness
      now clean. Review again: expect nothing to do.
- [ ] **4.4** The workflow from 2.3 runs on it. Expect it to pass, and afterwards the runner's
      `_work/runyard-test/runyard-test` directory on the LXC to be empty (the cleanup hook).
- [ ] **4.5** Add `.github/workflows/runyard-runner-check.yml` from the runner's **Test this
      runner** card, then run a test job with **Also run a container**. Expect **Passed** with a
      link to the run.
- [ ] **4.6** Start a long job (`sleep 300`), then edit the pool's cleanup to
      **Workspace and Docker** and review. Expect **Set cleanup** blocked as busy. After the job,
      expect it to run and restart the runner.

If an install step fails, send its output from the review. For 4.4, send the job's last step
log. For 4.5, send what the card says.

## Round 5: an on-demand pool

- [ ] **5.1** Change the pool to **On demand** (or create a second one with label
      `runyard-ondemand`), review and run. Expect the persistent runner removed and the runner
      software installed as a template.
- [ ] **5.2** Queue a job for its label. Within a minute expect a one-job runner started on the
      LXC, the job to run, the runner to deregister itself, and its directory removed.
- [ ] **5.3** Queue a job lasting longer than an SSH session: the runner must survive (the
      `runyard` account has lingering on, from 3.2).
- [ ] **5.4** Pause the pool, queue a job: expect Queued jobs to say it's paused.

For 5.2, send the pool page's Recent one-job runners entry and the machine's history.

## Round 6: taking over a hand-registered runner

- [ ] **6.1** On the LXC, register a runner by hand in another directory with GitHub's own
      instructions, label `runyard-check`, as a service.
- [ ] **6.2** On its page in Runyard: **Runs on** the LXC, then **Move into pool**. Expect
      **Waiting** until the pool's runner is online and idle, then **Ready to retire**.
- [ ] **6.3** Review and run **Retire**. Expect it deregistered on GitHub and the cleanup commands
      shown. Send what the old runner's service does afterwards (`journalctl -u actions.runner.*`).

## Round 7: webhooks

- [ ] **7.1** Settings ▸ Connections ▸ GitHub ▸ Webhooks: run the Funnel command it shows, then
      **Set webhook**. Tick **Active** and **Workflow job** in the app's settings on GitHub.
- [ ] **7.2** Queue a job. Expect it in Queued jobs within seconds, and a delivery in GitHub's
      app settings with a 2xx response.

## Round 8: an agent

- [ ] **8.1** Create a **Read and prepare** token, add it to Claude Code with the README's line.
- [ ] **8.2** Ask it why a job is waiting, then to prepare the LXC's review. Expect the right
      reason, and a link that opens the review marked with the token's name. Run it yourself.
- [ ] **8.3** Revoke the token; expect the agent's next call refused.

## Round 9: Forgejo (optional)

- [ ] **9.1** Connect it with a token (user, organization and repository: read and write). Send
      any scope Forgejo refuses.
- [ ] **9.2** A pool serving the account on the LXC, host mode. Review and run. Expect the
      forgejo-runner service active and the runner idle in Forgejo. Readiness asks for Node.js.
- [ ] **9.3** Run a job using `actions/checkout`. Then switch the pool to Docker mode and run one
      in a container.

## Round 10: a Mac runner machine (optional)

- [ ] **10.1** Turn on Remote Login, add the Mac, run the setup command as the runners' account.
- [ ] **10.2** Readiness: expect Command Line Tools, Xcode (if installed) and Homebrew detected.
      With automatic login off, expect a Needs attention item once it's in a pool.
- [ ] **10.3** A pool with **Essentials**: expect Homebrew to install what's missing, and a job
      running `jq --version` to find it (Homebrew on the runner's PATH).

## Round 11: Windows and Docker (optional)

- [ ] **11.1** Windows: turn on OpenSSH Server, run the Windows setup command from an
      administrator PowerShell, add a persistent pool, review and run. Expect a Windows service
      runner online.
- [ ] **11.2** `install.ps1` and `runyard service install` on Windows.
- [ ] **11.3** Docker: `docker/compose.yaml` with a real `TS_AUTHKEY`. Expect the dashboard on
      its tailnet address and the setup code in `docker compose logs runyard`.

## Afterwards

Revoke test tokens, delete the GitHub App and the test organization's runners, and destroy the
LXC. Then update docs/PLAN.md's Pending live verification with what passed.
