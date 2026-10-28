import { useSuspenseQuery } from "@tanstack/react-query";
import type { FleetView } from "@runyard/core";
import { createFileRoute } from "@tanstack/react-router";
import {
  ActiveAlerts,
  Attention,
  EventTimeline,
  MachineTable,
} from "../../components/machines.tsx";
import { forgesConnected, QueueList, RunnerLine } from "../../components/runners.tsx";
import {
  Card,
  EmptyLine,
  Legend,
  PageHeader,
  Section,
  Stat,
  StatStrip,
} from "../../components/ui.tsx";
import { SetupChecklist } from "../../components/SetupChecklist.tsx";
import { useFleet } from "../../lib/fleet.ts";
import { plural } from "../../lib/format.ts";
import { sessionQuery } from "../../lib/queries.ts";

export const Route = createFileRoute("/_app/")({
  component: Overview,
});

/** fleet's overview: counts, setup until done, what needs a look, work in progress, machines and recent activity. */
function Overview() {
  const view = useFleet();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const admin = session.user?.role === "admin";
  const machines = view.machines;
  const connected = forgesConnected(view);
  if (machines.length === 0 && !connected) {
    return (
      <div className="mx-auto max-w-2xl pt-4">
        <PageHeader
          title="Welcome to Runyard"
          subtitle="Runyard watches the machines that run your CI over SSH and your tailnet, and installs runners on them only after you review the changes."
        />
        {admin ? (
          <SetupChecklist />
        ) : (
          <Card className="mt-6">
            <EmptyLine>An admin hasn't added any machines yet.</EmptyLine>
          </Card>
        )}
      </div>
    );
  }
  const working = view.runners.filter((r) => r.activity === "busy");
  return (
    <div>
      <PageHeader
        title="Yard overview"
        subtitle={`${plural(machines.length, "machine")} · ${plural(view.summary.runners, "runner")}${view.tailnet.name ? ` · ${view.tailnet.name}` : ""}`}
      />
      <div className="mt-8">
        {connected ? <RunnerStrip view={view} /> : <MachineStrip view={view} />}
      </div>

      {admin && <SetupChecklist />}

      {view.alerts.length > 0 && (
        <Section title="Active alerts" count={view.alerts.length}>
          <ActiveAlerts alerts={view.alerts} showMachine />
        </Section>
      )}
      <Attention view={view} />

      {connected && (
        <div className="grid grid-cols-1 gap-x-6 min-[1100px]:grid-cols-2">
          <Section title="Working now" count={working.length}>
            <Card className="overflow-hidden">
              {working.length === 0 ? (
                <EmptyLine>No runner is working right now.</EmptyLine>
              ) : (
                working.map((r) => <RunnerLine key={r.key} r={r} />)
              )}
            </Card>
          </Section>
          <Section title="Queued" count={view.queue.jobs.length}>
            <QueueList view={view} limit={5} compact />
          </Section>
        </div>
      )}

      <Section
        title="Machines"
        count={machines.length}
        action={
          <div className="flex items-center gap-3 text-[12px] text-ink-2">
            <Legend color="bg-meter">Used</Legend>
            <Legend color="bg-warn">70%+</Legend>
            <Legend color="bg-bad">85%+</Legend>
          </div>
        }
      >
        <MachineTable machines={machines} />
      </Section>

      <EventTimeline title="Recent activity" />
    </div>
  );
}

/** fleet's stat strip, once a forge is connected. */
function RunnerStrip({ view }: { view: FleetView }) {
  const s = view.summary;
  const q = view.queue;
  return (
    <StatStrip>
      <Stat label="Working" value={s.busy} tone="busy" sub={`of ${plural(s.runners, "runner")}`}>
        <div className="flex h-1 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
          <span
            className="bg-busy"
            style={{ width: `${s.runners ? (s.busy / s.runners) * 100 : 0}%` }}
          />
          <span
            className="bg-ok/80"
            style={{ width: `${s.runners ? (s.idle / s.runners) * 100 : 0}%` }}
          />
        </div>
      </Stat>
      <Stat label="Idle" value={s.idle} tone="ok" sub="online, ready for jobs" />
      <Stat
        label="Offline"
        value={s.offline}
        tone="muted"
        sub={s.unknown ? `${s.unknown} unknown` : "per the forges"}
      />
      <Stat
        label="Queued jobs"
        value={q.jobs.length}
        sub={q.complete ? "self-hosted, scanned repos" : "partial: some data missing"}
      />
    </StatStrip>
  );
}

/** Machine health counts, before GitHub is connected. */
function MachineStrip({ view }: { view: FleetView }) {
  const machines = view.machines;
  const connected = machines.filter((m) => m.connection.state === "connected").length;
  const offline = machines.filter((m) => m.connection.state === "offline").length;
  const problems = machines.filter(
    (m) => m.connection.state === "error" || m.connection.state === "stale",
  ).length;
  return (
    <StatStrip>
      <Stat
        label="Connected"
        value={connected}
        tone="ok"
        sub={`of ${plural(machines.length, "machine")}`}
      >
        <div className="flex h-1 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
          <span
            className="bg-ok/80"
            style={{ width: `${machines.length ? (connected / machines.length) * 100 : 0}%` }}
          />
        </div>
      </Stat>
      <Stat label="Offline" value={offline} tone="muted" sub="on the tailnet" />
      <Stat
        label="SSH problems"
        value={problems}
        tone={problems ? "bad" : undefined}
        sub="failing or stale reads"
      />
      <Stat
        label="Alerts"
        value={view.alerts.length}
        tone={view.alerts.length ? "warn" : undefined}
        sub="offline or low disk"
      />
    </StatStrip>
  );
}
