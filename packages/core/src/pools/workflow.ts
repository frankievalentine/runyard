import type { OsFamily } from "../machines/model.ts";
import type { ForgeKind } from "../model.ts";
import type { Pool } from "./model.ts";

/** A starting workflow for a pool's runners: where it goes, its runs-on line, and the file. */
export type PoolWorkflow = { forge: ForgeKind; path: string; runsOn: string; yaml: string };

/**
 * The label only this pool's runners carry, beside the pool's own. Runyard
 * registers both on every runner in the pool.
 */
export const poolLabel = (pool: Pick<Pool, "name">): string => `runyard-pool-${pool.name}`;

/**
 * A minimal workflow that runs on a pool, for the pool page to show. GitHub
 * jobs ask for `self-hosted` and every label; forgejo-runner matches one label,
 * so Forgejo jobs ask for the first. Windows machines get PowerShell steps;
 * a pool on Windows and other machines gets steps that work on both.
 */
export function poolWorkflow(
  pool: Pick<Pool, "name" | "labels">,
  forge: ForgeKind,
  systems: readonly OsFamily[],
): PoolWorkflow {
  const labels = pool.labels.length ? pool.labels : [poolLabel(pool)];
  const runsOn =
    forge === "github" ? `[self-hosted, ${labels.join(", ")}]` : (labels[0] ?? poolLabel(pool));
  const windows = systems.includes("windows");
  const onlyWindows = windows && systems.every((s) => s === "windows");
  const greet = onlyWindows
    ? `      - run: Write-Output "Running on $env:RUNNER_NAME"`
    : windows
      ? `      - run: echo "Running on \${{ runner.name }}"`
      : `      - run: echo "Running on $RUNNER_NAME"`;
  const yaml = [
    "name: ci",
    "on: [push, workflow_dispatch]",
    "jobs:",
    "  build:",
    `    runs-on: ${runsOn}`,
    ...(onlyWindows ? ["    defaults:", "      run:", "        shell: powershell"] : []),
    "    steps:",
    "      - uses: actions/checkout@v4",
    greet,
    "",
  ].join("\n");
  return {
    forge,
    path: forge === "github" ? ".github/workflows/ci.yml" : ".forgejo/workflows/ci.yml",
    runsOn,
    yaml,
  };
}
