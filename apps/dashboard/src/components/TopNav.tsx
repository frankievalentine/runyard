import { deriveIssues, type YardView } from "@runyard/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PHONE_TABS, SECTIONS, type PhoneTabKey, type SectionKey } from "../lib/nav.ts";
import { healthQuery } from "../lib/queries.ts";
import { AccountMenu } from "./AccountMenu.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { Logomark } from "./Logomark.tsx";
import { StationClock } from "./StationClock.tsx";
import { StatusDot, TimeAgo } from "./ui.tsx";

const ICONS: Record<SectionKey | PhoneTabKey, IconName> = {
  more: "more",
  board: "grid",
  jobs: "queue",
  machines: "machine",
  pools: "plan",
  settings: "settings",
};

/** A count beside a nav label or tab: things on the Board that need someone. */
function CountPill({ n }: { n: number }) {
  return (
    <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded bg-tt-signal px-1.5 py-[3px] font-board text-[12px] leading-none font-bold text-tt-on-signal tabular">
      {n}
    </span>
  );
}

/** Which Runyard this is: its tailnet name while it serves there, else the address in use. */
function useWhere(): string {
  const tailnetHost = useQuery(healthQuery).data?.tailnetHost;
  return tailnetHost ? tailnetHost.replace(/\.ts\.net$/, "") : window.location.host;
}

/** The state of Runyard's data sources, most pressing first. Details are on the Board and in Settings. */
function sourceStatus(
  view: YardView,
  demo: boolean,
): { tone: "ok" | "warn" | "muted"; text: ReactNode } {
  const apps = view.github.apps;
  const conns = view.forgejo.connections;
  const forgeError =
    apps.some((a) => a.error || a.installations.some((i) => i.runnersError)) ||
    // Forgejo refuses organization runners unless the user owns the organization, so only a
    // connection that fails outright counts here.
    conns.some((c) => c.error);
  const checked = [
    ...apps.flatMap((a) => a.installations.map((i) => i.runnersAt)),
    ...conns.flatMap((c) => c.scopes.map((s) => s.runnersAt)),
  ]
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b)[0];
  const problem = Boolean(view.tailnet.error) || forgeError || view.alerts.length > 0;
  const tone = problem ? "warn" : !demo && !apps.length && !conns.length ? "muted" : "ok";
  if (demo) return { tone, text: "Demo data" };
  if (forgeError)
    return {
      tone,
      text: (
        <Link to="/settings/connections" className="hover:underline">
          A forge can't be read
        </Link>
      ),
    };
  if (view.tailnet.error) return { tone, text: "Tailscale unavailable" };
  if (checked)
    return {
      tone,
      text: (
        <>
          Checked <TimeAgo at={checked} />
        </>
      ),
    };
  if (apps.length || conns.length) return { tone, text: "Waiting for the forges" };
  return {
    tone,
    text: (
      <Link to="/settings/connections" className="hover:underline">
        No forge connected
      </Link>
    ),
  };
}

/** Desktop: logo, the five sections, the data sources' state, Check now, the clock and the account menu. */
export function TopNav({
  view,
  section,
  demo,
  checkNow,
}: {
  view: YardView;
  section: SectionKey;
  demo: boolean;
  checkNow: ReactNode;
}) {
  const where = useWhere();
  const attention = deriveIssues(view).length;
  const status = sourceStatus(view, demo);
  return (
    <header className="flex h-[68px] shrink-0 items-center gap-7 border-b border-tt-rule bg-tt-card px-6">
      <Link to="/" className="flex min-w-0 items-center gap-3">
        <Logomark size={32} small />
        <span className="min-w-0 leading-tight">
          <span className="block text-[17px] font-extrabold tracking-[.01em] [font-stretch:85%]">
            Runyard
          </span>
          <span className="block truncate text-[12px] text-tt-ink-3">
            {where} · {view.machines.length} {view.machines.length === 1 ? "machine" : "machines"} ·{" "}
            {view.summary.runners} {view.summary.runners === 1 ? "runner" : "runners"}
          </span>
        </span>
      </Link>
      <nav aria-label="Sections" className="flex gap-1">
        {SECTIONS.map((s) => (
          <Link
            key={s.key}
            to={s.to}
            aria-current={section === s.key ? "page" : undefined}
            className={`inline-flex items-center rounded-lg px-4 py-2.5 text-[16px] leading-none font-[650] ${
              section === s.key ? "bg-tt-inv text-tt-on-inv" : "text-tt-ink hover:bg-tt-hover"
            }`}
          >
            {s.label}
            {s.key === "board" && attention > 0 && <CountPill n={attention} />}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-4">
        <span className="hidden items-center gap-2 text-[12.5px] text-tt-ink-2 xl:flex">
          <StatusDot tone={status.tone} hollow={status.tone === "muted"} size={6} />
          {status.text}
        </span>
        {checkNow}
        <StationClock
          sub={
            <>
              Last check <TimeAgo at={view.generatedAt} />
            </>
          }
        />
        <AccountMenu />
      </div>
    </header>
  );
}

/** Phone: the design's header: the logo, which Runyard and when it last checked, and the clock. */
export function PhoneHeader({ view }: { view: YardView }) {
  const where = useWhere();
  return (
    <header className="flex shrink-0 items-center gap-2.5 border-b border-tt-rule bg-tt-card px-4 pt-[max(6px,env(safe-area-inset-top,0px))] pb-3">
      <Link to="/" aria-label="Board" className="flex min-w-0 flex-1 items-center gap-2.5">
        <Logomark size={30} small />
        <span className="min-w-0 leading-none">
          <span className="block text-[18px] font-extrabold [font-stretch:80%]">Runyard</span>
          <span className="mt-0.5 block truncate text-[11.5px] text-tt-ink-3">
            {where} · checked <TimeAgo at={view.generatedAt} />
          </span>
        </span>
      </Link>
      <StationClock face={false} />
    </header>
  );
}

/** Phone: Board, Jobs, Machines and More as a tab bar along the bottom, clear of the home indicator. */
export function TabBar({ view, tab }: { view: YardView; tab: PhoneTabKey }) {
  const attention = deriveIssues(view).length;
  return (
    <nav
      aria-label="Sections"
      className="grid shrink-0 grid-cols-4 border-t border-tt-rule bg-tt-card px-1.5 pt-1.5 pb-[max(10px,env(safe-area-inset-bottom,0px))]"
    >
      {PHONE_TABS.map((s) => (
        <Link
          key={s.key}
          to={s.to}
          aria-current={tab === s.key ? "page" : undefined}
          className={`relative flex flex-col items-center gap-1 py-1.5 text-[11.5px] font-bold ${
            tab === s.key ? "text-tt-ink" : "text-tt-ink-2"
          }`}
        >
          {tab === s.key && (
            <span className="absolute -top-1.5 h-[3px] w-8 rounded-b bg-tt-ink" aria-hidden />
          )}
          <Icon name={ICONS[s.key]} size={20} />
          {s.label}
          {s.key === "board" && attention > 0 && (
            <span className="absolute top-0.5 left-[calc(50%+5px)] grid h-[17px] min-w-[17px] place-items-center rounded-full bg-tt-signal px-1 font-ui text-[10.5px] leading-none font-extrabold text-tt-on-signal tabular">
              {attention}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
