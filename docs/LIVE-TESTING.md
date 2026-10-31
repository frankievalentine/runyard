# Live testing

Everything in Runyard is built and tested against fakes. This checklist runs it for real, in an
order where each round builds on the last. Each step says what to do and what should happen. When
something doesn't match, stop there and send the step number, what you saw, and the output it
asks for; that becomes a precise bug to fix before going on.

Use only disposable things: a test tailnet, a throwaway GitHub organization with **private**
repositories, and machines you can delete. Runyard installs software and registers runners on
them, which is the point.

## Round 0: the test environment

- [x] **0.1** A separate tailnet with MagicDNS and HTTPS Certificates on (admin console, DNS).
- [x] **0.2** A control machine on it for Runyard: your Mac works, or a small Linux VM.
- [x] **0.3** A Proxmox LXC on the tailnet: unprivileged Debian 12, 2 CPUs, 4 GB, 20 GB disk,
      **nesting** and **keyctl** on, Tailscale's `/dev/net/tun` lines added (see the guide's
      Runner machines), updated (`apt update && apt full-upgrade -y`), Tailscale installed and
      logged in. Only `root` exists yet.
- [x] **0.4** A GitHub organization for testing with one private repository (`runyard-test`)
      holding any small project, and a second private repository to spare.
- [ ] **0.5** Optional for later rounds: a Mac on the tailnet that can run runners, a Forgejo
      instance (Codeberg account or Forgejo in Docker), a Windows machine.

## Round 1: install and claim

- [x] **1.1** On the control machine, build and install: `vp install && vp run release`, then
      `RUNYARD_BASE_URL=file://$PWD/apps/cli/dist/release sh install/install.sh`.
      Expect `runyard` in `~/.local/bin`, checked against `SHA256SUMS`.
- [x] **1.2** Run `runyard`. Expect it to print `https://<machine>.<tailnet>.ts.net:7443` and a
      setup code. If it serves on loopback only, send the reason it prints.
- [x] **1.3** Open the tailnet address from another device. Expect a valid certificate and the
      setup screen; enter the code and create the admin.
- [x] **1.4** Settings ▸ This machine: expect the OpenSSH client, SSH key (Runyard's own, with a
      fingerprint) and Tailscale HTTPS all green; Background service turns green after 1.5. Send
      any others that aren't. (The overview only mentions these when one needs attention.)
- [x] **1.5** Stop it and run `runyard service install` (add `--dry-run` first to read it).
      Expect it to come back on its own at the same address. On Linux it asks for sudo; on
      macOS it starts at login.
- [x] **1.6** On the tailnet address you're signed in by your Tailscale login (the cog's menu
      says "via Tailscale"). **Sign out**: expect the sign-in screen with **Continue as
      <your login>**, and another browser still signed in. Continue: expect to be back in. To
      test passwords and passkeys, open `http://localhost:7420` on the Mac itself (passkeys need
      a host name, not 127.0.0.1), sign in with the password, add a passkey under
      Settings ▸ Account, sign out and sign back in with it. (Passkeys need HTTPS or localhost.)

## Round 2: GitHub

- [x] **2.1** Settings ▸ Connections ▸ GitHub: create the GitHub App for the test organization.
      Expect GitHub to show the app's permissions, including **Actions: Read and write**, then
      return you to Runyard.
- [x] **2.2** Install it on the organization with all repositories. Expect the installation and
      `runyard-test` to appear within a minute.
- [x] **2.3** Push a workflow to `runyard-test` with `runs-on: [self-hosted, runyard-check]` and
      trigger it. Expect it under Queued jobs, saying no runner or pool serves it.

If 2.1 or 2.2 fails, send the URL you ended on and Runyard's log.

## Round 3: machine setup (the LXC)

- [x] **3.1** Machines ▸ Add: pick the LXC from the tailnet list, leave the SSH user empty.
      Expect its page to show **Connect Runyard to …** with the first step failing.
- [x] **3.2** Show the setup command, tick **passwordless sudo**, and run the fresh-machine
      version in `pct enter <id>` as root. Expect it to install the SSH server and sudo if
      missing, create `runyard`, and print `Done.`
- [x] **3.3** Within a minute, expect the machine **Connected**, its SSH target now
      `runyard@<address>`, and its host key trusted (no host key step left).
- [x] **3.4** Runner readiness: expect git, curl and tar present on Debian, the clock in sync,
      **Reaches github.com: Yes**, and zstd, jq, a C compiler and Docker listed as missing.
- [x] **3.5** If the control machine is a Mac: Runyard's data directory has a space in its path
      (`Application Support`). 3.3 passing means OpenSSH accepted the quoted known_hosts list.

If 3.2 fails, send the script's output. If 3.3 doesn't connect, send the panel's failing step
and its message.

## Round 4: a persistent pool

- [x] **4.1** Pools ▸ +: pick the queued `runyard-check` job from 2.3 (or the repository and
      label `runyard-check` by hand), then the LXC. On the summary, expect one persistent runner,
      Essentials and Build tools, Clear the workspace; add **Docker** under Tools.
- [x] **4.2** **Create and review**: expect the pool page with the LXC's review already shown:
      **Install tools** (only what 3.4 found missing), **Install**, **Set cleanup**. Run it.
- [x] **4.3** Expect every step to succeed, the runner online in GitHub with labels
      `runyard-check`, `runyard`, `runyard-pool-…` and `runyard-runner-<name>`, and readiness
      now clean. Review again: expect nothing to do.
- [x] **4.4** The workflow from 2.3 runs on it. Expect it to pass, and afterwards the runner's
      `_work/runyard-test/runyard-test` directory on the LXC to be empty (the cleanup hook).
- [x] **4.5** Add `.github/workflows/runyard-runner-check.yml` from the runner's **Test this
      runner** card, then run a test job with **Also run a container**. Expect **Passed** with a
      link to the run.
- [x] **4.6** Start a long job (`sleep 300`), then edit the pool's cleanup to
      **Workspace and Docker** and review. Expect **Set cleanup** blocked as busy. After the job,
      expect it to run and restart the runner.

If an install step fails, send its output from the review. For 4.4, send the job's last step
log. For 4.5, send what the card says.

## Round 5: an on-demand pool

- [x] **5.1** Change the pool to **On demand** (or create a second one with label
      `runyard-ondemand`), review and run. Expect the persistent runner removed and the runner
      software installed as a template.
- [x] **5.2** Queue a job for its label. Within a minute expect a one-job runner started on the
      LXC, the job to run, the runner to deregister itself, and its directory removed.
- [x] **5.3** Queue a job lasting longer than an SSH session: the runner must survive (the
      `runyard` account has lingering on, from 3.2).
- [x] **5.4** Pause the pool, queue a job: expect Queued jobs to say it's paused.

For 5.2, send the pool page's One-job runners entry and the machine's history.

## Round 6: taking over a hand-registered runner

- [x] **6.1** On the LXC, register a runner by hand in another directory with GitHub's own
      instructions, label `runyard-check`, as a service.
- [x] **6.2** Expect Needs attention to list it as not managed by Runyard. On its page, follow
      **Take over this runner**: choose the LXC, then **Start the move** into `runyard-check`.
      Expect step 3 **Waiting** until the pool's runner is online and idle, then
      **Ready to retire**, and the LXC showing "1 change" in the sidebar.
- [x] **6.3** **Review 1 change** on the LXC and run **Retire**. Expect it deregistered on GitHub
      and the cleanup commands shown. Send what the old runner's service does afterwards
      (`sudo journalctl -u 'actions.runner.*'`).

## Round 7: webhooks

- [x] **7.1** Settings ▸ Connections ▸ GitHub ▸ Webhooks: run the Funnel command it shows, then
      **Set webhook**. Tick **Active** on the app's General page on GitHub (Workflow job is
      already subscribed).
- [x] **7.2** Queue a job. Expect it in Queued jobs within seconds, and a delivery in GitHub's
      app settings with a 2xx response.

## Round 8: an agent

- [x] **8.1** Create a **Read and prepare** token, add it to Claude Code with the README's line.
- [x] **8.2** Ask it why a job is waiting, then to prepare the LXC's review. Expect the right
      reason, and a link that opens the review marked with the token's name. Run it yourself.
- [x] **8.3** Revoke the token; expect the agent's next call refused.

## Round 8b: run history

- [x] **8b.1** After rebuilding, expect each machine with GitHub runners to show **Set job hooks
      on …** as a change waiting. Review and run it on each (it restarts idle runners).
- [x] **8b.2** With webhooks on, run `check`. Expect it on the runner's, the pool's and the LXC's
      **Jobs** within seconds, **Running** then **Passed** with how long it took, and **Show log**
      showing its output.
- [x] **8b.3** Without webhooks: untick **Active** in the app's settings, run `mac`. Expect it in
      the VM's Jobs within about a minute of finishing, with its result (from the runner's hooks
      and one GitHub read). Tick Active again.
- [x] **8b.4** Run `ondemand`. Expect it in `runyard-ondemand`'s Jobs, on the LXC.
- [ ] **8b.5** _Skipped in the 2026-10-29 run._ Optional: start `long`, then stop its runner on the LXC
      (`sudo systemctl stop 'actions.runner.*runyard-check*'`). Once GitHub fails the job (it can
      take several minutes) and five more pass, expect **Runner lost** and a Needs attention item
      on the LXC. Start the service again.

## Round 9: Forgejo (optional)

- [x] **9.1** Connect it with a token (user, organization and repository: read and write). Send
      any scope Forgejo refuses.
- [x] **9.2** A pool serving the account on the LXC, host mode. Review and run. Expect the
      forgejo-runner service active and the runner idle in Forgejo. Readiness asks for Node.js,
      and the review installs it.
- [x] **9.3** Run a job using `actions/checkout`. Then switch the pool to Docker mode and run one
      in a container.
- [x] **9.4** Run history:
      the runner from 9.2 shows **Record jobs** as a change waiting; run it.
      Then run the workflow again: expect the job under **Jobs** on the LXC's page and the pool's,
      with its result within a minute or two and **Open on Forgejo** linking to the run.
- [ ] **9.5** On Forgejo 17: a job's **Show log** shows its output.
- [x] **9.6** Repository scopes: a new pool lists the account's repositories under it; choosing
      the account greys them out. A pool serving one private repository registers its runner on
      that repository in Forgejo (Settings ▸ Actions ▸ Runners of the repository), and a public
      repository elsewhere on the account doesn't hold it up. Its service is named after its
      directory (`runyard-forgejo-<pool>-forgejo-<owner>-<repo>-01`).

## Round 10: a Mac runner machine (optional)

- [x] **10.1** Turn on Remote Login, add the Mac, run the setup command as the runners' account.
- [ ] **10.2** _Detection passed live (on a macOS 27 VM); the automatic login warning is covered by tests only._ Readiness: expect Command Line Tools, Xcode (if installed) and Homebrew detected.
      With automatic login off, expect a Needs attention item once it's in a pool.
- [x] **10.3** A pool with **Essentials**: expect Homebrew to install what's missing, and a job
      running `jq --version` to find it (Homebrew on the runner's PATH).

## Round 11: Windows and Docker (optional)

- [ ] **11.1** Windows: turn on OpenSSH Server, run the Windows setup command from an
      administrator PowerShell, add a persistent pool, review and run. Expect a Windows service
      runner online.
- [ ] **11.2** `install.ps1` and `runyard service install` on Windows.
- [ ] **11.3** Docker: `docker/compose.yaml` with a real `TS_AUTHKEY`. Expect the dashboard on
      its tailnet address and the setup code in `docker compose logs runyard`.
- [ ] **11.4** Windows tools: a pool with **Essentials** and **Build tools** on the Windows machine.
      Expect its review to show "Install 7-Zip, xz, zstd, gpg, gcc, make with winget, and Python 3.13 with uv"
      (less what's there), then the runner install. Run it; expect Readiness to show them all
      found, and a job running `7z`, `xz --version`, `zstd --version`, `jq --version`,
      `gpg --version`, `gcc --version`, `make --version` and `python --version` to pass.
- [ ] **11.5** Update PATH: with the runner idle, add a folder to the machine PATH by hand. Expect
      the next review to show **Update PATH** for the runner, and a job after running it to see
      the folder in `$env:Path`.
- [ ] **11.6** Windows run history and cleanup: set the pool's **After each job** to clear the
      workspace, and expect its review to show **Set job hooks**. Run it, then a job. Expect the job
      under **Jobs** on the Windows machine's page with its result, and a "Runyard: cleared …" line
      at the end of the job's log. Readiness shows **PowerShell scripts** as RemoteSigned.

## Round 11b: boat.dev (optional)

Needs a boat.dev account with CI set up for a test repository (its GitHub app installed there).

- [ ] **11b.1** Push a workflow with `runs-on: boat` and run it. Expect it under Queued jobs as
      **Starts on boat.dev**, then on the sidebar's **boat.dev** row while it runs, and never
      offered to a pool.
- [ ] **11b.2** On the boat.dev page, connect with a key limited to `sandbox.read` and
      `account.read`. Expect the running job's VM size and cost so far, and your plan's limits.
      Send what a running job shows; the cost fields and VM names are only known from boat's docs.
- [ ] **11b.3** Start a VM outside CI (a sandbox from boat's dashboard or CLI) and leave it.
      Expect a Needs attention item for a VM running outside CI, with its cost. Stop it there.
- [ ] **11b.4** Whether boat's runners appear in GitHub's runner list: send what Unassigned
      runners shows while a boat job runs. **Disconnect**, and expect the key forgotten.

## Round 12: taking it all down

This is also a test: follow the guide's Uninstalling order and check each step.

- [ ] **12.1** Try **Remove** on the LXC: expect **Decommission first**, naming its runners and
      runner software. Decommission it, review and run: expect every runner deregistered on
      GitHub and the runner software deleted. Then **Remove** works.
- [ ] **12.2** Run the teardown command from the Remove dialog on the LXC as root with
      `--prepared`: expect the `runyard` account, its sudoers file and home gone, and SSH as
      `runyard` refused afterwards.
- [ ] **12.3** Remove the GitHub App in Runyard, then delete it on GitHub. Revoke the test
      tokens.
- [ ] **12.4** `runyard uninstall --dry-run --purge`, read it, then without `--dry-run`. Expect
      the LaunchAgent gone, `runyard` gone from `~/.local/bin` and the data directory deleted.

Then destroy the LXC and update docs/PLAN.md's Pending live verification with what passed.
