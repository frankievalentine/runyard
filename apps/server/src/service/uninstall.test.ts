import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outThere, purgeProblem, uninstall } from "./uninstall.ts";
import { openDatabase } from "../db/index.ts";
import { recordRegistration } from "../pools/store.ts";
import { FakeMachines } from "../machines/fake.ts";
import { createMachine } from "../machines/store.ts";
import type { ServiceContext } from "./plan.ts";

describe("runyard uninstall", () => {
  test("--purge deletes only a directory that's evidently Runyard's", async () => {
    const home = await mkdtemp(join(tmpdir(), "home-"));
    expect(purgeProblem(home, home)).toContain("isn't a directory of Runyard's own");
    expect(purgeProblem("/", home)).not.toBeNull();
    expect(purgeProblem(join(home, "Documents"), home)).toContain("doesn't look like");
    expect(purgeProblem(join(home, "Library/Application Support/Runyard"), home)).toBeNull();
    const custom = join(home, "ci-data");
    await mkdir(custom);
    await writeFile(join(custom, "runyard.db"), "");
    expect(purgeProblem(custom, home)).toBeNull();
  });

  test("refuses while machines are still out there, naming each and what to do, unless --force; --dry-run changes nothing", async () => {
    const home = await mkdtemp(join(tmpdir(), "home-"));
    const dataDir = join(home, "runyard");
    await mkdir(dataDir);
    const db = openDatabase(join(dataDir, "runyard.db"));
    const m = createMachine(db, {
      name: "Box",
      sshTarget: "ci@box",
      transport: "openssh",
      expectedOs: "linux",
    });
    recordRegistration(db, {
      key: "k",
      machineId: m.id,
      runnerName: "box-mac-01",
      scope: { forgeId: "gh", kind: "org", target: "acme" },
      path: "~/runyard-runners/mac/01",
      serviceMode: "systemd",
      runnerKind: "actions",
    });
    createMachine(db, {
      name: "Spare",
      sshTarget: "runyard@spare",
      transport: "openssh",
      expectedOs: "linux",
    });
    expect(outThere(dataDir)?.machines).toEqual([
      { name: "Box", runners: 1, software: 0, running: 0 },
      { name: "Spare", runners: 0, software: 0, running: 0 },
    ]);
    const fake = new FakeMachines();
    fake.funnel = JSON.stringify({
      Web: { "me.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:7444" } } } },
      AllowFunnel: { "me.ts.net:443": true },
    });
    const binary = join(home, "runyard-bin");
    await writeFile(binary, "binary");
    const ctx = {
      platform: "darwin",
      binary,
      user: "me",
      uid: 501,
      home,
      dataDir,
      env: {},
      tailscale: null,
    } as unknown as ServiceContext;
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    const options = { purge: true, dryRun: true, log, tailscale: fake.tailscale };
    const refused = await uninstall(ctx, { ...options, force: false }).then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(refused).toContain("in the dashboard at\nhttp://127.0.0.1:7420/:");
    expect(refused).toContain("Box (1 runner): Remove (it removes them first)");
    expect(refused).toContain("Spare: Remove");
    expect(refused).toContain("Funnel serves webhooks at https://me.ts.net");
    expect(lines).toEqual([]);
    await uninstall(ctx, { ...options, force: true });
    expect(lines.join("\n")).toContain("these stay until you remove them by hand:");
    expect(lines.join("\n")).toContain("    Box (1 runner)\n    Spare\n");
    expect(lines.join("\n")).toContain(`remove ${binary}`);
    expect(lines.join("\n")).toContain("Nothing was changed");
    expect(await Bun.file(binary).exists()).toBe(true);
    expect(await Bun.file(join(dataDir, "runyard.db")).exists()).toBe(true);
  });
});
