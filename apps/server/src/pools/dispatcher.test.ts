import { describe, expect, test } from "bun:test";
import type { YardView } from "@runyard/core";
import type { Review } from "./engine.ts";
import { listDispatches, listTemplates } from "./store.ts";
import { finish, setup, type Setup } from "./test-helpers.ts";

/** An on-demand pool for acme, its template installed through a review. */
async function onDemand(s: Setup, slots = 1) {
  const res = await s.raw("POST", "/api/pools", {
    name: "jit",
    labels: ["xcode"],
    machines: [{ machineId: s.machine.id, slots }],
    scopes: [{ forgeId: s.forgeId, kind: "org", target: "acme" }],
    mode: "onDemand",
  });
  expect(res.status).toBe(201);
  const id = ((await res.json()) as { id: string }).id;
  const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
  expect(review.items.map((i) => [i.action, i.path, i.blocked])).toEqual([
    ["installTemplate", "~/runyard-runners/jit/template-actions", false],
  ]);
  expect(
    (await finish(s, await s.call("POST", `/api/reviews/${review.id}/execute`, {}))).status,
  ).toBe("succeeded");
  return id;
}

/** Puts a job in acme/app's queue and lets Runyard see it. */
async function queue(s: Setup, id: number, labels = ["self-hosted", "macOS", "xcode"]) {
  s.fakeGithub.runs.set("acme/app", [
    {
      id: id * 10,
      status: "queued",
      jobs: [
        { id, name: `job-${id}`, status: "queued", labels, created_at: new Date().toISOString() },
      ],
    },
  ]);
  await s.github.pollJobs();
  s.monitor.tick();
}

async function round(s: Setup) {
  await s.github.pollRunners();
  s.monitor.tick();
  await s.dispatcher.tick();
  s.monitor.tick();
}

describe("on-demand pools", () => {
  test("the review installs a template, and nothing is registered with GitHub", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: ["acme/app"] });
    await onDemand(s);
    expect(s.host.templates.get("~/runyard-runners/jit/template-actions")).toBe("2.329.0");
    expect(listTemplates(s.deps.db).map((t) => t.path)).toEqual([
      "~/runyard-runners/jit/template-actions",
    ]);
    expect(s.fakeGithub.issued).toEqual([]);
    const again = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(again.items).toEqual([]);
  });

  test("a queued job gets a one-job runner, which runs and then finishes", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: ["acme/app"] });
    await onDemand(s);
    await queue(s, 501);
    await round(s);
    const [jit] = s.fakeGithub.jitConfigs;
    expect(jit).toMatchObject({
      owner: "acme",
      labels: expect.arrayContaining(["self-hosted", "macOS", "xcode", "runyard"]),
    });
    const start = s.host.received.find((r) => r.op === "jit-start")!;
    expect(start.env).toMatchObject({
      RF_TEMPLATE: "~/runyard-runners/jit/template-actions",
      RF_NAME: jit!.name,
      RF_KIND: "actions",
      RF_JIT_CONFIG: jit!.config,
    });
    expect(start.env.RF_JOB_DIR).toBe(`~/runyard-runners/jit/jobs/${jit!.name}`);
    // The single-use config travels only on stdin, never in an argument.
    expect(s.fake.calls.every((argv) => !argv.join(" ").includes(jit!.config))).toBe(true);
    expect(listDispatches(s.deps.db)).toMatchObject([
      { jobId: 501, state: "starting", runnerName: jit!.name },
    ]);

    // Once per job: the next round starts nothing more for it.
    await round(s);
    expect(s.fakeGithub.jitConfigs).toHaveLength(1);

    s.fakeGithub.runners.get("acme")!.find((r) => r.name === jit!.name)!.status = "online";
    await round(s);
    expect(listDispatches(s.deps.db)[0]?.state).toBe("running");

    s.host.jobs.set(jit!.name, "exited");
    await round(s);
    expect(listDispatches(s.deps.db)[0]?.state).toBe("done");
    const events = await s.call<{ kind: string }[]>("GET", "/api/events");
    expect(events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["runnerStarted", "runnerFinished"]),
    );
  });

  test("a failed start deletes the single-use registration", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: ["acme/app"] });
    await onDemand(s);
    await queue(s, 502);
    s.host.failNext = "no template at ~/runyard-runners/jit/template-actions";
    await round(s);
    expect(listDispatches(s.deps.db)).toMatchObject([
      { state: "failed", detail: expect.stringContaining("no template") },
    ]);
    expect(s.fakeGithub.deletedRunners.map((d) => d.id)).toEqual([s.fakeGithub.jitConfigs[0]!.id]);
    const events = await s.call<{ kind: string; detail: string }[]>("GET", "/api/events");
    expect(events.find((e) => e.kind === "runnerFailed")?.detail).toContain("no template at");
  });

  test("a paused pool starts nothing; labels the pool lacks start nothing", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: ["acme/app"] });
    const id = await onDemand(s);
    await s.call("PUT", `/api/pools/${id}/paused`, { paused: true });
    await queue(s, 503);
    await round(s);
    expect(s.fakeGithub.jitConfigs).toEqual([]);
    await s.call("PUT", `/api/pools/${id}/paused`, { paused: false });
    await queue(s, 504, ["self-hosted", "gpu"]);
    await round(s);
    expect(s.fakeGithub.jitConfigs).toEqual([]);
    const view = await s.call<YardView>("GET", "/api/yard");
    expect(view.pools.pools[0]).toMatchObject({ mode: "onDemand", paused: false });
  });

  test("switching a persistent pool to on demand removes its runners in the same review", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: ["acme/app"] });
    const body = {
      name: "mac",
      labels: ["xcode"],
      machines: [{ machineId: s.machine.id, slots: 1 }],
      scopes: [{ forgeId: s.forgeId, kind: "org", target: "acme" }],
    };
    const created = await s.call<{ id: string }>("POST", "/api/pools", body);
    const first = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    await finish(s, await s.call("POST", `/api/reviews/${first.id}/execute`, {}));
    s.fakeGithub.runners.set("acme", [
      {
        id: 1,
        name: "mini-mac-01",
        os: "macOS",
        status: "online",
        busy: false,
        labels: ["self-hosted", "xcode", "runyard", "runyard-pool-mac"],
      },
    ]);
    await s.call("PUT", `/api/pools/${created.id}`, { ...body, mode: "onDemand" });
    const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(review.items.map((i) => i.action).sort()).toEqual(["installTemplate", "remove"]);
  });
});

test("a runner whose directory is gone counts as finished, even one Runyard never saw exit", async () => {
  const s = await setup({ account: "acme", type: "Organization", repos: ["acme/app"] });
  await onDemand(s);
  await queue(s, 601);
  await round(s);
  const name = s.fakeGithub.jitConfigs[0]!.name;
  // It ended and removed its own directory while Runyard wasn't looking.
  s.host.jobs.delete(name);
  await round(s);
  expect(listDispatches(s.deps.db)[0]?.state).toBe("done");
});
