import { deriveIssues, type YardView } from "@runyard/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PHONE_TABS, type PhoneTabKey, type SectionKey } from "../lib/nav.ts";
import { healthQuery } from "../lib/queries.ts";
import { Icon, type IconName } from "./icons.tsx";
import { Logomark } from "./Logomark.tsx";
import { StationClock } from "./StationClock.tsx";
import { TimeAgo } from "./ui.tsx";

/** Each section's icon, shared with the desktop sidebar. */
export const ICONS: Record<SectionKey | PhoneTabKey, IconName> = {
  more: "more",
  board: "grid",
  jobs: "queue",
  machines: "machine",
  pools: "plan",
  settings: "settings",
};

/** Which Runyard this is: its tailnet name while it serves there, else the address in use. */
export function useWhere(): string {
  const tailnetHost = useQuery(healthQuery).data?.tailnetHost;
  return tailnetHost ? tailnetHost.replace(/\.ts\.net$/, "") : window.location.host;
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
