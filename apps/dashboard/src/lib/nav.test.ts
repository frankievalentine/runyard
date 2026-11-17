import { expect, test } from "vite-plus/test";
import type { YardView, RunnerView } from "@runyard/core";
import { filterYard, sectionFor, unassignedGroups } from "./nav.ts";

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
} as unknown as YardView;

test("filters by name, description, address and OS", () => {
  expect(filterYard(view, "primary").machines.map((m) => m.id)).toEqual(["m2"]);
  expect(filterYard(view, "LINUX").machines.map((m) => m.id)).toEqual(["m2"]);
  expect(filterYard(view, "linux").discovered).toHaveLength(1);
  expect(filterYard(view, "  ")).toBe(view);
});

test("puts every page in its top-level section", () => {
  expect(sectionFor("/")).toBe("board");
  expect(sectionFor("/queue")).toBe("jobs");
  expect(sectionFor("/machines")).toBe("machines");
  expect(sectionFor("/machines/add")).toBe("machines");
  expect(sectionFor("/machines/m1")).toBe("machines");
  expect(sectionFor("/runners/gh%3Aorg%3Aacme%3A1")).toBe("machines");
  expect(sectionFor("/peers/n1")).toBe("machines");
  expect(sectionFor("/ignored")).toBe("machines");
  expect(sectionFor("/pools")).toBe("pools");
  expect(sectionFor("/pools/new")).toBe("pools");
  expect(sectionFor("/boat")).toBe("pools");
  expect(sectionFor("/settings/github")).toBe("settings");
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
