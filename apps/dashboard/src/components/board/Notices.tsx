import { deriveIssues, type YardView } from "@runyard/core";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { checksQuery, sessionQuery } from "../../lib/queries.ts";
import { Icon } from "../icons.tsx";

/**
 * The Board's notices, like a station's service notices: active alerts first (red), then
 * everything else worth a look (yellow), then, for admins, what this Runyard host itself still
 * needs (quiet). Each opens the machine, runner or page it's about.
 * Beside the departure board it takes that board's height and scrolls inside.
 */
export function Notices({ view, besideBoard = false }: { view: YardView; besideBoard?: boolean }) {
  const navigate = useNavigate();
  const now = useNow();
  const issues = deriveIssues(view);
  const { data: session } = useSuspenseQuery(sessionQuery);
  const checks = useQuery({ ...checksQuery, enabled: session.user?.role === "admin" });
  const host = (checks.data ?? []).filter((c) => c.state === "warn" || c.state === "bad");
  const count = view.alerts.length + issues.length + host.length;
  return (
    <section
      aria-labelledby="notices-title"
      className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-tt-rule bg-tt-card ${besideBoard ? "[contain:size] max-lg:[contain:none]" : ""}`}
    >
      <header className="flex items-baseline justify-between gap-3 border-b border-tt-rule px-4 pt-3.5 pb-3">
        <h2 id="notices-title" className="text-[13px] font-extrabold tracking-[.08em] uppercase">
          Notices
        </h2>
        <span className="text-[12px] text-tt-ink-3">
          {count === 0
            ? "None"
            : view.alerts.length + issues.length === 0
              ? `${host.length} for this host`
              : count === 1
                ? "1 needs a look"
                : `${count} need a look`}
        </span>
      </header>
      <div className="scroll min-h-0 flex-1">
        {count === 0 && (
          <p className="px-4 py-4 text-[13px] text-tt-ink-2">
            Nothing needs you. Notices about machines and runners appear here.
          </p>
        )}
        {view.alerts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => void navigate({ to: "/machines/$id", params: { id: a.machineId } })}
            className="flex w-full gap-3 border-b border-tt-rule px-4 py-3 text-left last:border-b-0 hover:bg-tt-hover"
          >
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-tt-bad-bg text-tt-bad-ink">
              <Icon name="alert" size={13} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-bold">
                {a.machineName}: {a.kind === "offline" ? "offline" : "low disk space"}
                {a.muted ? " · maintenance" : ""}
              </span>
              <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-tt-ink-2">
                {a.detail}
              </span>
              <span className="mt-0.5 block text-[11.5px] text-tt-ink-3">
                Since {timeAgo(a.since, now)}
              </span>
            </span>
          </button>
        ))}
        {issues.map((issue) => {
          const target = issue.machineId || issue.page || issue.runnerKey;
          const go = () =>
            void (issue.machineId
              ? navigate({
                  to: "/machines/$id",
                  params: { id: issue.machineId },
                  hash: issue.hash,
                })
              : issue.runnerKey
                ? navigate({ to: "/runners/$key", params: { key: issue.runnerKey } })
                : navigate({ to: "/boat" }));
          const body = (
            <>
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-tt-warn-bg text-tt-warn-ink">
                <Icon name="alert" size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-bold">{issue.title}</span>
                <span
                  className="mt-0.5 line-clamp-2 block text-[12.5px] text-tt-ink-2"
                  title={issue.detail}
                >
                  {issue.detail}
                </span>
              </span>
            </>
          );
          const className =
            "flex w-full gap-3 border-b border-tt-rule px-4 py-3 text-left last:border-b-0";
          return target ? (
            <button
              key={issue.id}
              type="button"
              onClick={go}
              className={`${className} hover:bg-tt-hover`}
            >
              {body}
            </button>
          ) : (
            <div key={issue.id} className={className}>
              {body}
            </div>
          );
        })}
        {host.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => void navigate({ to: "/settings/connections" })}
            className="flex w-full gap-3 border-b border-tt-rule px-4 py-3 text-left last:border-b-0 hover:bg-tt-hover"
          >
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-tt-hover text-tt-ink-2">
              <Icon name="settings" size={13} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-bold">This host: {c.title}</span>
              <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-tt-ink-2">
                {c.fix ?? c.detail}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
