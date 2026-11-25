import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Dispatches } from "../../components/Dispatches.tsx";
import { useJobs } from "../../components/Jobs.tsx";
import { Icon } from "../../components/icons.tsx";
import { InfoTip, TipText } from "../../components/InfoTip.tsx";
import { JobsEmpty, TabsRow, Toggle } from "../../components/jobs/parts.tsx";
import {
  HistoryTable,
  RunningTable,
  WaitingTable,
  WhyWaitingTip,
} from "../../components/jobs/tables.tsx";
import { emptyQueueText, forgesConnected } from "../../components/runners.tsx";
import { PageHead, Panel, ttButton } from "../../components/tt.tsx";
import { ErrorText } from "../../components/ui.tsx";
import { timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { useYard } from "../../lib/yard.ts";

const RECENT_MS = 30 * 60_000;
const PAGE = 25;

export const Route = createFileRoute("/_app/queue")({
  component: Queue,
});

type Tab = "running" | "waiting" | "history";

/**
 * Jobs, as in the Timetable design: tabs for what's on its way, what's waiting and why, and the
 * last 7 days, each a table (rows on phones). Waiting adds one-job runners just started. What the
 * page and its columns mean is in their tooltips.
 */
function Queue() {
  const view = useYard();
  const running = view.runners.filter((r) => r.activity === "busy");
  const all = useJobs({});
  const total = all.data ? Object.values(all.data.counts).reduce((a, b) => a + b, 0) : undefined;
  const [tab, setTab] = useState<Tab>(
    running.length || !view.queue.jobs.length ? "running" : "waiting",
  );
  const [failures, setFailures] = useState(false);
  return (
    <div>
      <PageHead
        title={
          <span className="inline-flex items-center gap-2">
            Jobs
            <InfoTip label="Jobs" large>
              <TipText
                what="Everything on the Board, plus the jobs that finished in the last 7 days."
                todo="Select a job to open its runner, or to see why it's waiting."
              />
            </InfoTip>
          </span>
        }
      />
      <TabsRow
        tab={tab}
        onTab={setTab}
        tabs={[
          { key: "running", label: "On their way", count: running.length },
          { key: "waiting", label: "Waiting", count: view.queue.jobs.length },
          { key: "history", label: "Last 7 days", count: total },
        ]}
        end={
          tab === "history" && (
            <Toggle checked={failures} onChange={setFailures}>
              Failures only
            </Toggle>
          )
        }
      />
      <div
        role="tabpanel"
        className="overflow-hidden rounded-b-xl border border-t-0 border-tt-rule bg-tt-card max-lg:mt-3 max-lg:rounded-xl max-lg:border-t"
      >
        {tab === "running" &&
          (running.length ? <RunningTable view={view} running={running} /> : <NoJobs />)}
        {tab === "waiting" &&
          (view.queue.jobs.length ? <WaitingTable view={view} /> : <NothingWaiting />)}
        {tab === "history" && <History failures={failures} />}
      </div>
      {tab === "waiting" && <WaitingExtras />}
    </div>
  );
}

/** Where to connect a forge, for empty states before one is. */
function ConnectLinks() {
  return (
    <>
      <Link to="/settings/github" className={ttButton.primary}>
        Connect GitHub
      </Link>
      <Link to="/settings/forgejo" className={ttButton.secondary}>
        Connect Forgejo
      </Link>
    </>
  );
}

function NoJobs() {
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const admin = session.user?.role === "admin";
  if (!forgesConnected(view))
    return (
      <JobsEmpty
        flap="NO JOBS YET"
        title="Connect GitHub or Forgejo"
        actions={admin && <ConnectLinks />}
      >
        Runyard reads running and queued jobs from your forge. Connect one to see them here.
      </JobsEmpty>
    );
  if (view.machines.length === 0)
    return (
      <JobsEmpty
        flap="NO JOBS YET"
        title="Jobs appear here once a pool's runners take work"
        actions={
          admin && (
            <>
              <Link to="/machines/add" className={ttButton.primary}>
                <Icon name="plus" size={14} />
                <span className="mt-[2px]">Add machine</span>
              </Link>
              <span className="text-[12.5px] text-tt-ink-2">Then create a pool for it</span>
            </>
          )
        }
      >
        Point a workflow at a pool's labels with runs-on. Its jobs show up here as they're queued
        and run.
      </JobsEmpty>
    );
  return (
    <JobsEmpty flap="ALL QUIET" title="No runner is working right now">
      Jobs show up here as soon as a runner takes one.
    </JobsEmpty>
  );
}

function NothingWaiting() {
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const connected = forgesConnected(view);
  return (
    <JobsEmpty
      flap="NOTHING WAITING"
      title={emptyQueueText(view)}
      actions={!connected && session.user?.role === "admin" && <ConnectLinks />}
    >
      {!connected
        ? "Connect GitHub or Forgejo to see queued and running jobs."
        : view.queue.complete
          ? "When a queued job has no runner that can take it, it waits here with the reason."
          : "Waiting for a complete job scan."}
    </JobsEmpty>
  );
}

/** The last 7 days, newest first, a page at a time. */
function History({ failures }: { failures: boolean }) {
  const view = useYard();
  const jobs = useJobs({}, failures);
  const [shown, setShown] = useState(PAGE);
  if (jobs.error) return <ErrorText className="px-4 py-3" error={jobs.error} />;
  if (!jobs.data) return <p className="px-4 py-3.5 text-[13px] text-tt-ink-3">Loading…</p>;
  const list = jobs.data.jobs;
  if (!list.length)
    return failures ? (
      <p className="px-4 py-3.5 text-[13px] text-tt-ink-2">No failures in the last 7 days.</p>
    ) : (
      <JobsEmpty flap="NO FINISHED JOBS" title="No finished jobs yet">
        Jobs from the last 7 days appear here as they run, from webhooks or from the runners' hooks.
      </JobsEmpty>
    );
  return (
    <>
      <HistoryTable view={view} jobs={list.slice(0, shown)} />
      {list.length > shown && (
        <button
          type="button"
          onClick={() => setShown(shown + PAGE)}
          className="w-full border-t border-tt-rule px-4 py-3 text-left text-[13px] font-semibold text-tt-ink-2 hover:bg-tt-hover hover:text-tt-ink"
        >
          Show {Math.min(PAGE, list.length - shown)} more
        </button>
      )}
    </>
  );
}

/** Under Waiting: one-job runners just started for queued jobs, and what the list can't know. */
function WaitingExtras() {
  const view = useYard();
  const now = useNow();
  const q = view.queue;
  const connected = forgesConnected(view);
  // A job leaves the queue once a runner takes it; on-demand ones often within the minute.
  const recent = view.pools.dispatches.filter(
    (d) => d.state === "starting" || d.state === "running" || now - d.startedAt < RECENT_MS,
  );
  const jobs = useJobs({});
  return (
    <>
      {recent.length > 0 && (
        <Panel
          title={
            <span className="inline-flex items-center gap-1.5">
              Recently started
              <InfoTip label="Recently started">
                <TipText
                  what="One-job runners Runyard started for queued jobs in the last half hour."
                  details="A job leaves the Waiting list as soon as one of them takes it."
                />
              </InfoTip>
            </span>
          }
          meta={recent.length}
          className="mt-[18px]"
        >
          <Dispatches dispatches={recent.slice(0, 10)} jobs={jobs.data?.jobs ?? []} showPool bare />
        </Panel>
      )}
      <div className="mt-4 space-y-1.5 text-[12px] text-tt-ink-2">
        {q.at && (
          <p className="flex items-center gap-1.5">
            Checked {timeAgo(q.at, now)}.
            {/* The table's headers, where this sits on a desktop, don't show on phones. */}
            <span className="lg:hidden">
              <WhyWaitingTip />
            </span>
          </p>
        )}
        {!q.complete && connected && (
          <p className="text-tt-warn-ink">
            This list may be incomplete: job data is missing or stale, or an installation has more
            repositories than Runyard scans (the 30 most recently pushed).
          </p>
        )}
      </div>
    </>
  );
}
