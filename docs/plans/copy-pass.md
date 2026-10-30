# Planned: the rest of the dashboard copy pass

The 2026-10-30 copy pass (with the better-writing skill) finished the machine pages, the text
core produces for them (diagnostics, readiness, SSH errors, access steps), and the bugs it found.
These areas are left. The approach agreed for all of them:

- Cut explanations of how Runyard works; say what happens and what to do. Note each cut in
  [docs-audit.md](docs-audit.md) under "Explanations moved out of the dashboard".
- Say each thing once: the read-only promise, the boat.dev pitch, consequences repeated on a
  card and its field.
- Drop subtitles and empty-state bodies that restate their heading.
- Keep consequence and security copy (removals, revocation, the host key warning, public
  repositories), tightened only.
- "Runyard host" for the control plane's own machine; "machine" only for CI machines.

## Pools, queue, runners, jobs, boat.dev

- `queue.tsx`: the footnote about matching and API limits goes to the docs; "Recently started"
  becomes "Started in the last 30 minutes" without its paragraph; the incomplete-list warning
  halves.
- `boat.tsx`: one-line subtitle; costs and idle-VM notes trimmed; "Disconnect boat.dev".
- `Jobs.tsx`: lost-job note to "The runner stopped mid-job. Check the machine, not the
  workflow."; "Fetching it from GitHub" to "Loading job log".
- `runners.$key.tsx`: busy-without-details and the footers to one line each; "Connected to
  GitHub", "Reported by GitHub" and the GitHub panel title name the runner's forge.
- `TestJob.tsx`: one-line intro; the repository select needs a label.
- `PoolForm.tsx`: mode descriptions without "slot"; cleanup and scope hints shortened; name
  rules shown before the mistake; "Change"/"Close" on summary rows, "Done" only to finish;
  headings as noun phrases; links name their destination, not a menu path.
- `pools.$id.tsx`, `pools.new.tsx`: cleanup and tools as one line; "run each machine's changes"
  where running, not reviewing, removes runners; one "Public repositories" section when a pool
  serves both forges.
- Terms: "one-job runner" for the runners, "On demand" only for the pool mode; one phrase for a
  machine's review; "Show/Hide runner log", "Show/Hide job log".

## Settings, sign-in, overview, shell

- `Webhooks.tsx`: the densest block. One-line intro; Funnel steps to one instruction and a link;
  the GitHub App steps without "GitHub's API can't do this".
- `settings.github.tsx`, `settings.forgejo.tsx`: the permissions list and token-scope rationale
  to the docs; "Personal account" / "Organization" options; one term for user scopes.
- `settings.connections.tsx`, `SetupChecklist.tsx`, `Sidebar.tsx`: one boat.dev line; "Connect"
  on all three cards; "This machine" to "Runyard host"; one name for Getting started; step titles
  match their buttons.
- `AccessTokens.tsx`: the access guarantee once, on the option; "Read-only"; one create verb.
- `settings.account.tsx`, `settings.users.tsx`, `setup.tsx`, `login.tsx`: duplicated sign-out
  consequence once; shorter field hints; "Remove user", "Remove app", "Remove connection" on
  confirms; Add user says what it needs before it's disabled.
- `index.tsx`, `_app.tsx`: shorter stat captions; the update banner and demo banner shortened
  (the demo banner's reassurance is the part cut off on phones).
- Pluralization: `pool-suggestions.ts` builds sentences from fragments.

## Core text not yet done

- `pools/waiting.ts`: the five "Pool X would take it, but ..." lines lose the preamble; the Try
  again sentence goes (the button is right there). `tests/waiting.test.ts` asserts nearly every
  reason exactly.
- `pools/plan.ts`: reasons in one descriptive mood ("Downloads", "Deregisters"), sentence case,
  no "for now"; the retire reasons shortened, keeping that the directory is kept.
- `machines/issues.ts`: lost-job, unmanaged-runner and Mac-login details shortened, and no
  trailing "Review its changes, then run them" (`tests/pending.test.ts:232`).
- `pools/migrate.ts` and `plan.ts` word the same idle gate differently.
- Unify "Not found" and "Not installed" in readiness values.

## Not copy: jobs that stay Running

The demo's Linux builder showed 526 jobs Running: one-job runners record a job as started and
the demo never finishes it. Check whether a real job can stay Running forever when no result
ever arrives (a deleted run, a forge that no longer has it), and if so give it an end.
