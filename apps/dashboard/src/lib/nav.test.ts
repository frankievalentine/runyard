import { expect, test } from "vite-plus/test";
import type { FleetView } from "@runyard/core";
import { filterFleet, flattenNav, navKey } from "./nav.ts";

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
    github: { ...view.github, runners: [{ key: "gh:org:acme:1" }] },
  } as unknown as FleetView;
  expect(flattenNav(withRunner, false, true).map(navKey)).toContain("/runners/$key:gh:org:acme:1");
  expect(flattenNav(withRunner, false, false).map(navKey)).not.toContain(
    "/runners/$key:gh:org:acme:1",
  );
});
