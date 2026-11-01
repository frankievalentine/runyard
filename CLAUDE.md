# Runyard: notes for agents

Design and roadmap: [docs/PLAN.md](docs/PLAN.md). Follow its decisions and safety rules; raise a
change to them before implementing it.

- **Verify loop:** `vp run ci`: `vp run ready` (`vp check`, then `vp run -r test` and `vp run -r build`), then a
  smoke test of the compiled binary. GitHub Actions runs the same on every push and pull request
  (`.github/workflows/ci.yml`); run it locally before pushing.
- **Releasing:** set the version in `apps/server/package.json` (the one `runyard version` prints;
  keep the other package.json files in step), commit, then push a `v<version>` tag. The release
  workflow builds the binaries and the Docker image and drafts a GitHub Release; publishing it
  makes it the one the installers download. GitHub Pages serves the installers and redeploys when
  `install/` changes on main. A manual run of the release workflow is a dry run.
- **Tests:** `packages/core` and `apps/dashboard` use `vp test` (Vitest, imported from
  `vite-plus/test`). `apps/server` uses `bun test`, because it depends on Bun APIs such as
  `bun:sqlite` that don't load under Vitest's Node workers. Keep logic that needs no I/O in
  `packages/core`.
- **Safety:** tests never contact a real forge or machine; they fake forge clients and SSH. Don't
  run changes against machines or mint runner tokens unless the user asks.
- **Terms:** "machine" for a computer, "pool" for runner capacity, "scope" for where a
  registration lives, "registration" for one runner registered with a forge.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
