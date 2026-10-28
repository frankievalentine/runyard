import type { YardView, RunnerView } from "@runyard/core";

/** A sidebar destination, in display order, for keyboard navigation. */
export type NavItem = { path: string; params?: Record<string, string> };

export function navKey(item: NavItem): string {
  return item.params ? `${item.path}:${Object.values(item.params).join(":")}` : item.path;
}

/** Narrows the yard by the sidebar filter: names, descriptions, addresses and OS. */
export function filterYard(view: YardView, query: string): YardView {
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
    runners: view.runners.filter((r) => match(r.name, r.scopeLabel, r.job?.repo, ...r.labels)),
  };
}

/** Runners not on a machine Runyard knows (and not on-demand), grouped by the account they serve. */
export function unassignedGroups(
  runners: RunnerView[],
): { key: string; label: string; runners: RunnerView[] }[] {
  const groups = new Map<string, { key: string; label: string; runners: RunnerView[] }>();
  for (const r of runners) {
    if (r.machineId || r.onDemand) continue;
    const account = r.scope.kind === "repo" ? r.scope.target.split("/")[0]! : r.scope.target;
    const key = `${r.forgeId}:${account.toLowerCase()}`;
    const group = groups.get(key) ?? {
      key,
      label: `${account} · ${r.forge === "forgejo" ? "Forgejo" : "GitHub"}`,
      runners: [],
    };
    group.runners.push(r);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Everything the sidebar shows, top to bottom, for keyboard navigation. */
export function flattenNav(view: YardView, otherOpen: boolean, runnersOpen = false): NavItem[] {
  const runner = (r: RunnerView) => ({ path: "/runners/$key", params: { key: r.key } });
  const boat = view.runners.filter((r) => r.onDemand === "boat.dev");
  return [
    { path: "/" },
    { path: "/queue" },
    ...view.machines.flatMap((m) => [
      { path: "/machines/$id", params: { id: m.id } },
      ...view.runners.filter((r) => r.machineId === m.id).map(runner),
    ]),
    ...view.pools.pools.map((p) => ({ path: "/pools/$id", params: { id: p.id } })),
    ...(view.boat || boat.length ? [{ path: "/boat" }, ...boat.map(runner)] : []),
    ...(runnersOpen ? unassignedGroups(view.runners).flatMap((g) => g.runners.map(runner)) : []),
    ...(otherOpen
      ? view.discovered.map((p) => ({ path: "/peers/$nodeId", params: { nodeId: p.nodeId } }))
      : []),
    ...(view.ignored.length ? [{ path: "/ignored" }] : []),
  ];
}
