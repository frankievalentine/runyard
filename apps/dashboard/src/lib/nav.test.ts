import { expect, test } from "vite-plus/test";
import type { FleetView, RunnerView } from "@runyard/core";
import { filterFleet, flattenNav, navKey, unassignedGroups } from "./nav.ts";

const view = {
  generatedAt: 0,
  tailnet: { name: null, at: null, stale: false, error: null },
  machines: [
    {
      id: "m1",
      name: "Studio mini",
      description: "",
      sshTarget: "ci@mini",
      os: "macos",
      tailnet: null,
    },
    {
      id: "m2",
      name: "Linux builder",
      description: "Primary CI",
      sshTarget: "box",
      os: "linux",
      tailnet: null,
    },
  ],
  discovered: [{ nodeId: "n1", name: "lab-pi", address: "lab-pi.ts.net", os: "linux" }],
  ignored: [],
  alerts: [],
  github: {
    apps: [],
    runners: [],
    queue: { jobs: [], complete: true, at: null },
    summary: { runners: 0, busy: 0, idle: 0, offline: 0, unknown: 0 },
  },
  runners: [],
  boat: null,
  pools: { pools: [], desired: [], registrations: [], collisions: [] },
} as unknown as FleetView;

test("filters by name, description, address and OS", () => {
  expect(filterFleet(view, "primary").machines.map((m) => m.id)).toEqual(["m2"]);
  expect(filterFleet(view, "LINUX").machines.map((m) => m.id)).toEqual(["m2"]);
  expect(filterFleet(view, "linux").discovered).toHaveLength(1);
  expect(filterFleet(view, "  ")).toBe(view);
});

test("flattens the sidebar in display order, other machines only when open", () => {
  expect(flattenNav(view, false).map(navKey)).toEqual([
    "/",
    "/queue",
    "/machines/$id:m1",
    "/machines/$id:m2",
  ]);
  expect(flattenNav(view, true).map(navKey).at(-1)).toBe("/peers/$nodeId:n1");
  const withRunner = {
    ...view,
    runners: [
      {
        key: "gh:org:acme:1",
        forgeId: "gh",
        forge: "github",
        scope: { kind: "org", target: "acme" },
      },
    ],
  } as unknown as FleetView;
  expect(flattenNav(withRunner, false, true).map(navKey)).toContain("/runners/$key:gh:org:acme:1");
  const onDemand = {
    ...view,
    runners: [{ key: "boat-1", onDemand: "boat.dev" }],
  } as unknown as FleetView;
  expect(flattenNav(onDemand, false, false).map(navKey)).toContain("/runners/$key:boat-1");
  expect(flattenNav(withRunner, false, false).map(navKey)).not.toContain(
    "/runners/$key:gh:org:acme:1",
  );
  // A machine's own runners follow it.
  const linked = {
    ...view,
    runners: [{ key: "r1", machineId: "m1", scope: { kind: "org", target: "acme" } }],
  } as unknown as FleetView;
  expect(flattenNav(linked, false).map(navKey).slice(2, 5)).toEqual([
    "/machines/$id:m1",
    "/runners/$key:r1",
    "/machines/$id:m2",
  ]);
});

test("groups unassigned runners by account and forge", () => {
  const r = (
    key: string,
    forge: string,
    kind: string,
    target: string,
    machineId: string | null = null,
  ) =>
    ({
      key,
      forge,
      forgeId: forge,
      scope: { kind, target },
      machineId,
      onDemand: null,
    }) as unknown as RunnerView;
  const groups = unassignedGroups([
    r("a", "github", "repo", "frankie/site"),
    r("b", "github", "repo", "frankie/cli"),
    r("c", "forgejo", "org", "yard-club"),
    r("d", "github", "org", "acme", "m1"),
  ]);
  expect(groups.map((g) => [g.label, g.runners.map((x) => x.key)])).toEqual([
    ["frankie · GitHub", ["a", "b"]],
    ["yard-club · Forgejo", ["c"]],
  ]);
});
