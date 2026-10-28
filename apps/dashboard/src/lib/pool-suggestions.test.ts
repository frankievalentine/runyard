import type { FleetView } from "@runyard/core";
import { expect, test } from "vite-plus/test";
import { slug, suggestPools } from "./pool-suggestions.ts";

const machine = (id: string, name: string, os: string | null) => ({
  id,
  name,
  os,
  connection: { state: "connected" },
});
const base = {
  machines: [
    machine("m1", "Studio mini", "macos"),
    machine("m2", "Linux builder", "linux"),
    machine("m3", "Lab", null),
  ],
  github: {
    apps: [
      {
        forgeId: "gh",
        installations: [{ accountType: "Organization", account: "acme", repos: [] }],
      },
    ],
  },
  forgejo: {
    connections: [
      {
        forgeId: "fj",
        baseUrl: "https://forgejo.test",
        scopes: [{ kind: "user", target: "frankie" }],
      },
    ],
  },
  queue: { jobs: [] },
  pools: { pools: [], desired: [], registrations: [], collisions: [] },
} as unknown as FleetView;

test("queued jobs no runner matches suggest a pool on machines of their OS", () => {
  const view = {
    ...base,
    queue: {
      jobs: [
        {
          id: 1,
          forge: "github",
          repo: "acme/app",
          labels: ["self-hosted", "macOS", "xcode"],
          eligible: [],
          onDemand: null,
        },
        {
          id: 2,
          forge: "github",
          repo: "acme/web",
          labels: ["self-hosted", "macOS", "xcode"],
          eligible: [],
          onDemand: null,
        },
        // Matched, or boat.dev's: not this fleet's to fill.
        {
          id: 3,
          forge: "github",
          repo: "acme/app",
          labels: ["self-hosted"],
          eligible: ["r1"],
          onDemand: null,
        },
        {
          id: 4,
          forge: "github",
          repo: "acme/app",
          labels: ["boat"],
          eligible: [],
          onDemand: "boat.dev",
        },
      ],
    },
  } as unknown as FleetView;
  const [first] = suggestPools(view);
  expect(first).toMatchObject({
    title: "2 queued jobs wait for xcode",
    draft: {
      name: "xcode",
      labels: ["xcode"],
      machines: [{ machineId: "m1", slots: 1 }],
      scopes: [{ forgeId: "gh", kind: "org", target: "acme" }],
    },
  });
});

test("a job asking only for an OS reads as needing that OS; its machines aren't suggested twice", () => {
  const view = {
    ...base,
    queue: {
      jobs: [
        {
          id: 9,
          forge: "github",
          repo: "acme/app",
          labels: ["self-hosted", "macOS"],
          eligible: [],
          onDemand: null,
        },
      ],
    },
  } as unknown as FleetView;
  const suggestions = suggestPools(view);
  expect(suggestions[0]?.title).toBe("1 queued job waits for a macOS runner");
  expect(suggestions.map((s) => s.id)).toEqual([suggestions[0]!.id, "os:linux"]);
});

test("machines without a pool get one suggestion per OS; Forgejo only on Linux", () => {
  const suggestions = suggestPools(base);
  expect(suggestions.map((s) => s.id)).toEqual(["os:linux", "os:macos"]);
  expect(suggestions[0]!.draft.scopes.map((s) => s.forgeId)).toEqual(["gh", "fj"]);
  expect(suggestions[1]!.draft.scopes.map((s) => s.forgeId)).toEqual(["gh"]);
  // A name already taken gets a suffix.
  const taken = {
    ...base,
    pools: { ...base.pools, pools: [{ id: "p", name: "linux", machines: [] }] },
  } as unknown as FleetView;
  expect(suggestPools(taken)[0]!.draft.name).toBe("linux-2");
});

test("slug makes a valid pool name", () => {
  expect(slug("Xcode 16 / iOS")).toBe("xcode-16-ios");
});
