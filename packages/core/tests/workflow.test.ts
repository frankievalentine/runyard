import { describe, expect, test } from "vite-plus/test";
import { FRONTEND_TOOLS, poolLabel, poolWorkflow } from "../src/index.ts";

/** Every `uses:` line of a file. */
const uses = (yaml: string) => [...yaml.matchAll(/uses: (\S+)/g)].map((m) => m[1]!);

describe("a pool's starting workflow", () => {
  test("GitHub jobs ask for self-hosted and every label; Forgejo jobs for the first", () => {
    const pool = { name: "build", labels: ["linux-build", "gpu"] };
    const github = poolWorkflow(pool, "github", ["linux"]);
    expect(github).toMatchObject({
      path: ".github/workflows/ci.yml",
      runsOn: "[self-hosted, linux-build, gpu]",
    });
    expect(github.yaml).toContain("    runs-on: [self-hosted, linux-build, gpu]\n");
    expect(github.yaml).toContain('echo "Running on $RUNNER_NAME"');
    const forgejo = poolWorkflow(pool, "forgejo", ["linux"]);
    expect(forgejo).toMatchObject({ path: ".forgejo/workflows/ci.yml", runsOn: "linux-build" });
  });

  test("a pool without labels is asked for by the label only its runners carry", () => {
    const pool = { name: "ci", labels: [] };
    expect(poolLabel(pool)).toBe("runyard-pool-ci");
    expect(poolWorkflow(pool, "github", ["macos"]).runsOn).toBe("[self-hosted, runyard-pool-ci]");
    expect(poolWorkflow(pool, "forgejo", ["linux"]).runsOn).toBe("runyard-pool-ci");
  });

  test("Windows gets PowerShell steps; a mixed pool gets steps that work on both", () => {
    const pool = { name: "win", labels: ["runyard-windows"] };
    const windows = poolWorkflow(pool, "github", ["windows"]).yaml;
    expect(windows).toContain("        shell: powershell\n");
    expect(windows).toContain('Write-Output "Running on $env:RUNNER_NAME"');
    const mixed = poolWorkflow(pool, "github", ["windows", "linux"]).yaml;
    expect(mixed).not.toContain("shell: powershell");
    expect(mixed).toContain('echo "Running on ${{ runner.name }}"');
  });

  test("every file reads only, cancels older runs and leaves no token in .git", () => {
    const pool = { name: "ci", labels: ["linux-build"] };
    for (const forge of ["github", "forgejo"] as const)
      for (const options of [
        {},
        { kind: "generic" as const },
        ...FRONTEND_TOOLS.map(({ tool }) => ({ kind: "frontend" as const, tool })),
      ]) {
        const { yaml } = poolWorkflow(pool, forge, ["linux"], options);
        // Forgejo ignores permissions, with a warning in every job's log.
        if (forge === "github") expect(yaml).toContain("permissions:\n  contents: read\n");
        else expect(yaml).not.toMatch(/^permissions:/m);
        expect(yaml).toContain("  cancel-in-progress: true\n");
        const checkouts = yaml.split("actions/checkout@").length - 1;
        expect(yaml.split("persist-credentials: false").length - 1).toBe(checkouts);
        expect(yaml).not.toContain("pull_request_target");
      }
  });

  test("every action is pinned to a commit, the newest on GitHub, Node 20's on Forgejo", () => {
    const pool = { name: "ci", labels: [] };
    for (const { tool } of FRONTEND_TOOLS) {
      const github = uses(poolWorkflow(pool, "github", ["linux"], { kind: "frontend", tool }).yaml);
      for (const u of github) expect(u).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
      expect(github).toContain("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
      // Full URLs, which don't depend on the instance's default actions URL.
      const forgejo = uses(
        poolWorkflow(pool, "forgejo", ["linux"], { kind: "frontend", tool }).yaml,
      );
      for (const u of forgejo) expect(u).toMatch(/^https:\/\/[\w.]+\/[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
      expect(forgejo).toContain(
        "https://data.forgejo.org/actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
      );
    }
    const vp = poolWorkflow(pool, "forgejo", ["linux"], { kind: "frontend", tool: "vite-plus" });
    expect(vp.yaml).toContain("it needs forgejo-runner 9.1 or later");
  });

  test("the frontend file checks, tests and builds in parallel jobs", () => {
    const pool = { name: "web", labels: ["linux-build"] };
    const npm = poolWorkflow(pool, "github", ["linux"], { kind: "frontend" }).yaml;
    expect(npm).toMatch(/\n {2}check:\n[\s\S]*\n {2}test:\n[\s\S]*\n {2}build:\n/);
    expect(npm).not.toContain("needs:");
    expect(npm.split("    runs-on: [self-hosted, linux-build]\n").length - 1).toBe(3);
    expect(npm).toContain("      - run: npm ci\n");
    expect(npm).toContain("      - run: npm run typecheck\n");
    expect(npm).toContain('npm run test -- --changed="origin/$BASE"');
    // Only the test job fetches history, to diff against the base branch.
    expect(npm.split("fetch-depth: 0").length - 1).toBe(1);

    const bun = poolWorkflow(pool, "github", ["linux"], { kind: "frontend", tool: "bun" }).yaml;
    expect(bun).toContain("      - run: bun install --frozen-lockfile\n");
    expect(bun).toContain('bun run test --changed="origin/$BASE"');

    const vp = poolWorkflow(pool, "forgejo", ["linux"], { kind: "frontend", tool: "vite-plus" });
    expect(vp.path).toBe(".forgejo/workflows/ci.yml");
    expect(vp.yaml).toContain("      - run: vp check\n");
    expect(vp.yaml).toContain('vp test --changed="origin/$BASE"');
    expect(vp.yaml).toContain("      - run: vp build\n");
  });

  test("a pull request that touches a lockfile or a config runs every test", () => {
    const { yaml } = poolWorkflow({ name: "web", labels: [] }, "github", ["linux"], {
      kind: "frontend",
    });
    const pattern = new RegExp(/grep -qE '([^']+)'/.exec(yaml)![1]!);
    for (const file of [
      "package-lock.json",
      "apps/web/bun.lock",
      "tsconfig.app.json",
      "vite.config.ts",
    ])
      expect(pattern.test(file), file).toBe(true);
    for (const file of ["src/app.ts", "docs/vite.config.md"])
      expect(pattern.test(file), file).toBe(false);
  });

  test("the generic file runs the Makefile's targets", () => {
    const { yaml } = poolWorkflow({ name: "any", labels: [] }, "github", ["linux"], {
      kind: "generic",
    });
    for (const target of ["lint", "test", "build"])
      expect(yaml).toContain(`      - run: make ${target}\n`);
    expect(yaml).toContain("    branches: [main]\n  pull_request:\n");
  });
});
