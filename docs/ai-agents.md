# AI agents

Runyard serves an [MCP](https://modelcontextprotocol.io) server at `/api/mcp`, so an agent such
as Claude Code can read your CI and prepare changes for you to run.

## Connect an agent

Create a token under **Settings ▸ Access tokens**, then, for Claude Code:

```sh
claude mcp add --scope user --transport http runyard https://<runyard>/api/mcp \
  --header "Authorization: Bearer <token>"
```

`--scope user` makes Runyard available wherever you start Claude Code; without it, only in the
folder where you ran the command. Use the dashboard's HTTPS address, so the token travels
encrypted.

## What a token can do

- **Read only:** `yard_summary`, `list_machines`, `get_machine` (health, readiness, the steps to
  connect it, recent history), `list_runners`, `list_queued_jobs` (with why each one waits),
  `list_pools`, `list_test_jobs` and `workflow_template` (a pool's
  [workflow templates](workflows.md#start-from-a-template), for an agent to fit to a repository).
  For failed CI: `list_failed_jobs` (failed, timed-out and lost jobs on Runyard's runners, from
  the last 30 days), `get_job_log` (the step that failed, from the forge) and `diagnose_job`
  (whether the machine, a flake or the code caused it, and what's wrong with the machine now).
- **Read and prepare** (admins only): also `add_machine`, `save_pool`, `prepare_review`,
  `machine_setup_command` and `start_test_job`.

Job logs come from the forge each time, as **Show log** does, so they need a GitHub App
installation that reaches the repository, or Forgejo 16 or later. Before an agent sees a log,
Runyard masks anything that looks like a token or a private key, and labels the log as the
job's own output, not instructions. A job can still print other secrets, such as passwords
without a recognizable shape, so mask secrets in your workflows as you would for anyone who can
read the job.

No tool runs a review or deletes anything. `prepare_review` returns the plan and a link to the
machine's page with that review open, for you to check and **Run**. Everything a token prepares is
recorded in the machine's history as yours, through that token.

A token never has more access than its user. It's shown once, stored hashed, can expire, and
works only on `/api/mcp`. Change its access with the menu beside **Revoke**.

## Skills for CI

Runyard publishes three agent skills that use these tools. Each tells an agent how to do one
job with your machines in mind:

- **`runyard-ci-setup`:** writes a repository's workflow from a pool's
  [templates](workflows.md#start-from-a-template), fitted to its scripts or Makefile, and opens
  a pull request.
- **`runyard-fix-ci`:** finds a failed job, decides whether the code, the machine or a flaky
  run caused it, and fixes the right one: the code on the pull request's branch, or the machine
  through a review you run.
- **`runyard-workflow-security`:** reviews workflows for the risks of self-hosted runners, such
  as fork pull requests running code on your machines, `pull_request_target`, unpinned actions
  and state left between jobs.

Install them in a repository with the [skills](https://github.com/vercel-labs/skills) CLI,
which works with Claude Code, Codex and other agents:

```sh
npx skills add frankievalentine/runyard
```

Add `--skill runyard-fix-ci` for one of them, or `-g` for every project. The skills ask
before changing anything, propose repository changes as pull requests, and never run a review:
they follow the same rules as the tools.
