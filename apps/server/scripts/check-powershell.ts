/**
 * Parses every PowerShell script Runyard ships or generates, in Microsoft's
 * PowerShell container. A syntax check only: nothing runs on Windows. Needs
 * Docker, so it's separate from `vp run ci`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Glob } from "bun";
import { operationScript, probeScript, type Operation } from "../src/pools/scripts.ts";
import { installPlan, statusCommand, uninstallPlan } from "../src/service/plan.ts";

const repo = resolve(import.meta.dir, "../../..");
const out = await mkdtemp(join(tmpdir(), "runyard-ps1-"));
try {
  const shipped = [
    ...new Glob("apps/server/scripts/*.ps1").scanSync({ cwd: repo }),
    ...new Glob("install/*.ps1").scanSync({ cwd: repo }),
  ];
  for (const f of shipped)
    await Bun.write(join(out, f.replace(/[\\/]/g, "_")), Bun.file(join(repo, f)));

  const ctx = {
    platform: "win32" as const,
    binary: "C:\\Users\\ci\\runyard.exe",
    user: "BOX\\ci",
    uid: 0,
    home: "C:\\Users\\ci",
    dataDir: "C:\\Users\\ci\\AppData\\Roaming\\Runyard",
    env: { RUNYARD_ORIGIN: "https://it's.example" },
    tailscale: null,
  };
  const plan = installPlan(ctx);
  const generated: Record<string, string> = {
    "service-launcher.ps1": plan.files[0]!.content,
    "service-register.ps1": plan.commands[0]!.argv.at(-1)!,
    "service-unregister.ps1": uninstallPlan(ctx).commands[0]!.argv.at(-1)!,
    "service-status.ps1": statusCommand(ctx).at(-1)!,
    "runner-probe.ps1": probeScript(true, [
      { path: "C:\\runyard-runners\\ci\\01", serviceMode: "windows-service" },
    ]),
  };
  const env = {
    RF_ROOT: "C:\\runyard-runners\\ci\\01",
    RF_NAME: "win-ci-01",
    RF_URL: "https://github.com/acme",
    RF_LABELS: "x",
    RF_TOKEN: "T",
    RF_ASSET_URL:
      "https://github.com/actions/runner/releases/download/v2.329.0/actions-runner-win-x64-2.329.0.zip",
    RF_ASSET_NAME: "actions-runner-win-x64-2.329.0.zip",
    RF_SERVICE_MODE: "windows-service",
  };
  for (const op of ["install", "start", "remove"] as Operation[]) {
    generated[`runner-${op}-composed.ps1`] = operationScript(op, true, env);
  }
  for (const [name, content] of Object.entries(generated))
    await Bun.write(join(out, name), content);

  await Bun.write(
    join(out, "parse.ps1"),
    `$failed = 0
foreach ($path in Get-ChildItem /s -Filter *.ps1 | Where-Object Name -ne 'parse.ps1') {
  $tokens = $null; $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($path.FullName, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count) { $failed++; foreach ($e in $errors) { "$($path.Name):$($e.Extent.StartLineNumber): $($e.Message)" } } else { "ok $($path.Name)" }
}
exit $failed
`,
  );
  const proc = Bun.spawn(
    [
      "docker",
      "run",
      "--rm",
      "-v",
      `${out}:/s:ro`,
      "mcr.microsoft.com/powershell:latest",
      "pwsh",
      "-NoProfile",
      "-File",
      "/s/parse.ps1",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  process.exitCode = await proc.exited;
} finally {
  await rm(out, { recursive: true, force: true });
}
