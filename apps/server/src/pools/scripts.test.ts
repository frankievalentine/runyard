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

async function bash(script: string, pathPrefix?: string) {
  const path = process.env.PATH ?? "/usr/bin:/bin";
  const proc = Bun.spawn(["bash", "-s"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { HOME: home, PATH: pathPrefix ? `${pathPrefix}:${path}` : path },
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

async function forgejoRunner(rel: string, name: string) {
  const dir = join(home, rel);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, ".runner"),
    `{\n  "id": 7,\n  "uuid": "u",\n  "name": "${name}",\n  "token": "secret",\n  "address": "https://forgejo.test",\n  "labels": ["docker:host"]\n}\n`,
  );
  await writeFile(join(dir, ".service"), `runyard-forgejo-${name}.service\n`);
  return dir;
}

/** A sudo that allows everything and only records what it was asked to run. */
async function fakeSudo() {
  const bin = join(home, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(
    join(bin, "sudo"),
    `#!/bin/sh\n[ "$1" = -n ] && shift\n[ "$1" = true ] && exit 0\necho "$@" >> "${home}/sudo.log"\n`,
  );
  await chmod(join(bin, "sudo"), 0o755);
  return bin;
}

const forgejoInstall = (over: Record<string, string> = {}) =>
  operationScript("forgejo-install", false, {
    RF_ROOT: "~/runyard-runners/ci/forgejo-frankie/01",
    RF_NAME: "box-ci-01",
    RF_URL: "https://forgejo.test",
    RF_RUNNER_ID: "7",
    RF_UUID: "u",
    RF_TOKEN: "secret",
    RF_LABELS: "docker:host",
    RF_BINARY_URL:
      "https://code.forgejo.org/forgejo/runner/releases/download/v13.2.0/forgejo-runner-13.2.0-linux-amd64",
    RF_BINARY_NAME: "forgejo-runner-13.2.0-linux-amd64",
    RF_CHECKSUM: "cd".repeat(32),
    RF_MODE: "host",
    ...over,
  });

describe("forgejo-runner scripts", () => {
  test("install refuses a download that isn't code.forgejo.org's release", async () => {
    const res = await bash(forgejoInstall({ RF_BINARY_URL: "https://example.com/forgejo-runner" }));
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("unexpected forgejo-runner download URL");
  });

  test("install refuses a root outside ~/runyard-runners", async () => {
    const res = await bash(forgejoInstall({ RF_ROOT: "~/elsewhere/01" }));
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("refusing root outside");
  });

  test.skipIf(process.platform === "linux")("install refuses anything but Linux", async () => {
    const res = await bash(forgejoInstall());
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("only published for Linux");
  });

  test("configure rewrites only the labels line, then restarts the exact service", async () => {
    const dir = await forgejoRunner("runyard-runners/ci/forgejo-frankie/01", "box-ci-01");
    const res = await bash(
      operationScript("forgejo-configure", false, {
        RF_ROOT: "~/runyard-runners/ci/forgejo-frankie/01",
        RF_NAME: "box-ci-01",
        RF_LABELS: "docker:host,runyard:host",
      }),
      await fakeSudo(),
    );
    expect(res.code).toBe(0);
    const runner = JSON.parse(await Bun.file(join(dir, ".runner")).text()) as Record<
      string,
      unknown
    >;
    expect(runner).toMatchObject({
      name: "box-ci-01",
      token: "secret",
      labels: ["docker:host", "runyard:host"],
    });
    expect(await Bun.file(join(home, "sudo.log")).text()).toBe(
      "systemctl restart runyard-forgejo-box-ci-01.service\n",
    );
  });

  test("remove refuses another runner's directory, and keeps its own as .runner.removed", async () => {
    await forgejoRunner("runyard-runners/ci/forgejo-frankie/01", "someone-else");
    const env = { RF_ROOT: "~/runyard-runners/ci/forgejo-frankie/01", RF_NAME: "box-ci-01" };
    const refused = await bash(operationScript("forgejo-remove", false, env));
    expect(refused.code).toBe(3);
    const dir = await forgejoRunner("runyard-runners/ci/forgejo-frankie/02", "box-ci-02");
    const res = await bash(
      operationScript("forgejo-remove", false, {
        RF_ROOT: "~/runyard-runners/ci/forgejo-frankie/02",
        RF_NAME: "box-ci-02",
      }),
      await fakeSudo(),
    );
    expect(res.code).toBe(0);
    expect(await Bun.file(join(dir, ".runner")).exists()).toBe(false);
    expect(await Bun.file(join(dir, ".runner.removed")).exists()).toBe(true);
  });

  test("the probe reads a forgejo-runner's name", async () => {
    await forgejoRunner("runyard-runners/ci/forgejo-frankie/01", "box-ci-01");
    const targets = [
      { path: "~/runyard-runners/ci/forgejo-frankie/01", serviceMode: "systemd" as const },
    ];
    const res = await bash(probeScript(false, targets));
    expect(parseProbe(res.stdout, false, targets).get(targets[0]!.path)).toMatchObject({
      configured: true,
      agentName: "box-ci-01",
    });
  });
});
