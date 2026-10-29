# Planned: run history

Status: **agreed, not started.** Decided with the user on 2026-10-29 during live testing.

## Why

The dashboard shows queued jobs, but nothing about finished ones: how many jobs a machine, pool
or runner has run, and which failed. Runyard records no finished jobs today.

## What it shows

- **Machine page:** a **Jobs** section with the last 7 days ("41 passed · 2 failed · 1
  cancelled") and recent jobs: job, repository, runner, result, duration, when, a link to the
  run. Filter to failures.
- **Runner and pool pages:** the same, narrowed to them.
- **Overview:** each machine's 7-day count; failures in the last day in red, linking to them.
- **Test runs** from the Test this runner card appear too, marked as tests.

**Machine problems are kept apart from job failures.** A job that failed its steps is counted
but doesn't flag the machine (it's usually the code). A job that started and never finished
(the runner was lost, the machine went offline) or was cancelled because its runner went away
is a machine problem and raises a Needs attention item on the machine.

## Job logs

Each job in the list opens its log in the same terminal panel the reviews use. Runyard doesn't
store logs: it fetches one when it's opened (`GET /repos/{repo}/actions/jobs/{job_id}/logs`, one
request, which answers with a short-lived download link), shows it, and keeps nothing.
Forgejo's equivalent where its API offers one. Logs are only as available as GitHub keeps them
(90 days by default), and redact nothing beyond what GitHub already masks, so viewing them is
limited to signed-in users, like the rest of the dashboard.

## Where the data comes from

Webhooks are not required. Set up, they make it instant; without them, the machine and a few
GitHub requests fill it in.

1. **Webhooks, when set up:** `workflow_job` events (queued, in_progress, completed) carry the
   job, its runner and the conclusion. Instant, no API requests.
2. **Otherwise, the machine:** Runyard's runners get a job-started hook beside the existing
   job-completed hook. Both append a line (repository, workflow, job, run id, times) to a small
   log in the runner's directory, outside its workspace. Runyard reads new lines during its
   regular minute check over SSH. This covers one-job runners, which are deleted afterwards
   (the log lives outside the runner's own directory for them).
3. **The result:** a hook isn't told the job's conclusion. For each job recorded without one,
   Runyard asks GitHub once (`GET /repos/{repo}/actions/runs/{run_id}/jobs`), throttled by the
   request budget. Fallback: the runner's diagnostic log line ("Job … completed with result:
   …"); failing that, "Finished (result unknown)".
4. **Forgejo:** no runner hooks; its API's finished tasks instead, polled for repositories with
   CI.

Records from all sources merge on (forge, repository, job id).

## Storage

A `jobs` table: forge, scope, repository, workflow, job name, job id, run id, runner name,
machine, pool, started and finished times, conclusion, source, test flag. Kept 30 days.

## Notes for building

- The hook change rewrites each runner's hook settings, so it goes through the review like the
  cleanup setting (a runner restart while idle).
- Faked in tests: webhook payloads, the hook log read over SSH, and GitHub's jobs endpoint.
- Live testing gets a round for it (with and without webhooks).
