import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { operationScript, parseProbe, probeScript, shPath, shQuote } from "./scripts.ts";

/**
 * The real scripts, run by the local bash against a throwaway HOME. Only paths
 * that stop before any download or GitHub call are exercised here.
 */
let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "runyard-home-"));
});
afterEach(() => rm(home, { recursive: true, force: true }));

async function bash(script: string) {
  const proc = Bun.spawn(["bash", "-s"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin" },
  });
  await proc.stdin.write(script);
  await proc.stdin.end();
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

async function configuredRunner(rel: string, name: string) {
  const dir = join(home, rel);
  await mkdir(join(dir, "bin"), { recursive: true });
  await writeFile(join(dir, ".runner"), JSON.stringify({ agentId: 1, agentName: name }, null, 2));
  await writeFile(join(dir, "bin", "Runner.Listener"), "#!/bin/sh\necho 2.329.0\n");
  await chmod(join(dir, "bin", "Runner.Listener"), 0o755);
}

const install = (over: Record<string, string> = {}) =>
  operationScript("install", false, {
    RF_ROOT: "~/runyard-runners/mac/01",
    RF_NAME: "mini-mac-01",
    RF_URL: "https://github.com/acme",
    RF_LABELS: "xcode",
    RF_TOKEN: "AREGTOKEN",
    RF_ASSET_URL:
      "https://github.com/actions/runner/releases/download/v2.329.0/actions-runner-osx-arm64-2.329.0.tar.gz",
    RF_ASSET_NAME: "actions-runner-osx-arm64-2.329.0.tar.gz",
    RF_SERVICE_MODE: "launchagent",
    ...over,
  });

test("quoting survives hostile values", async () => {
  const value = `it's "$(rm -rf /)" \`x\``;
  const { stdout } = await bash(`printf '%s' ${shQuote(value)}`);
  expect(stdout).toBe(value);
  expect((await bash(`printf '%s' ${shPath("~/a b/'c'")}`)).stdout).toBe(`${home}/a b/'c'`);
});

describe("probe", () => {
  test("reads configured and missing directories by their exact paths", async () => {
    await configuredRunner("runyard-runners/mac/01", "mini-mac-01");
    const targets = [
      { path: "~/runyard-runners/mac/01", serviceMode: "systemd" as const },
      { path: "~/runyard-runners/mac/02", serviceMode: "systemd" as const },
    ];
    const res = await bash(probeScript(false, targets));
    expect(res.code).toBe(0);
    const local = parseProbe(res.stdout, false, targets);
    expect(local.get("~/runyard-runners/mac/01")).toEqual({
      path: "~/runyard-runners/mac/01",
      configured: true,
      service: "uninstalled",
      version: "2.329.0",
      agentName: "mini-mac-01",
    });
    expect(local.get("~/runyard-runners/mac/02")).toMatchObject({
      configured: false,
      service: "missing",
    });
  });

  test("an interrupted probe is an error", () => {
    expect(() => parseProbe("RF1\t0\ttrue\tactive\t\t\n", false, [{ path: "x" }])).toThrow(
      "didn't finish",
    );
  });
});

describe("install script guards", () => {
  test("refuses a root outside ~/runyard-runners", async () => {
    const res = await bash(install({ RF_ROOT: "~/elsewhere/01" }));
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("refusing root outside");
  });

  test("refuses a download that isn't GitHub's runner release", async () => {
    const res = await bash(install({ RF_ASSET_URL: "https://example.com/runner.tar.gz" }));
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("refusing unexpected runner asset URL");
  });

  test("refuses a non-empty directory that isn't a configured runner", async () => {
    await mkdir(join(home, "runyard-runners/mac/01"), { recursive: true });
    await writeFile(join(home, "runyard-runners/mac/01/precious.txt"), "keep me");
    const res = await bash(install());
    expect(res.code).toBe(3);
    expect(res.stderr).toContain("refusing non-empty unconfigured directory");
  });

  test("refuses a directory configured as another runner", async () => {
    await configuredRunner("runyard-runners/mac/01", "someone-else");
    const res = await bash(install());
    expect(res.code).toBe(3);
    expect(res.stderr).toContain("does not have expected name");
  });
});

test("remove refuses a directory configured as another runner", async () => {
  await configuredRunner("runyard-runners/mac/01", "someone-else");
  const res = await bash(
    operationScript("remove", false, {
      RF_ROOT: "~/runyard-runners/mac/01",
      RF_NAME: "mini-mac-01",
      RF_TOKEN: "AREM",
      RF_SERVICE_MODE: "launchagent",
    }),
  );
  expect(res.code).toBe(3);
  expect(res.stderr).toContain("does not match");
});
