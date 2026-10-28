import type { YardView } from "@runyard/core";
import { runnerFor } from "./pools.ts";

export type SetupStep = {
  id: "forge" | "machine" | "pool" | "runners";
  title: string;
  done: boolean;
  detail: string;
};

/** The Getting started steps, read from what's already set up. Nothing is stored. */
export function setupSteps(view: YardView): SetupStep[] {
  const githubReady = view.github.apps.some((a) => a.installations.length > 0);
  const forgejoReady = view.forgejo.connections.some((c) => !c.error);
  const reachable = view.machines.filter((m) => m.connection.state === "connected");
  const pools = view.pools.pools;
  const runners = view.pools.desired.filter((d) => runnerFor(view, d));
  return [
    {
      id: "forge",
      title: "Connect GitHub or Forgejo",
      done: githubReady || forgejoReady,
      detail: githubReady
        ? "GitHub is connected."
        : forgejoReady
          ? "Forgejo is connected."
          : view.github.apps.length
            ? "Install the GitHub App on the accounts whose repositories your runners serve."
            : "Create Runyard's GitHub App, or connect a Forgejo account.",
    },
    {
      id: "machine",
      title: "Add a machine",
      done: reachable.length > 0,
      detail: reachable.length
        ? `${reachable.length} reachable over SSH.`
        : view.machines.length
          ? "Runyard can't reach your machines over SSH yet. Open one to see why."
          : "Pick a device from your tailnet or enter any SSH target.",
    },
    {
      id: "pool",
      title: "Create a pool",
      done: pools.length > 0,
      detail: pools.length
        ? `${pools.map((p) => p.name).join(", ")}.`
        : "Choose labels, machines and the accounts or repositories to serve.",
    },
    {
      id: "runners",
      title: "Install runners",
      done: runners.length > 0,
      detail: runners.length
        ? `${runners.length} of ${view.pools.desired.length} runners registered.`
        : "Review a machine's changes, then run them.",
    },
  ];
}

/** The first machine with runners still to install, for the last step's link. */
export function machineToReview(view: YardView): string | null {
  return view.pools.desired.find((d) => !runnerFor(view, d))?.machineId ?? null;
}
