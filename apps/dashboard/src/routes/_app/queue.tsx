import { createFileRoute, Link } from "@tanstack/react-router";
import { Dispatches } from "../../components/Dispatches.tsx";
import { Jobs, useJobs } from "../../components/Jobs.tsx";
import { Icon } from "../../components/icons.tsx";
import {
  emptyQueueText,
  forgesConnected,
  QueueList,
  RunnerLine,
} from "../../components/runners.tsx";
import { Card, EmptyLine, PageHeader, Section } from "../../components/ui.tsx";
import { useState } from "react";
import { useYard } from "../../lib/yard.ts";
import { timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";

const RECENT_MS = 30 * 60_000;

export const Route = createFileRoute("/_app/queue")({
  component: Queue,
});

type Tab = "running" | "waiting" | "history";

/** Jobs: what's running, what's waiting (aarondfrancis/fleet's QueueDetail) and the last 7 days. */
function Queue() {
  const view = useYard();
  const running = view.runners.filter((r) => r.activity === "busy");
  const history = useJobs({});
  const total = history.data
    ? Object.values(history.data.counts).reduce((a, b) => a + b, 0)
    : undefined;
  const [tab, setTab] = useState<Tab>(
    running.length || !view.queue.jobs.length ? "running" : "waiting",
  );
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "running", label: "On their way", count: running.length },
    { key: "waiting", label: "Waiting", count: view.queue.jobs.length },
    { key: "history", label: "Last 7 days", count: total },
  ];
  return (
    <div>
      <PageHeader
        title="Jobs"
        subtitle="Everything on the board, plus what finished this week. Select a job to open its runner or see why it waits."
      />
      <div role="tablist" aria-label="Jobs" className="mt-6 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[14px] font-semibold ${
              tab === t.key ? "bg-tt-inv text-tt-on-inv" : "text-tt-ink hover:bg-tt-hover"
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={`min-w-5 rounded px-1.5 py-[3px] text-center font-mono text-[12px] leading-none font-bold tabular ${
                  tab === t.key
                    ? "bg-tt-signal text-tt-on-signal"
                    : t.count === 0
                      ? "bg-tt-hover text-tt-ink-3"
                      : "bg-tt-rule text-tt-ink"
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="mt-4">
        {tab === "running" && (
          <Card className="overflow-hidden">
            {running.length === 0 ? (
              <EmptyLine>
                {forgesConnected(view)
                  ? "No runner is working right now."
                  : "Connect GitHub or Forgejo to see running jobs."}
              </EmptyLine>
            ) : (
              running.map((r) => <RunnerLine key={r.key} r={r} />)
            )}
          </Card>
        )}
        {tab === "waiting" && <Waiting />}
        {tab === "history" && (
          <div className="-mt-8">
            <Jobs filter={{}} showMachine />
          </div>
        )}
      </div>
    </div>
  );
}

/** Jobs waiting for a self-hosted runner, with why, and one-job runners just started for them. */
function Waiting() {
  const view = useYard();
  const now = useNow();
  const q = view.queue;
  const connected = forgesConnected(view);
  // A job leaves the queue once a runner takes it; on-demand ones often within the minute.
  const recent = view.pools.dispatches.filter(
    (d) => d.state === "starting" || d.state === "running" || now - d.startedAt < RECENT_MS,
  );
  // Their jobs' results, from run history.
  const jobs = useJobs({});
  return (
    <div>
      {q.at && <p className="mb-3 text-[12.5px] text-ink-2">Checked {timeAgo(q.at, now)}</p>}
      <div>
        {q.jobs.length ? (
          <QueueList view={view} />
        ) : (
          <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <span className="flex size-10 items-center justify-center rounded-lg border border-line bg-sunken text-ink-2">
              <Icon name="inbox" size={20} />
            </span>
            <div className="space-y-1">
              <p className="text-[14px] font-medium">{emptyQueueText(view)}</p>
              <p className="max-w-sm text-[13px] leading-relaxed text-ink-2">
                {!connected ? (
                  <>
                    Create Runyard's GitHub App in{" "}
                    <Link to="/settings/github" className="text-accent hover:underline">
                      Settings ▸ GitHub
                    </Link>{" "}
                    or connect an account in{" "}
                    <Link to="/settings/forgejo" className="text-accent hover:underline">
                      Settings ▸ Forgejo
                    </Link>{" "}
                    to see queued and running jobs.
                  </>
                ) : q.complete ? (
                  "The scanned repositories have no jobs waiting for a self-hosted runner."
                ) : (
                  "Waiting for a complete job scan."
                )}
              </p>
            </div>
          </Card>
        )}
      </div>
      {recent.length > 0 && (
        <Section title="Recently started" count={recent.length}>
          <p className="-mt-1 mb-2 text-[12px] text-ink-2">
            One-job runners Runyard started for queued jobs in the last half hour; their jobs leave
            the list above once a runner takes them.
          </p>
          <Dispatches dispatches={recent.slice(0, 10)} jobs={jobs.data?.jobs ?? []} showPool />
        </Section>
      )}
      <div className="mt-4 space-y-1.5 text-[12px] text-ink-2">
        {!q.complete && connected && (
          <p className="text-warn">
            This list may be incomplete: job data is missing or stale, or an installation has more
            repositories than Runyard scans (the 30 most recently pushed).
          </p>
        )}
        <p>
          "Matching" means the runner has every label the job asks for. Runner-group access rules
          can still keep a job off a runner; GitHub's API doesn't expose that per job. Forgejo lists
          only jobs waiting for a runner, not which runner took one.
        </p>
      </div>
    </div>
  );
}
