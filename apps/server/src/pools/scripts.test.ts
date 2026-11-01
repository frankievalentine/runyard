import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  operationScript,
  parseProbe,
  parseSweep,
  parseTemplateProbe,
  probeScript,
  shPath,
  shQuote,
  templateProbeScript,
} from "./scripts.ts";

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
      cleanup: null,
      history: false,
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

  test("the Windows probe says whether each runner's .env has the machine's PATH", () => {
    const targets = [
      { path: "C:\\ProgramData\\Runyard\\runners\\win\\01" },
      { path: "C:\\ProgramData\\Runyard\\runners\\win\\02" },
    ];
    const out = parseProbe(
      `[{"index":0,"configured":true,"service":"running","version":"2.329.0","agent":"win-01","pathCurrent":false},` +
        `{"index":1,"configured":false,"service":"missing","version":null,"agent":null,"pathCurrent":null}]\r\nRF_PROBE_END\r\n`,
      true,
      targets,
    );
    expect(out.get(targets[0]!.path)?.pathCurrent).toBe(false);
    expect(out.get(targets[1]!.path)).not.toHaveProperty("pathCurrent");
    expect(probeScript(true, [{ ...targets[0]!, serviceMode: "windows-service" }])).toContain(
      "GetEnvironmentVariable('Path', 'Machine')",
    );
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

describe("run history's reading of Forgejo runners' logs", () => {
  test("prints each task a runner took, named by its .runner or its one-job directory", async () => {
    const runner = join(home, "runyard-runners/ci/forgejo-frankie/01");
    await mkdir(runner, { recursive: true });
    await writeFile(join(runner, ".runner"), '{\n  "id": 3,\n  "name": "box-ci-01"\n}\n');
    await writeFile(
      join(runner, "runner.log"),
      [
        'time="2026-10-30T19:49:29Z" level=info msg="[poller] launched"',
        'time="2026-10-30T19:49:30Z" level=info msg="task 1 repo is frankie/runyard-forgejo-test https://data.forgejo.org https://forgejo.example.com"',
      ].join("\n"),
    );
    const kept = join(home, "runyard-runners/od/jobs/.logs");
    await mkdir(kept, { recursive: true });
    await writeFile(
      join(kept, "box-od-7f3a.log"),
      'time="2026-10-30T20:01:02Z" level=info msg="task 12 repo is acme/web https://data.forgejo.org https://forgejo.test"\n',
    );
    const jobs = await Bun.file(new URL("../../scripts/machine-jobs.sh", import.meta.url)).text();
    const { stdout, code } = await bash(jobs);
    expect(code).toBe(0);
    expect(stdout.trim().split("\n").sort()).toEqual([
      "RFF\t2026-10-30T19:49:30Z\tbox-ci-01\t1\tfrankie/runyard-forgejo-test",
      "RFF\t2026-10-30T20:01:02Z\tbox-od-7f3a\t12\tacme/web",
    ]);
  });
});

describe("on-demand scripts", () => {
  const tpl = "~/runyard-runners/jit/template-actions";
  test("template install refuses paths outside a pool's template-* and unexpected downloads", async () => {
    const base = {
      RF_ROOT: tpl,
      RF_KIND: "actions",
      RF_ASSET_NAME: "r.tar.gz",
      RF_VERSION: "2.329.0",
    };
    const outside = await bash(
      operationScript("template-install", false, {
        ...base,
        RF_ROOT: "~/runyard-runners/jit/01",
        RF_ASSET_URL: "https://github.com/actions/runner/releases/download/v2/r.tar.gz",
      }),
    );
    expect(outside.code).toBe(2);
    expect(outside.stderr).toContain("refusing template path");
    const url = await bash(
      operationScript("template-install", false, {
        ...base,
        RF_ASSET_URL: "https://example.com/r.tar.gz",
      }),
    );
    expect(url.code).toBe(2);
    expect(url.stderr).toContain("refusing unexpected download");
  });

  test("template remove deletes only a directory carrying Runyard's marker", async () => {
    await mkdir(join(home, "runyard-runners/jit/template-actions"), { recursive: true });
    await writeFile(join(home, "runyard-runners/jit/template-actions/run.sh"), "");
    const refused = await bash(operationScript("template-remove", false, { RF_ROOT: tpl }));
    expect(refused.code).toBe(3);
    await writeFile(
      join(home, "runyard-runners/jit/template-actions/.runyard-template"),
      "actions 2.329.0\n",
    );
    expect((await bash(operationScript("template-remove", false, { RF_ROOT: tpl }))).code).toBe(0);
    expect(await Bun.file(join(home, "runyard-runners/jit/template-actions/run.sh")).exists()).toBe(
      false,
    );
  });

  test("the template probe reads the marker's version", async () => {
    await mkdir(join(home, "runyard-runners/jit/template-actions"), { recursive: true });
    await writeFile(
      join(home, "runyard-runners/jit/template-actions/.runyard-template"),
      "actions 2.329.0\n",
    );
    const paths = [tpl, "~/runyard-runners/jit/template-forgejo"];
    const res = await bash(templateProbeScript(paths));
    expect([...parseTemplateProbe(res.stdout, paths).values()]).toEqual([
      { path: tpl, present: true, version: "2.329.0" },
      { path: "~/runyard-runners/jit/template-forgejo", present: false, version: null },
    ]);
  });

  test("a one-job runner starts only from a template, in its own directory under the pool", async () => {
    const env = {
      RF_TEMPLATE: tpl,
      RF_JOB_DIR: "~/runyard-runners/other/jobs/x",
      RF_NAME: "x",
      RF_KIND: "actions",
      RF_JIT_CONFIG: "c",
    };
    const outside = await bash(operationScript("jit-start", false, env));
    expect(outside.code).toBe(2);
    expect(outside.stderr).toContain("refusing job directory");
    const missing = await bash(
      operationScript("jit-start", false, { ...env, RF_JOB_DIR: "~/runyard-runners/jit/jobs/x" }),
    );
    expect(missing.code).toBe(3);
    expect(missing.stderr).toContain("no template");
  });

  test("starts a one-job runner detached, which removes its directory when done; the sweep reports it", async () => {
    const dir = join(home, "runyard-runners/jit/template-actions");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".runyard-template"), "actions 2.329.0\n");
    // A stand-in runner that proves it got the config from its environment, not its arguments.
    await writeFile(
      join(dir, "run.sh"),
      '#!/bin/sh\necho "args=$# config=$ACTIONS_RUNNER_INPUT_JITCONFIG" > "$HOME/ran"\nsleep 1\n',
    );
    await chmod(join(dir, "run.sh"), 0o755);
    const job = "~/runyard-runners/jit/jobs/mini-jit-1";
    const res = await bash(
      operationScript("jit-start", false, {
        RF_TEMPLATE: tpl,
        RF_JOB_DIR: job,
        RF_NAME: "mini-jit-1",
        RF_KIND: "actions",
        RF_JIT_CONFIG: "SECRETCFG",
      }),
    );
    expect(res.code).toBe(0);
    expect(parseSweep((await bash(operationScript("jit-sweep", false, {}))).stdout).alive).toEqual([
      "mini-jit-1",
    ]);
    for (let i = 0; i < 50 && !(await Bun.file(join(home, "ran")).exists()); i++)
      await Bun.sleep(100);
    expect(await Bun.file(join(home, "ran")).text()).toBe("args=0 config=SECRETCFG\n");
    for (
      let i = 0;
      i < 50 && (await Bun.file(join(home, "runyard-runners/jit/jobs/mini-jit-1/.pid")).exists());
      i++
    )
      await Bun.sleep(100);
    expect(await Bun.file(join(home, "runyard-runners/jit/jobs/mini-jit-1/.pid")).exists()).toBe(
      false,
    );
    // The template itself is untouched.
    expect(await Bun.file(join(dir, ".runyard-template")).exists()).toBe(true);
  });
});
