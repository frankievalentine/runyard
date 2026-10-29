import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { purgeProblem, remainingOutThere, uninstall } from "./uninstall.ts";
import { openDatabase } from "../db/index.ts";
import { recordRegistration } from "../pools/store.ts";
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

  test("refuses while runners are still out there, unless --force; --dry-run changes nothing", async () => {
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
    expect(remainingOutThere(dataDir)).toEqual(["box-mac-01"]);
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
    await expect(uninstall(ctx, { purge: true, force: false, dryRun: true, log })).rejects.toThrow(
      "box-mac-01",
    );
    await uninstall(ctx, { purge: true, force: true, dryRun: true, log });
    expect(lines.join("\n")).toContain(`remove ${binary}`);
    expect(lines.join("\n")).toContain("Nothing was changed");
    expect(await Bun.file(binary).exists()).toBe(true);
    expect(await Bun.file(join(dataDir, "runyard.db")).exists()).toBe(true);
  });
});
