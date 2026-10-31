import { describe, expect, test } from "bun:test";
import { WINDOWS_TOOLS } from "@runyard/core";
import { macReport } from "../machines/fake.ts";
import { createMachine } from "../machines/store.ts";
import type { OperationView, Review } from "./engine.ts";
import { operationScript } from "./scripts.ts";
import { finish, setup } from "./test-helpers.ts";

/** A Mac whose last check found git, curl, tar and Homebrew, and nothing else. */
function readyMac(s: Awaited<ReturnType<typeof setup>>) {
  const facts = [
    "RFM\tdiag:architecture\tarm64",
    "RFM\tdiag:tool_git\t/usr/bin/git",
    "RFM\tdiag:tool_curl\t/usr/bin/curl",
    "RFM\tdiag:tool_tar\t/usr/bin/tar",
    "RFM\tdiag:tool_brew\t/opt/homebrew/bin/brew",
    "RFM\tdiag:xcode_clt\t/Library/Developer/CommandLineTools",
    `RFM\tdiag:epoch\t${Math.floor(Date.now() / 1000)}`,
    "RFM\tdiag:readiness_complete\t1",
    "RFM\tdiag:complete",
  ].join("\n");
  s.fake.machines.set("ci@mini", (stdin) =>
    stdin.includes("metric os")
      ? macReport().replace("RFM\tdiag:complete", facts)
      : s.host.answer(stdin),
  );
}

/**
 * A Windows machine whose machine PATH has git, curl and tar, with jq only on
 * the signed-in account's PATH. It answers Runyard's scripts as the fake host.
 */
async function readyWindows(s: Awaited<ReturnType<typeof setup>>) {
  const report = [
    "RFM\tos\twindows",
    "RFM\tdisk\tC:\\\t100\t50",
    "RFM_END",
    "RFM\tdiag:architecture\tAMD64",
    "RFM\tdiag:tool_git\tC:\\Program Files\\Git\\cmd\\git.exe",
    "RFM\tdiag:tool_curl\tC:\\Windows\\System32\\curl.exe",
    "RFM\tdiag:tool_tar\tC:\\Windows\\System32\\tar.exe",
    "RFM\tdiag:tool_jq_account\tC:\\Users\\ci\\AppData\\Local\\Microsoft\\WinGet\\Links\\jq.exe",
    `RFM\tdiag:epoch\t${Math.floor(Date.now() / 1000)}`,
    "RFM\tdiag:readiness_complete\t1",
    "RFM\tdiag:complete\t1",
    "",
  ].join("\r\n");
  s.fake.machines.set("ci@win", (stdin) =>
    Buffer.from(stdin.trim(), "base64").toString("utf8").includes("readiness_complete")
      ? report
      : s.host.answer(stdin),
  );
  const machine = createMachine(s.deps.db, {
    name: "Win",
    sshTarget: "ci@win",
    transport: "openssh",
    expectedOs: "windows",
  });
  await s.monitor.checkMachines();
  return machine;
}

describe("a pool's tool profiles", () => {
  test("the review installs only the missing tools, before the runners", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    readyMac(s);
    await s.monitor.checkMachines();
    const res = await s.raw("POST", "/api/pools", {
      name: "mac",
      labels: ["xcode"],
      machines: [{ machineId: s.machine.id, slots: 1 }],
      scopes: [{ forgeId: s.forgeId, kind: "org", target: "acme" }],
      toolProfiles: ["essentials", "docker"],
    });
    expect(res.status).toBe(201);
    const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(review.items.map((i) => [i.action, i.blocked, i.tools ?? null])).toEqual([
      ["installTools", false, ["unzip", "zip", "xz", "zstd", "jq", "gpg"]],
      ["installTools", true, ["docker"]],
      ["install", false, null],
      ["configureCleanup", false, null],
    ]);
    const op = await finish(
      s,
      await s.call<OperationView>("POST", `/api/reviews/${review.id}/execute`, {}),
    );
    expect(op.status).toBe("succeeded");
    expect(s.host.received.filter((r) => r.op !== "probe").map((r) => r.op)).toEqual([
      "tools-install",
      "install",
      "cleanup-configure",
    ]);
    expect(s.host.received.find((r) => r.op === "tools-install")?.env.RF_TOOLS).toBe(
      "unzip zip xz zstd jq gpg",
    );
  });

  test("Windows installs with winget, and leaves a tool only one account has to a person", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    const win = await readyWindows(s);
    const res = await s.raw("POST", "/api/pools", {
      name: "win",
      labels: ["runyard-windows"],
      machines: [{ machineId: win.id, slots: 1 }],
      scopes: [{ forgeId: s.forgeId, kind: "org", target: "acme" }],
      toolProfiles: ["essentials", "build"],
    });
    expect(res.status).toBe(201);
    const review = await s.call<Review>("POST", `/api/machines/${win.id}/review`);
    expect(review.items.map((i) => [i.action, i.blocked, i.tools ?? null])).toEqual([
      ["installTools", false, ["unzip", "zip", "xz", "zstd", "cc", "make", "python3"]],
      ["installTools", true, ["jq"]],
      ["install", false, null],
      ["configureCleanup", false, null],
    ]);
    expect(review.items[0]?.reason).toBe(
      "Install 7-Zip, xz, zstd, gcc, make with winget, and Python 3.13 with uv.",
    );
    expect(review.items[1]?.reason).toContain("Installed for one account only");
    const op = await finish(
      s,
      await s.call<OperationView>("POST", `/api/reviews/${review.id}/execute`, {}),
    );
    expect(op.status).toBe("succeeded");
    expect(s.host.received.filter((r) => r.op !== "probe").map((r) => r.op)).toEqual([
      "tools-install",
      "install",
      "cleanup-configure",
    ]);
    expect(s.host.received.find((r) => r.op === "tools-install")?.env.RF_TOOLS).toBe(
      "unzip zip xz zstd cc make python3",
    );
    // The new runner's hooks are in place: it records jobs (the pool clears nothing after them).
    expect(s.host.received.find((r) => r.op === "cleanup-configure")?.env).toMatchObject({
      RF_ROOT: "C:\\ProgramData\\Runyard\\runners\\win\\01",
      RF_CLEANUP: "off",
    });
    expect(
      (await s.call<Review>("POST", `/api/machines/${win.id}/review`)).items.map((i) => i.action),
    ).not.toContain("configureCleanup");
  });

  test("a Windows runner gets the machine's PATH when it's stale, once it's idle", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    const win = await readyWindows(s);
    const res = await s.raw("POST", "/api/pools", {
      name: "win",
      labels: ["runyard-windows"],
      machines: [{ machineId: win.id, slots: 1 }],
      scopes: [{ forgeId: s.forgeId, kind: "org", target: "acme" }],
      toolProfiles: [],
    });
    expect(res.status).toBe(201);
    const first = await s.call<Review>("POST", `/api/machines/${win.id}/review`);
    await finish(s, await s.call<OperationView>("POST", `/api/reviews/${first.id}/execute`, {}));
    const path = first.items[0]!.path;
    expect(s.host.dirs.get(path)?.pathCurrent).toBe(true);
    const runner = {
      id: 7,
      name: first.items[0]!.runnerName,
      os: "Windows",
      status: "online" as const,
      labels: first.items[0]!.labels ?? [],
    };
    s.fakeGithub.runners.set("acme", [{ ...runner, busy: false }]);
    await s.github.pollRunners();
    expect((await s.call<Review>("POST", `/api/machines/${win.id}/review`)).items).toEqual([]);

    // Something changed the machine PATH: the runner's copy is stale.
    s.host.dirs.get(path)!.pathCurrent = false;
    s.fakeGithub.runners.set("acme", [{ ...runner, busy: true }]);
    await s.github.pollRunners();
    const busy = await s.call<Review>("POST", `/api/machines/${win.id}/review`);
    expect(busy.items.map((i) => [i.action, i.blocked])).toEqual([["syncPath", true]]);

    s.fakeGithub.runners.set("acme", [{ ...runner, busy: false }]);
    await s.github.pollRunners();
    const idle = await s.call<Review>("POST", `/api/machines/${win.id}/review`);
    expect(idle.items.map((i) => [i.action, i.blocked])).toEqual([["syncPath", false]]);
    const op = await finish(
      s,
      await s.call<OperationView>("POST", `/api/reviews/${idle.id}/execute`, {}),
    );
    expect(op.status).toBe("succeeded");
    expect(s.host.received.at(-1)).toEqual({
      op: "path-sync",
      env: { RF_ROOT: path, RF_NAME: runner.name },
    });
    expect(s.host.dirs.get(path)?.pathCurrent).toBe(true);
  });

  test("tools that fail to install don't hold up the runners, and the run says so", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    const win = await readyWindows(s);
    await s.raw("POST", "/api/pools", {
      name: "win",
      labels: ["runyard-windows"],
      machines: [{ machineId: win.id, slots: 1 }],
      scopes: [{ forgeId: s.forgeId, kind: "org", target: "acme" }],
      toolProfiles: ["essentials"],
    });
    const review = await s.call<Review>("POST", `/api/machines/${win.id}/review`);
    s.host.failNext = "Couldn't install TukaaniProject.XZUtils (its download failed).";
    const op = await finish(
      s,
      await s.call<OperationView>("POST", `/api/reviews/${review.id}/execute`, {}),
    );
    expect(op.status).toBe("failed");
    expect(op.steps.map((st) => [st.action, st.status])).toEqual([
      ["installTools", "failed"],
      ["install", "succeeded"],
      ["configureCleanup", "succeeded"],
    ]);
    const events = await s.call<{ kind: string; detail: string }[]>(
      "GET",
      `/api/events?machine=${win.id}`,
    );
    expect(events.find((e) => e.kind === "changesFailed")?.detail).toBe(
      "Installed win-win-01; set job hooks on win-win-01; couldn't install 7-Zip, xz, zstd: Couldn't install TukaaniProject.XZUtils (its download failed) (by admin).",
    );
  });

  test("Windows scripts carry the same winget packages as core", () => {
    const script = operationScript("tools-install", true, { RF_TOOLS: "jq" });
    for (const [tool, w] of Object.entries(WINDOWS_TOOLS))
      if (w.winget)
        expect(script).toMatch(new RegExp(`\\b${tool}\\s*= "${w.winget.replace(/\./g, "\\.")}"`));
  });

  test("every operation puts Homebrew on PATH on a Mac, so runners keep it", () => {
    const script = operationScript("install", false, { RF_ROOT: "~/runyard-runners/mac/01" });
    expect(script).toContain("/opt/homebrew/bin");
    expect(script.indexOf("/opt/homebrew/bin")).toBeLessThan(script.indexOf("run_as_root()"));
  });
});
