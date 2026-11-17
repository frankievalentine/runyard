import type { YardView, RunnerView } from "@runyard/core";

/** The top-level sections: the top nav on desktop, the tab bar on phones. */
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

/** Which phone tab a page sits under: Pools, Settings and More itself are under More. */
export function phoneTabFor(pathname: string): PhoneTabKey {
  const section = sectionFor(pathname);
  if (pathname.split("/")[1] === "more" || section === "pools" || section === "settings")
    return "more";
  return section;
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
