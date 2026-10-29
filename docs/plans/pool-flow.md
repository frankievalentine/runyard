# Built: a simpler pool flow

Status: **built** on 2026-10-29. Saving opens the pool page with each machine's review prepared there, rather than a separate screen, so the same reviews stay on the pool page until every machine is set up.

## Why

Creating a pool was one long form (scopes, mode, machines and slots, cleanup, tools, labels,
name), and it ended at **Create pool** with nothing saying that each machine's review is the
next step, on another page. Users stopped there thinking they were done.

## The flow

Three short steps, ending with the review on the same screen.

1. **What it's for.** Start from what Runyard sees: a queued job no runner can take ("**check**
   in `runyard-test` is waiting for a runner with `runyard-check`. Make runners for it?") fills
   in the repository and labels in one click. Or pick repositories (or an organization) by hand.
   Labels come from the job; none to type.
2. **Where it runs.** Connected machines, each with its readiness in a line ("needs a C compiler
   and Docker; Runyard will install them"). Machines that can't connect yet are shown greyed
   out with a link to finish their setup.
3. **Check and create.** A plain-words summary with the defaults chosen, each line with
   **Change**:
   - one runner per machine, kept registered (persistent);
   - missing tools installed: Essentials and Build tools, plus Docker when the job's labels ask
     for `docker`;
   - the workspace cleared after each job.
     Everything else is behind **Change**: on-demand mode, slots, Forgejo's Docker mode, the
     pool's name (derived from the labels).

   **Create and review** saves the pool and prepares the review for every machine in it, shown
   inline: "On runyard-lxc: install zip, xz, jq…; install runner …-01; set cleanup." **One Run
   per machine**, so a problem on one doesn't hold up the others. Progress shows in place and ends
   with "Runner online. **check** will start now", linking to the job.

## Also

- The pool page shows a lasting "Changes waiting on <machine> ▸ Review" banner whenever its
  runners aren't installed yet.
- Editing a pool uses the same summary, then the same inline review.
- The existing pool suggestions (from queued jobs and idle machines) become step 1's options.

## Notes for building

- Reuse the existing review and execute endpoints per machine; the inline review is the
  machine page's Changes section, embedded per machine.
- Keep `docs/LIVE-TESTING.md` Round 4 in step with the new wording.
