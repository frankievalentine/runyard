import type { YardView, RunnerView } from "@runyard/core";

/** The top-level sections: the sidebar on desktop, the tab bar on phones. */
export const SECTIONS = [
  { key: "board", label: "Board", to: "/" },
  { key: "jobs", label: "Jobs", to: "/queue" },
  { key: "machines", label: "Machines", to: "/machines" },
  { key: "pools", label: "Pools", to: "/pools" },
  { key: "settings", label: "Settings", to: "/settings/account" },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];

/** Phones: three sections and More, which holds Pools, Settings and the rest, as in the design. */
export const PHONE_TABS = [
  ...SECTIONS.slice(0, 3),
  { key: "more", label: "More", to: "/more" },
] as const;

export type PhoneTabKey = (typeof PHONE_TABS)[number]["key"];

/**
 * Which phone tab a page sits under: Pools, Settings and More itself are under More, and so is
 * anything opened from More (`from`, its links' history state), such as Add a machine.
 */
export function phoneTabFor(pathname: string, from?: "more"): PhoneTabKey {
  const section = sectionFor(pathname);
  if (from === "more") return "more";
  if (pathname.split("/")[1] === "more" || section === "pools" || section === "settings")
    return "more";
  return section;
}

/** The pages the More tab opens directly; on phones each leads back to More. */
const MORE_PAGES = new Set([
  "/pools",
  "/boat",
  "/settings",
  "/settings/account",
  "/settings/connections",
  "/settings/users",
]);

/**
 * A page's back link on phones: More, for a page More opened (or one it opens directly, however
 * you got there), else the page's own. Desktop has no More tab, so it keeps the page's own.
 */
export function phoneBack<T extends { to: string; label: string }>(
  pathname: string,
  from: "more" | undefined,
  own: T | undefined,
): T | { to: "/more"; label: "More" } | undefined {
  return from === "more" || MORE_PAGES.has(pathname) ? { to: "/more", label: "More" } : own;
}

/** Which section a page belongs to. Runners, tailnet devices and ignored machines sit under Machines;
 * boat.dev, the on-demand provider, under Pools. */
export function sectionFor(pathname: string): SectionKey {
  const first = pathname.split("/")[1] ?? "";
  if (first === "queue") return "jobs";
  if (["machines", "runners", "peers", "ignored"].includes(first)) return "machines";
  if (first === "pools" || first === "boat") return "pools";
  if (first === "settings") return "settings";
  return "board";
}

/** Narrows the yard by the Machines page filter: names, descriptions, addresses and OS. */
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
