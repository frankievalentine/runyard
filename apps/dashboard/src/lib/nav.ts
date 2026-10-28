import type { FleetView } from "@runyard/core";

/** A sidebar destination, in display order, for keyboard navigation. */
export type NavItem = { path: string; params?: Record<string, string> };

export function navKey(item: NavItem): string {
  return item.params ? `${item.path}:${Object.values(item.params).join(":")}` : item.path;
}

/** Narrows the fleet by the sidebar filter: names, descriptions, addresses and OS. */
export function filterFleet(view: FleetView, query: string): FleetView {
  const q = query.trim().toLowerCase();
  if (!q) return view;
  const match = (...values: (string | null | undefined)[]) =>
    values.some((v) => v?.toLowerCase().includes(q));
  return {
    ...view,
    machines: view.machines.filter((m) =>
      match(m.name, m.description, m.sshTarget, m.os, m.tailnet?.address),
    ),
    discovered: view.discovered.filter((p) => match(p.name, p.address, p.os)),
    ignored: view.ignored.filter((p) => match(p.name, p.address, p.os)),
    github: {
      ...view.github,
      runners: view.github.runners.filter((r) =>
        match(r.name, r.scopeLabel, r.job?.repo, ...r.labels),
      ),
    },
  };
}

/** Everything the sidebar shows, top to bottom. */
export function flattenNav(view: FleetView, otherOpen: boolean, runnersOpen = false): NavItem[] {
  return [
    { path: "/" },
    { path: "/queue" },
    ...view.machines.map((m) => ({ path: "/machines/$id", params: { id: m.id } })),
    ...(runnersOpen
      ? view.github.runners.map((r) => ({ path: "/runners/$key", params: { key: r.key } }))
      : []),
    ...(otherOpen
      ? view.discovered.map((p) => ({ path: "/peers/$nodeId", params: { nodeId: p.nodeId } }))
      : []),
    ...(view.ignored.length ? [{ path: "/ignored" }] : []),
  ];
}
