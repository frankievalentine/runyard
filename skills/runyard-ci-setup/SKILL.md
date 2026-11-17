---
name: runyard-ci-setup
description: Add or update a repository's CI workflow to run on the user's own machines through Runyard, from Runyard's templates (Frontend for Node.js or Bun, Generic for a Makefile), fitted to the repository and proposed as a pull request. Use when the user wants CI set up, wants a workflow to run on their self-hosted runners or a Runyard pool, or asks to modernize a frontend project's CI (parallel jobs, tsgo, Oxlint, tests only for what a pull request changes).
---

# Set up CI with Runyard

Runyard runs CI jobs on the user's own machines, grouped into pools. This skill writes a
workflow that runs on a pool, from Runyard's templates, fitted to this repository, and proposes
it as a pull request. It never pushes to the default branch.

It needs Runyard's MCP server. If no Runyard tools are available, tell the user to connect it
(Runyard's docs: AI agents) and stop.

## 1. Read the repository

- The forge: GitHub (`.github/workflows/`) or Forgejo (`.forgejo/workflows/`), from the git
  remote and the folders present.
- Existing workflows. If one already runs CI, you're updating it: keep its jobs, triggers,
  secrets and deploy steps, and change only what the template improves. Say what you'd remove.
- The kind of project:
  - **Frontend:** a `package.json`. The tool is **Vite+** when `vite-plus` is a dependency or
    `vp` runs its scripts, **Bun** with a `bun.lock`/`bun.lockb`, otherwise **npm**. pnpm and
    Yarn projects: use npm's file and swap the install and run commands, or ask.
  - **Generic:** a `Makefile`. Note which of the `lint`, `test` and `build` targets exist.
  - Neither: ask what CI should run before writing anything.
- The default branch (`git symbolic-ref refs/remotes/origin/HEAD`), for the `push` trigger.

## 2. Pick the pool

Call `list_pools`. Keep the pools that serve this repository (its owner, or the repository
itself). If one does, use it. If several do, ask which, saying what each runs on. If none does,
say so: an admin adds the repository to a pool in Runyard first. Don't guess labels.

## 3. Get the template

Call `workflow_template` with the pool, `kind` (`frontend` or `generic`) and, for frontend,
`tool` (`npm`, `bun` or `vite-plus`). Use the file for this repository's forge. Keep its
`runs-on` lines exactly: they're how jobs reach the pool.

## 4. Fit it to the repository

- **Triggers:** set `branches:` under `push` to the default branch.
- **Frontend (npm or Bun):** the file runs the scripts `lint`, `typecheck`, `test` and `build`.
  Use the project's existing scripts where they do that job under another name. Where one is
  missing, propose adding it to `package.json`:
  - `lint`: Oxlint with `-D correctness -D suspicious -D perf -D pedantic` and the plugins the
    project uses (`--react-plugin`, `--import-plugin`, `--jsx-a11y-plugin`, `--vitest-plugin`).
  - `typecheck`: `tsgo --noEmit`, adding `@typescript/native-preview` as a dev dependency. Keep
    `tsc --noEmit` if the project pins a TypeScript older than 5.
  - `test`: `vitest run` or `bun test`. The file passes `--changed` on pull requests, which both
    support.
  - A project without tests or a build: drop that job, and say so.
- **Frontend (Vite+):** check that `vite.config.ts` turns on `lint.options.typeAware` and
  `typeCheck`, so `vp check` type checks with tsgo.
- **Generic:** remove a job whose target the Makefile doesn't have, or propose the target. Don't
  invent commands for it.
- **Keep the safety lines:** the pinned action SHAs and their version comments,
  `persist-credentials: false`, `concurrency`, and on GitHub `permissions: contents: read`.
  Add permissions to a job only for something it does, and say why.

## 5. Check it before proposing it

Run the new commands locally (the install, then lint, type check, tests and build). Report
what fails. For an existing project, stricter Oxlint rules usually raise many findings: report
the count per rule and propose landing it with warnings first (`-W` instead of `-D`), then
switching to errors once they're fixed. Don't loosen or disable a rule without saying so.

## 6. Propose it

Create a branch, commit the workflow and any `package.json` or config changes, push the branch
and open a pull request that says:

- the pool it runs on, its `runs-on` line, and what each job does;
- what changed from the existing workflow, if any;
- what you ran locally and the result.

The pull request's own run is the real test: if it fails, use the `runyard-fix-ci` skill.
