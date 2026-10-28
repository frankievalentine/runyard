import type { YardView } from "@runyard/core";
import { expect, test } from "vite-plus/test";
import { machineToReview, setupSteps } from "./setup.ts";

const empty = {
  machines: [],
  github: { apps: [] },
  forgejo: { connections: [] },
  runners: [],
  pools: { pools: [], desired: [], registrations: [], collisions: [], templateRecords: [] },
} as unknown as YardView;

test("a fresh install has nothing done", () => {
  expect(setupSteps(empty).map((s) => s.done)).toEqual([false, false, false, false]);
});

test("steps follow what exists", () => {
  const scope = { forgeId: "fj_1", kind: "user", target: "frankie" };
  const view = {
    ...empty,
    forgejo: { connections: [{ forgeId: "fj_1", error: null }] },
    machines: [{ id: "m1", connection: { state: "connected" } }],
    pools: {
      pools: [{ id: "p1", name: "ci" }],
      desired: [
        { machineId: "m1", name: "box-ci-01", scope },
        { machineId: "m1", name: "box-ci-02", scope },
      ],
      registrations: [],
      collisions: [],
      templateRecords: [],
    },
    runners: [{ name: "box-ci-01", scope }],
  } as unknown as YardView;
  const steps = setupSteps(view);
  expect(steps.map((s) => s.done)).toEqual([true, true, true, true]);
  expect(steps[3]?.detail).toBe("1 of 2 runners registered.");
  expect(machineToReview(view)).toBe("m1");
});

test("an app without installations isn't connected yet", () => {
  const view = { ...empty, github: { apps: [{ installations: [] }] } } as unknown as YardView;
  expect(setupSteps(view)[0]).toMatchObject({
    done: false,
    detail: expect.stringContaining("Install the GitHub App"),
  });
});

test("installed runner software for an on-demand pool completes the last step", () => {
  const view = {
    ...empty,
    pools: { ...empty.pools, templateRecords: [{ key: "t" }] },
  } as unknown as YardView;
  expect(setupSteps(view)[3]).toMatchObject({
    done: true,
    detail: "Runner software installed for on-demand pools.",
  });
});
