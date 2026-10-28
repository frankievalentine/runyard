import { describe, expect, test } from "bun:test";
import { macReport } from "../machines/fake.ts";
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
    ]);
    const op = await finish(
      s,
      await s.call<OperationView>("POST", `/api/reviews/${review.id}/execute`, {}),
    );
    expect(op.status).toBe("succeeded");
    expect(s.host.received.filter((r) => r.op !== "probe").map((r) => r.op)).toEqual([
      "tools-install",
      "install",
    ]);
    expect(s.host.received.find((r) => r.op === "tools-install")?.env.RF_TOOLS).toBe(
      "unzip zip xz zstd jq gpg",
    );
  });

  test("every operation puts Homebrew on PATH on a Mac, so runners keep it", () => {
    const script = operationScript("install", false, { RF_ROOT: "~/runyard-runners/mac/01" });
    expect(script).toContain("/opt/homebrew/bin");
    expect(script.indexOf("/opt/homebrew/bin")).toBeLessThan(script.indexOf("run_as_root()"));
  });
});
