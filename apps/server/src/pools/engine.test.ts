import { describe, expect, test } from "bun:test";
import type { FleetView } from "@runyard/core";
import { createMachine } from "../machines/store.ts";
import { send } from "../testing.ts";
import type { OperationView, Review } from "./engine.ts";
import { finish, pool, setup } from "./test-helpers.ts";
import { listRegistrations } from "./store.ts";

describe("pool engine", () => {
  test("reviews and installs an organization runner, with the token only on stdin", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: ["acme/app"] });
    await pool(s, [{ kind: "org", target: "acme" }]);
    const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(review.items.map((i) => [i.action, i.runnerName, i.path, i.blocked])).toEqual([
      ["install", "mini-mac-01", "~/runyard-runners/mac/01", false],
    ]);
    expect(review.mayNeedSudo).toBe(false);

    const op = await finish(
      s,
      await s.call<OperationView>("POST", `/api/reviews/${review.id}/execute`, {}),
    );
    expect(op).toMatchObject({
      status: "succeeded",
      steps: [{ action: "install", status: "succeeded" }],
    });

    const install = s.host.received.find((r) => r.op === "install")!;
    const token = s.fakeGithub.issued.find((i) => i.kind === "registration")!.token;
    expect(install.env).toMatchObject({
      RF_ROOT: "~/runyard-runners/mac/01",
      RF_NAME: "mini-mac-01",
      RF_URL: "https://github.com/acme",
      RF_LABELS: "xcode,runyard,runyard-pool-mac",
      RF_TOKEN: token,
      RF_SERVICE_MODE: "launchagent",
      RF_ASSET_NAME: "actions-runner-osx-arm64-2.329.0.tar.gz",
      RF_CHECKSUM: "ab".repeat(32),
    });
    const sshCalls = s.fake.calls.filter((c) => c[0] === "ssh");
    expect(sshCalls.every((argv) => !argv.join(" ").includes(token))).toBe(true);
    expect(listRegistrations(s.deps.db).map((r) => r.runnerName)).toEqual(["mini-mac-01"]);
  });

  test("once GitHub lists it, the runner links to its machine and nothing is left to do", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    await pool(s, [{ kind: "org", target: "acme" }]);
    await finish(
      s,
      await s.call<OperationView>(
        "POST",
        `/api/reviews/${(await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`)).id}/execute`,
        {},
      ),
    );
    s.fakeGithub.runners.set("acme", [
      {
        id: 41,
        name: "mini-mac-01",
        os: "macOS",
        status: "online",
        busy: false,
        labels: ["self-hosted", "macOS", "ARM64", "xcode", "runyard", "runyard-pool-mac"],
      },
    ]);
    await s.github.pollRunners();
    const view = await s.call<FleetView>("GET", "/api/fleet");
    expect(view.github.runners[0]).toMatchObject({ name: "mini-mac-01", machineId: s.machine.id });
    expect((await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`)).items).toEqual(
      [],
    );
  });

  test("refuses a plan that changed since the review, and each review works once", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    await pool(s, [{ kind: "org", target: "acme" }]);
    const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    // Someone registered the runner by hand in the meantime.
    s.fakeGithub.runners.set("acme", [
      { id: 9, name: "mini-mac-01", os: "macOS", status: "online", busy: false, labels: [] },
    ]);
    const changed = await s.raw("POST", `/api/reviews/${review.id}/execute`, {});
    expect(changed.status).toBe(409);
    expect(((await changed.json()) as { error: string }).error).toContain(
      "changed since the review",
    );
    expect(s.host.received.some((r) => r.op === "install")).toBe(false);
    const again = await s.raw("POST", `/api/reviews/${review.id}/execute`, {});
    expect(((await again.json()) as { error: string }).error).toContain("already used");
  });

  test("reviews expire after 15 minutes", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    await pool(s, [{ kind: "org", target: "acme" }]);
    const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    s.clock.now += 15 * 60_000;
    expect((await s.raw("POST", `/api/reviews/${review.id}/execute`, {})).status).toBe(409);
  });

  test("refuses public personal repositories until an admin types the name", async () => {
    const s = await setup({ account: "frankie", type: "User", repos: ["frankie/site"] });
    s.fakeGithub.publicRepos.add("frankie/site");
    await pool(s, [{ kind: "repo", target: "frankie/site" }]);
    const refused = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(refused.items.map((i) => [i.action, i.blocked])).toEqual([["publicRepo", true]]);
    expect(refused.items[0]?.reason).toContain("frankie/site is public");

    const wrong = await s.raw("POST", "/api/public-repos", {
      forgeId: s.forgeId,
      repo: "frankie/site",
      confirm: "frankie/sit",
    });
    expect(wrong.status).toBe(400);
    await s.call("POST", "/api/public-repos", {
      forgeId: s.forgeId,
      repo: "frankie/site",
      confirm: "frankie/site",
    });
    const allowed = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(allowed.items.map((i) => [i.action, i.runnerName, i.path])).toEqual([
      ["install", "mini-mac-01", "~/runyard-runners/mac/frankie-site/01"],
    ]);
  });

  test("refuses an organization whose Default group admits public repositories", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    s.fakeGithub.openGroups.add("acme");
    await pool(s, [{ kind: "org", target: "acme" }]);
    const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(review.items.map((i) => [i.action, i.blocked])).toEqual([["groupPolicy", true]]);
    expect((await s.raw("POST", `/api/reviews/${review.id}/execute`, {})).status).toBe(409);
  });

  test("removes runners no pool wants, but never a busy one", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    const id = await pool(s, [{ kind: "org", target: "acme" }]);
    await finish(
      s,
      await s.call<OperationView>(
        "POST",
        `/api/reviews/${(await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`)).id}/execute`,
        {},
      ),
    );
    s.fakeGithub.runners.set("acme", [
      { id: 41, name: "mini-mac-01", os: "macOS", status: "online", busy: true, labels: [] },
    ]);
    await s.call("DELETE", `/api/pools/${id}`);

    const busy = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(busy.items.map((i) => [i.action, i.blocked])).toEqual([["remove", true]]);

    s.fakeGithub.runners.get("acme")![0]!.busy = false;
    const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(review.items.map((i) => [i.action, i.blocked])).toEqual([["remove", false]]);
    const op = await finish(
      s,
      await s.call<OperationView>("POST", `/api/reviews/${review.id}/execute`, {}),
    );
    expect(op.status).toBe("succeeded");
    expect(s.host.received.find((r) => r.op === "remove")?.env.RF_TOKEN).toStartWith("AREM");
    expect(listRegistrations(s.deps.db)).toEqual([]);
  });

  test("a failed step stops the operation, and secrets never appear in its output", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    await pool(s, [{ kind: "org", target: "acme" }], 2);
    const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(review.items).toHaveLength(2);
    s.host.failNext = "config.sh failed";
    const original = s.host.answer;
    s.host.answer = (stdin) => {
      const result = original(stdin);
      // A script that echoes its token: Runyard must redact it.
      const token = /RF_TOKEN='([^']+)'/.exec(stdin)?.[1];
      return typeof result === "object" && token
        ? { ...result, stderr: `${result.stderr} token=${token}` }
        : result;
    };
    const op = await finish(
      s,
      await s.call<OperationView>("POST", `/api/reviews/${review.id}/execute`, {
        sudoPassword: "hunter22",
      }),
    );
    expect(op.status).toBe("failed");
    expect(op.steps.map((st) => st.status)).toEqual(["failed", "skipped"]);
    expect(op.steps[0]!.output).toContain("token=•••");
    expect(JSON.stringify(op)).not.toContain("AREG");
    expect(listRegistrations(s.deps.db)).toEqual([]);
  });

  test("only admins review and execute; pools with clashing runner names are refused", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    expect((await send(s.app, "POST", `/api/machines/${s.machine.id}/review`)).status).toBe(401);
    await pool(s, [{ kind: "org", target: "acme" }]);
    const twin = createMachine(s.deps.db, {
      name: "mini",
      sshTarget: "ci@mini2",
      transport: "openssh",
      expectedOs: "macos",
    });
    const clash = await s.raw("POST", "/api/pools", {
      name: "mac2",
      labels: [],
      machines: [
        { machineId: s.machine.id, slots: 1 },
        { machineId: twin.id, slots: 1 },
      ],
      scopes: [{ forgeId: s.forgeId, kind: "org", target: "acme" }],
    });
    expect(clash.status).toBe(400);
  });
});
