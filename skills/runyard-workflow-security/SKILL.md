---
name: runyard-workflow-security
description: Review a repository's GitHub Actions or Forgejo Actions workflows for the risks of running them on self-hosted runners managed by Runyard, such as fork pull requests running code on the user's machines, pull_request_target, untrusted input in shell, secrets and write permissions, unpinned actions, state left between jobs, and runs-on labels no pool serves. Reports findings with a severity and a rewrite, and offers a pull request with the fixes.
---

# Review workflows for self-hosted runners

On a self-hosted runner, a workflow runs on the user's own machine, with the runner account's
access to it. Whoever can make a workflow run can run code there. This skill reads the
repository's workflows and reports what puts the machines or the repository's secrets at risk.

Runyard's MCP tools make it sharper (which pools exist, what they serve, whether runners are
persistent); without them, review the files alone and say that the pool checks were skipped.

## 1. Gather

- Every file in `.github/workflows/` (GitHub) and `.forgejo/workflows/` (Forgejo), and any
  local actions they use (`uses: ./…`).
- Whether the repository is public (the forge's page, or `gh repo view --json visibility`).
- With Runyard: `list_pools`, for each pool's labels, what it serves, and whether it's
  persistent or on demand.

## 2. Check each workflow

The question for each: can someone outside the repository's writers make this run code on the
user's machines, or reach its secrets or a write token? Report each finding with its severity,
the file and line, why it matters, and the rewrite.

**Critical**

- **Fork pull requests on self-hosted runners.** A public repository whose workflows run on
  `pull_request` with `runs-on` a pool lets anyone run code on the machine by opening a pull
  request. Runyard refuses public repositories unless an admin allowed them: if this one is
  public and served, say so plainly. Fix: run fork pull requests on hosted runners, or require
  approval for outside contributors' workflows in the forge's settings.
- **`pull_request_target` or `workflow_run` that checks out or runs the pull request's code**
  (`ref: ${{ github.event.pull_request.head.sha }}`, or building artifacts from the triggering
  run). These run with secrets and a write token. Fix: use `pull_request` for anything that runs
  the code; keep `pull_request_target` for labelling and commenting, with no checkout of the
  head.
- **Untrusted input in `run:`.** `${{ github.event.pull_request.title }}`, `.body`,
  `.head.ref`, `github.head_ref`, issue and comment text, commit messages, and outputs of steps
  that read them, expanded straight into shell. Fix: pass them through `env:` and quote the
  variable.

**High**

- **Secrets or write permissions in jobs that run pull request code.** On GitHub, a missing
  top-level `permissions:` gives the repository's default, often write. Fix:
  `permissions: contents: read` at the top, more per job only where needed. On Forgejo,
  `permissions` is ignored (with a warning in the log): the token's access is set in the
  repository's settings, so check there instead.
- **Unpinned actions.** `uses: owner/action@v4` or `@main` follows whatever the tag points to.
  Fix: pin the commit SHA, with the version in a comment (`@<sha> # v4.4.0`). Prefer actions
  from their publisher's own organization.
- **Persistent runners keeping state.** On a persistent pool, the workspace, caches, Docker
  images and anything a job wrote outside the workspace stay for the next job, from any
  repository the pool serves. Flag jobs that write credentials to disk (`docker login`, cloud
  CLIs, `~/.npmrc`), and `actions/checkout` without `persist-credentials: false`. Fix: clear
  them in a final `if: always()` step, or use an on-demand pool, which starts fresh each job.

**Medium**

- **`runs-on` labels no pool serves** (compare with `list_pools`): the job waits forever.
  Misspelled labels look the same. Fix: the pool's labels, as Runyard's pool page shows them.
- **Shared pools across trust levels:** a pool serving both a public repository and private
  ones lets a public job leave something for a private one. Fix: separate pools.
- **No `timeout-minutes`:** a hung job holds the machine for six hours on GitHub. Fix: a limit
  per job.
- **No `concurrency`:** superseded runs keep the machine busy. Fix: a group per workflow and
  ref, with `cancel-in-progress: true`.

## 3. Report and offer the fixes

Report findings by severity, critical first, each with its rewrite. Say what you didn't check
(settings only the forge shows, such as approval for outside contributors).

Ask before changing anything. If the user wants the fixes, make them on a new branch and open
a pull request listing each finding it fixes. Settings that live on the forge or in Runyard
(approvals, pool membership, the Forgejo token's access) are for the user to change: say where.
