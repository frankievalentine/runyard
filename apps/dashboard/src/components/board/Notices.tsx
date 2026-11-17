import { deriveIssues, type YardView } from "@runyard/core";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode } from "react";
import { useExpandInPlace } from "../../lib/expand.ts";
import { checksQuery, sessionQuery } from "../../lib/queries.ts";
import { Icon } from "../icons.tsx";
import { SIcon, WithCode } from "../settings/parts.tsx";

/** How many notices show before "Show more". */
const SHOWN = 3;

type Notice = {
  key: string;
  level: "error" | "warn" | "host";
  title: string;
  body: string;
  /** A host notice's own icon: a key for the secret key, a loop for the service. */
  icon?: "key" | "refresh";
  open?: () => void;
};

/**
 * What this host still needs, as the design words it: what to do, not the check's name. The line
 * under it is the check's fix, or what it found when that says more.
 */
const HOST: Record<string, { title: string; icon?: "key" | "refresh"; body?: "detail" }> = {
  secretKey: { title: "Back up the secret key", icon: "key" },
  service: { title: "Keep Runyard running", icon: "refresh", body: "detail" },
  ssh: { title: "Install the OpenSSH client" },
  sshKey: { title: "Runyard's SSH key needs a look" },
  tailnet: { title: "Serve Runyard on your tailnet" },
  disk: { title: "Free up disk space on this host" },
};

/**
 * The Board's notices, like a station's service notices, as in the Timetable design: active
 * alerts (red), then everything else worth a look (yellow), then what this Runyard host still
 * needs (admins only, quiet). The first three show; the rest are one click away.
 */
export function Notices({ view }: { view: YardView }) {
  const navigate = useNavigate();
  const { all, toggle, list, style, scrolls, atEnd, onScroll } = useExpandInPlace(SHOWN);
  const { data: session } = useSuspenseQuery(sessionQuery);
  const checks = useQuery({ ...checksQuery, enabled: session.user?.role === "admin" });

  const notices: Notice[] = [
    ...view.alerts.map((a): Notice => ({
      key: a.id,
      level: "error",
      title: `${a.machineName}: ${a.kind === "offline" ? "offline" : "low disk space"}${a.muted ? " · maintenance" : ""}`,
      body: a.detail,
      open: () => void navigate({ to: "/machines/$id", params: { id: a.machineId } }),
    })),
    ...deriveIssues(view).map((issue): Notice => ({
      key: issue.id,
      level: issue.id.endsWith(":ssh") || issue.id === "tailnet" ? "error" : "warn",
      title: issue.title,
      body: issue.detail,
      open: issue.machineId
        ? () =>
            void navigate({
              to: "/machines/$id",
              params: { id: issue.machineId! },
              hash: issue.hash,
            })
        : issue.runnerKey
          ? () => void navigate({ to: "/runners/$key", params: { key: issue.runnerKey! } })
          : issue.page
            ? () => void navigate({ to: "/boat" })
            : undefined,
    })),
    ...(checks.data ?? [])
      .filter((c) => c.state === "warn" || c.state === "bad")
      .map((c): Notice => {
        const known = HOST[c.id];
        return {
          key: `host:${c.id}`,
          level: "host",
          title: known?.title ?? `This host: ${c.title}`,
          body: known?.body === "detail" ? c.detail : (c.fix ?? c.detail),
          icon: known?.icon,
          open: () => void navigate({ to: "/settings/account", hash: "host" }),
        };
      }),
  ];
  const shown = all ? notices : notices.slice(0, SHOWN);
  const more = notices.length - shown.length;
  const hostOnly = notices.length > 0 && notices.every((n) => n.level === "host");

  return (
    <section
      aria-labelledby="notices-title"
      className="flex min-w-0 flex-col rounded-xl border border-tt-rule bg-tt-card"
    >
      <header className="flex items-baseline justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <h2 id="notices-title" className="text-[13px] font-extrabold tracking-[.06em] uppercase">
          Notices
        </h2>
        <span className="text-[12.5px] text-tt-ink-3">
          {notices.length === 0
            ? "None"
            : hostOnly
              ? `${notices.length} for this host`
              : `${notices.length} need attention`}
        </span>
      </header>
      {/* Opened on desktop, the list scrolls at its collapsed height, with a fade while there's more. */}
      <div className="relative">
        <div
          ref={list}
          style={style}
          onScroll={onScroll}
          className={`relative flex flex-col px-2 pb-2 ${scrolls ? "scroll overscroll-contain" : ""}`}
        >
          {notices.length === 0 && (
            <p className="px-2 pb-2 text-[13px] text-tt-ink-2">
              Nothing needs you. Notices about machines and runners appear here.
            </p>
          )}
          {shown.map((n, i) => {
            const body: ReactNode = (
              <>
                <span
                  className={`flex size-[26px] flex-none items-center justify-center rounded ${
                    n.level === "error"
                      ? "bg-tt-bad text-white"
                      : n.level === "warn"
                        ? "bg-tt-signal text-tt-on-signal"
                        : "bg-tt-hover text-tt-ink-2"
                  }`}
                >
                  {n.icon === "key" ? (
                    <SIcon name="key" size={15} />
                  ) : (
                    <Icon
                      name={
                        n.icon === "refresh" ? "refresh" : n.level === "host" ? "settings" : "alert"
                      }
                      size={15}
                    />
                  )}
                </span>
                <span className="min-w-0">
                  <b className="block text-[13.5px] leading-[1.3] font-bold">{n.title}</b>
                  <small className="mt-0.5 line-clamp-2 block text-[12.5px] leading-[1.35] text-tt-ink-2">
                    <WithCode text={n.body} />
                  </small>
                </span>
              </>
            );
            const className = `flex w-full items-start gap-3 px-2 py-2.5 text-left ${
              i > 0 ? "border-t border-tt-rule" : "rounded-lg"
            }`;
            return n.open ? (
              <button
                key={n.key}
                type="button"
                onClick={n.open}
                className={`${className} hover:bg-tt-hover`}
              >
                {body}
              </button>
            ) : (
              <div key={n.key} className={className}>
                {body}
              </div>
            );
          })}
        </div>
        {scrolls && !atEnd && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-tt-card to-transparent"
          />
        )}
      </div>
      {hostOnly && (
        <p className="mx-4 border-t border-tt-rule pt-3 pb-3.5 text-[12.5px] text-tt-ink-3">
          Nothing else needs you. Notices about machines and jobs appear here.
        </p>
      )}
      {(more > 0 || all) && notices.length > SHOWN && (
        <div className="flex items-baseline justify-between gap-3 px-4 pt-1 pb-3 text-[12.5px]">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={all}
            className="text-left font-semibold text-tt-ink-2 hover:text-tt-ink"
          >
            {all ? "Show fewer notices" : `Show ${more} more ${more === 1 ? "notice" : "notices"}`}
          </button>
          {scrolls && !atEnd && (
            <span className="text-tt-ink-3">
              Scroll for more <span aria-hidden>↓</span>
            </span>
          )}
        </div>
      )}
    </section>
  );
}
