import { deriveIssues, type YardView } from "@runyard/core";
import { Link } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { SECTIONS, type SectionKey } from "../lib/nav.ts";
import { useSidebar } from "../lib/sidebar.ts";
import { Icon } from "./icons.tsx";
import { RowTip, TipText } from "./InfoTip.tsx";
import { Logomark } from "./Logomark.tsx";
import { ICONS, useWhere } from "./PhoneNav.tsx";
import { StationClock } from "./StationClock.tsx";
import { StatusDot, TimeAgo } from "./ui.tsx";

/** The width and labels animate together; reduced motion skips both. */
const EASE = "duration-[340ms] ease-[cubic-bezier(.6,0,.2,1)] motion-reduce:transition-none";

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

/** Whether a key press is someone typing, which the sidebar's shortcut leaves alone. */
function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return Boolean(t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)));
}

/**
 * Desktop: a floating card on the left, styled like the Board's panels. It holds the five
 * sections, the clock with the data sources' state, the yard's size and Check now. Signing out and
 * the theme are in Settings. The arrow button or the [ key collapses it to an icon rail; the choice is remembered.
 */
export function Sidebar({
  view,
  section,
  demo,
  checking,
  onCheck,
}: {
  view: YardView;
  section: SectionKey;
  demo: boolean;
  checking: boolean;
  onCheck: () => void;
}) {
  const [collapsed, toggle] = useSidebar();
  const where = useWhere();
  const attention = deriveIssues(view).length;
  const status = sourceStatus(view, demo);
  const machines = view.machines.length;
  const runners = view.summary.runners;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Labels stay in the page while collapsed, so screen readers still hear them; they fade and fold away.
  // Collapsing, the text fades out quickly before anything narrows around it; expanding, it fades in
  // once there is room.
  const fold = `overflow-hidden whitespace-nowrap motion-reduce:transition-none ${
    collapsed
      ? "max-w-0 opacity-0 [transition:opacity_90ms_ease-out,max-width_340ms_cubic-bezier(.6,0,.2,1)]"
      : "max-w-[150px] opacity-100 [transition:opacity_200ms_ease-in_140ms,max-width_340ms_cubic-bezier(.6,0,.2,1)]"
  }`;
  const toggleLabel = `${collapsed ? "Expand" : "Collapse"} the sidebar ( [ )`;

  return (
    <aside
      aria-label="Runyard"
      className={`my-[18px] ml-[18px] flex shrink-0 flex-col overflow-hidden rounded-xl border border-tt-rule bg-tt-card px-2.5 py-3 transition-[width] ${EASE} ${
        collapsed ? "w-[68px]" : "w-[212px]"
      }`}
    >
      <div
        className={`flex ${collapsed ? "flex-col items-center gap-2.5" : "min-h-10 items-center gap-2.5 px-[3px]"}`}
      >
        <Link
          to="/"
          aria-label="Board"
          // No gap while collapsed: the folded name would still push the logo off center.
          className={`flex min-w-0 items-center ${collapsed ? "" : "flex-1 gap-2.5"}`}
        >
          <Logomark size={32} small />
          <span className={`min-w-0 leading-tight ${fold}`}>
            <span className="block text-[17px] font-extrabold tracking-[.01em] [font-stretch:85%]">
              Runyard
            </span>
            <span className="block truncate text-[12px] text-tt-ink-3">{where}</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          className="grid size-[30px] shrink-0 place-items-center rounded-lg border border-tt-rule text-tt-ink-2 hover:bg-tt-hover hover:text-tt-ink"
        >
          <span className={`flex transition-transform ${EASE} ${collapsed ? "" : "rotate-180"}`}>
            <Icon name="chevron" size={16} />
          </span>
        </button>
      </div>

      <div
        className={`mx-2.5 mt-[18px] mb-2 text-[10.5px] leading-none font-semibold tracking-[.12em] text-tt-ink-3 uppercase transition-opacity ${EASE} ${
          collapsed ? "opacity-0" : ""
        }`}
        aria-hidden
      >
        Pages
      </div>
      <nav aria-label="Sections" className="flex flex-col gap-0.5">
        {SECTIONS.map((s) => {
          const on = section === s.key;
          return (
            <Link
              key={s.key}
              to={s.to}
              aria-current={on ? "page" : undefined}
              title={collapsed ? s.label : undefined}
              className={`relative flex h-[42px] items-center rounded-[9px] text-[15px] ${
                collapsed ? "px-[14px]" : "gap-3 px-3"
              } ${on ? "bg-tt-paper font-bold text-tt-ink" : "font-semibold text-tt-ink-2 hover:bg-tt-hover hover:text-tt-ink"}`}
            >
              <span
                aria-hidden
                className={`absolute top-[9px] bottom-[9px] left-0 w-[3px] rounded-r-[3px] bg-tt-loco transition-transform duration-200 motion-reduce:transition-none ${
                  on ? "scale-y-100" : "scale-y-0"
                }`}
              />
              <span className={`flex shrink-0 ${on ? "text-tt-loco" : ""}`}>
                <Icon name={ICONS[s.key]} size={18} />
              </span>
              <span className={fold}>{s.label}</span>
              {s.key === "board" && attention > 0 && (
                <RowTip
                  side="right"
                  content={
                    <TipText
                      what={`${attention} ${attention === 1 ? "problem" : "problems"} with your machines or Tailscale. They're among the Board's Notices.`}
                    />
                  }
                >
                  <span
                    className={`inline-flex items-center justify-center rounded bg-tt-signal font-board leading-none font-bold text-tt-on-signal tabular ${
                      collapsed
                        ? "absolute top-1 left-[25px] min-w-4 px-1 py-0.5 text-[10px]"
                        : "ml-auto min-w-5 px-1.5 py-[3px] text-[12px]"
                    }`}
                  >
                    <span aria-hidden>{attention}</span>
                    <span className="sr-only">, {attention} need a look</span>
                  </span>
                </RowTip>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col items-stretch gap-2.5 border-t border-tt-rule pt-3.5">
        <div className="flex justify-center">
          {collapsed ? (
            <span
              className="relative"
              title={
                status.tone === "warn"
                  ? "Something needs attention"
                  : status.tone === "muted"
                    ? "No forge connected"
                    : "Runyard is up to date"
              }
            >
              <StationClock size={44} digital={false} />
              <span className="absolute -top-0.5 -right-0.5 grid place-items-center rounded-full bg-tt-card p-[3px]">
                <StatusDot tone={status.tone} hollow={status.tone === "muted"} size={7} />
              </span>
            </span>
          ) : (
            <StationClock
              size={44}
              sub={
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <StatusDot tone={status.tone} hollow={status.tone === "muted"} size={6} />
                  {status.text}
                </span>
              }
            />
          )}
        </div>
        {/* Out of the layout while collapsed, so the clock and Check now keep the footer's one gap. */}
        <div
          className={`self-center text-center text-[12px] text-tt-ink-3 ${collapsed ? "hidden" : fold}`}
        >
          {machines} {machines === 1 ? "machine" : "machines"} · {runners}{" "}
          {runners === 1 ? "runner" : "runners"}
        </div>
        <button
          type="button"
          disabled={checking}
          onClick={onCheck}
          title={collapsed ? "Check now" : undefined}
          className={`inline-flex h-9 min-w-0 items-center justify-center rounded-lg border border-tt-rule-2 bg-tt-card text-[13.5px] font-semibold whitespace-nowrap text-tt-ink hover:bg-tt-hover disabled:opacity-50 ${
            collapsed ? "w-9 self-center overflow-hidden" : "gap-2 px-3"
          }`}
        >
          <Icon name="refresh" size={14} />
          {/* Sits a touch lower, so the label reads as centered on the icon. The button snaps to its
              icon's size when collapsing, so the label goes at once (still read aloud) rather than
              fading inside a button too narrow for it. */}
          <span className={collapsed ? "sr-only" : `mt-px ${fold}`}>
            {checking ? "Checking…" : "Check now"}
          </span>
        </button>
      </div>
    </aside>
  );
}
