import type { OsFamily } from "../machines/model.ts";
import type { ForgeKind } from "../model.ts";
import type { Pool } from "./model.ts";

/** A starting workflow for a pool's runners: where it goes, its runs-on line, and the file. */
export type PoolWorkflow = { forge: ForgeKind; path: string; runsOn: string; yaml: string };

/**
 * What a workflow file does: `starter` proves a job lands on the pool; `frontend` checks, tests
 * and builds a Node.js or Bun project; `generic` runs a Makefile's lint, test and build targets.
 */
export type WorkflowKind = "starter" | "frontend" | "generic";
/** How a frontend project installs and runs its scripts. */
export type FrontendTool = "npm" | "bun" | "vite-plus";
export type WorkflowOptions = { kind?: WorkflowKind; tool?: FrontendTool };

export const WORKFLOW_KINDS: readonly { kind: WorkflowKind; label: string; about: string }[] = [
  { kind: "starter", label: "Starter", about: "One job that says which runner took it." },
  {
    kind: "frontend",
    label: "Frontend",
    about: "Lint, types, tests and the build of a Node.js or Bun project, in parallel.",
  },
  {
    kind: "generic",
    label: "Generic",
    about: "Your Makefile's lint, test and build targets, in parallel.",
  },
];
export const FRONTEND_TOOLS: readonly { tool: FrontendTool; label: string }[] = [
  { tool: "npm", label: "npm" },
  { tool: "bun", label: "Bun" },
  { tool: "vite-plus", label: "Vite+" },
];

/**
 * The label only this pool's runners carry, beside the pool's own. Runyard
 * registers both on every runner in the pool.
 */
export const poolLabel = (pool: Pick<Pool, "name">): string => `runyard-pool-${pool.name}`;

/**
 * Actions the workflows use, each pinned to the commit behind a release so a moved tag can't
 * change what runs; the tag stays in a comment for updates (checked 2026-11-17).
 *
 * GitHub's runner runs JavaScript actions with its own Node 24 (Node 20 was removed on
 * 2026-09-23), so GitHub files use the latest releases. Forgejo runs them with the Node.js on the
 * machine in host mode, or in the job's image in Docker mode, which can be Node 20 or 22, and only
 * forgejo-runner 9.1 and later read `using: node24`. So Forgejo files use the last releases built
 * for Node 20, which run on every Node.js since. Vite+ has no such release.
 *
 * Forgejo looks up short names like actions/checkout in its mirror (data.forgejo.org by default,
 * changeable by the admin), whose commits match GitHub's; its docs recommend full URLs, which
 * don't depend on that setting. Actions it doesn't mirror come from GitHub by URL.
 */
const ACTIONS = {
  checkout: {
    github: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    forgejo:
      "https://data.forgejo.org/actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0",
  },
  setupNode: {
    github: "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0",
    forgejo:
      "https://data.forgejo.org/actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0",
  },
  setupBun: {
    github: "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0",
    forgejo:
      "https://github.com/oven-sh/setup-bun@ecf28ddc73e819eb6fa29df6b34ef8921c743461 # v2.1.3",
  },
  setupVp: {
    github: "voidzero-dev/setup-vp@cab1ab9eaff52d4857875f4f2c016e36af8f2c76 # v1.22.0",
    forgejo:
      "https://github.com/voidzero-dev/setup-vp@cab1ab9eaff52d4857875f4f2c016e36af8f2c76 # v1.22.0",
  },
} as const;

/**
 * Files whose change can affect any test, so a pull request that touches one runs them all:
 * lockfiles, package.json, TypeScript and test configuration.
 */
const RUN_ALL =
  "(^|/)(package\\.json|package-lock\\.json|bun\\.lockb?|pnpm-lock\\.yaml|yarn\\.lock|tsconfig[^/]*\\.json|(vite|vitest)\\.config\\.[cm]?[jt]s|bunfig\\.toml)$";

/**
 * The top of every file: least privilege, and a newer push cancels an older run. Forgejo ignores
 * `permissions` with a warning in the job's log, so its files say where the token's access is set.
 */
function head(forge: ForgeKind, name: string, on: string[]): string[] {
  return [
    `name: ${name}`,
    ...on,
    ...(forge === "github"
      ? ["permissions:", "  contents: read"]
      : [
          "# Forgejo ignores `permissions`: the token's access is set in the repository's settings.",
        ]),
    "concurrency:",
    "  group: ${{ github.workflow }}-${{ github.ref }}",
    "  cancel-in-progress: true",
  ];
}

/** Pushes to the default branch and every pull request; `main` is the usual default branch. */
const ON_PUSH_AND_PR = [
  "on:",
  "  push:",
  "    branches: [main]",
  "  pull_request:",
  "  workflow_dispatch:",
];

/** Checks out the commit without leaving the job's token in .git for later steps to read. */
function checkout(forge: ForgeKind, fetchAll = false): string[] {
  return [
    `      - uses: ${ACTIONS.checkout[forge]}`,
    "        with:",
    "          persist-credentials: false",
    ...(fetchAll ? ["          fetch-depth: 0"] : []),
  ];
}

/**
 * A minimal workflow that runs on a pool, for the pool page to show, or one that checks, tests and
 * builds a project (`options.kind`). GitHub jobs ask for `self-hosted` and every label;
 * forgejo-runner matches one label, so Forgejo jobs ask for the first. Windows machines get
 * PowerShell steps in the starter. The others' steps work in either shell, except the test step,
 * which runs in bash (Git for Windows has it).
 */
export function poolWorkflow(
  pool: Pick<Pool, "name" | "labels">,
  forge: ForgeKind,
  systems: readonly OsFamily[],
  options: WorkflowOptions = {},
): PoolWorkflow {
  const labels = pool.labels.length ? pool.labels : [poolLabel(pool)];
  const runsOn =
    forge === "github" ? `[self-hosted, ${labels.join(", ")}]` : (labels[0] ?? poolLabel(pool));
  const kind = options.kind ?? "starter";
  const lines =
    kind === "frontend"
      ? frontend(forge, runsOn, options.tool ?? "npm")
      : kind === "generic"
        ? generic(forge, runsOn)
        : starter(forge, runsOn, systems);
  return {
    forge,
    path: forge === "github" ? ".github/workflows/ci.yml" : ".forgejo/workflows/ci.yml",
    runsOn,
    yaml: [...lines, ""].join("\n"),
  };
}

function starter(forge: ForgeKind, runsOn: string, systems: readonly OsFamily[]): string[] {
  const windows = systems.includes("windows");
  const onlyWindows = windows && systems.every((s) => s === "windows");
  const greet = onlyWindows
    ? `      - run: Write-Output "Running on $env:RUNNER_NAME"`
    : windows
      ? `      - run: echo "Running on \${{ runner.name }}"`
      : `      - run: echo "Running on $RUNNER_NAME"`;
  return [
    ...head(forge, "ci", ["on: [push, workflow_dispatch]"]),
    "jobs:",
    "  build:",
    `    runs-on: ${runsOn}`,
    ...(onlyWindows ? ["    defaults:", "      run:", "        shell: powershell"] : []),
    "    steps:",
    ...checkout(forge),
    greet,
  ];
}

/** One job of a parallel workflow: its name, how long it may take, and its steps. */
function job(name: string, runsOn: string, minutes: number, steps: string[]): string[] {
  return [
    `  ${name}:`,
    `    runs-on: ${runsOn}`,
    `    timeout-minutes: ${minutes}`,
    "    steps:",
    ...steps,
  ];
}

/** Installs the project's tools and dependencies, the same in each job. */
function setup(forge: ForgeKind, tool: FrontendTool): string[] {
  switch (tool) {
    case "npm":
      return [
        `      - uses: ${ACTIONS.setupNode[forge]}`,
        "        with:",
        "          node-version: 24",
        "          cache: npm",
        "      - run: npm ci",
      ];
    case "bun":
      return [
        `      - uses: ${ACTIONS.setupBun[forge]}`,
        "      - run: bun install --frozen-lockfile",
      ];
    case "vite-plus":
      return [
        `      - uses: ${ACTIONS.setupVp[forge]}`,
        "        with:",
        "          cache: true",
        "      - run: vp install",
      ];
  }
}

/** The command that runs one of the project's package.json scripts. */
const script = (tool: FrontendTool, name: string) =>
  tool === "npm" ? `npm run ${name}` : tool === "bun" ? `bun run ${name}` : `vp run ${name}`;

/**
 * Tests on a pull request run only what its changes reach, from the import graph (`--changed`,
 * which Vitest and `bun test` both take), unless it touches a file every test depends on.
 */
function changedTests(tool: FrontendTool): string[] {
  const all = tool === "vite-plus" ? "vp test" : script(tool, "test");
  const sep = tool === "npm" ? " -- " : " ";
  return [
    "      - name: Tests",
    "        shell: bash",
    "        env:",
    "          BASE: ${{ github.base_ref }}",
    "        run: |",
    "          # Pull requests run the tests their changes reach; anything else runs them all.",
    `          if [ -n "$BASE" ] && ! git diff --name-only "origin/$BASE...HEAD" | grep -qE '${RUN_ALL}'; then`,
    `            ${all}${sep}--changed="origin/$BASE"`,
    "          else",
    `            ${all}`,
    "          fi",
  ];
}

function frontend(forge: ForgeKind, runsOn: string, tool: FrontendTool): string[] {
  const check =
    tool === "vite-plus"
      ? ["      - run: vp check"]
      : [`      - run: ${script(tool, "lint")}`, `      - run: ${script(tool, "typecheck")}`];
  const build = tool === "vite-plus" ? "vp build" : script(tool, "build");
  return [
    "# Checks, tests and builds the project in three jobs that run at the same time.",
    ...(tool === "vite-plus"
      ? [
          "# vp check formats, lints and type checks: turn on lint.options.typeAware and typeCheck",
          "# in vite.config.ts so types go through tsgo (TypeScript 7).",
        ]
      : [
          "# It runs the package.json scripts lint, typecheck, test and build, for example:",
          '#   "lint": "oxlint -D correctness -D suspicious -D perf -D pedantic"',
          '#   "typecheck": "tsgo --noEmit"   (TypeScript 7, from @typescript/native-preview)',
          `#   "test": "${tool === "bun" ? "bun test" : "vitest run"}"`,
        ]),
    "# Pull requests run only the tests their changes can reach.",
    ...(forge === "forgejo" && tool === "vite-plus"
      ? ["# setup-vp runs on Node 24: it needs forgejo-runner 9.1 or later."]
      : []),
    ...head(forge, "ci", ON_PUSH_AND_PR),
    "jobs:",
    ...job("check", runsOn, 15, [...checkout(forge), ...setup(forge, tool), ...check]),
    ...job("test", runsOn, 30, [
      ...checkout(forge, true),
      ...setup(forge, tool),
      ...changedTests(tool),
    ]),
    ...job("build", runsOn, 20, [
      ...checkout(forge),
      ...setup(forge, tool),
      `      - run: ${build}`,
    ]),
  ];
}

function generic(forge: ForgeKind, runsOn: string): string[] {
  const target = (name: string) => [...checkout(forge), `      - run: make ${name}`];
  return [
    "# Runs the Makefile's lint, test and build targets in three jobs at the same time.",
    "# Drop a job whose target your Makefile doesn't have, or add the target.",
    ...head(forge, "ci", ON_PUSH_AND_PR),
    "jobs:",
    ...job("lint", runsOn, 15, target("lint")),
    ...job("test", runsOn, 30, target("test")),
    ...job("build", runsOn, 20, target("build")),
  ];
}
