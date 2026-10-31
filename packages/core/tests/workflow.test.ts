import { describe, expect, test } from "vite-plus/test";
import { poolLabel, poolWorkflow } from "../src/index.ts";

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
});
