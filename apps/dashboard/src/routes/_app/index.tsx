import { useSuspenseQuery } from "@tanstack/react-query";
import type { FleetView } from "@runyard/core";
import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Icon } from "../../components/icons.tsx";
import { useFleet } from "../../lib/fleet.ts";
import { plural } from "../../lib/format.ts";
import { sessionQuery } from "../../lib/queries.ts";

export const Route = createFileRoute("/_app/")({
  component: Overview,
});

/** fleet's overview: runner counts, Working now and Queued appear once GitHub is connected. */
function Overview() {
  const view = useFleet();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const machines = view.machines;
  const connected = forgesConnected(view);
  if (machines.length === 0 && !connected) {
    return <Welcome admin={session.user?.role === "admin"} discovered={view.discovered.length} />;
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

      <EventTimeline />
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

/** First run: what to do before there's anything to show. */
function Welcome({ admin, discovered }: { admin: boolean; discovered: number }) {
  return (
    <div className="mx-auto max-w-xl pt-8">
      <div className="flex size-10 items-center justify-center rounded-lg border border-line bg-card text-ink-2">
        <Icon name="server" size={20} />
      </div>
      <h1 className="mt-4 text-[20px] font-semibold tracking-tight">Welcome to Runyard</h1>
      <p className="mt-2 text-[13px] text-ink-2">
        Runyard watches the machines that run your CI over SSH and your tailnet. Nothing is
        installed on them, and checks are read-only.
      </p>
      <Card className="mt-6 px-4 py-4 text-[13px]">
        {admin ? (
          <>
            <div className="font-medium">Add your first machine</div>
            <p className="mt-1 text-ink-2">
              {discovered > 0
                ? `${plural(discovered, "desktop or server", "desktops and servers")} on your tailnet can be added in one click.`
                : "Pick a device from your tailnet or enter any SSH target."}
            </p>
            <Link
              to="/machines/add"
              className="mt-3 inline-flex h-[28px] items-center rounded-[6px] bg-accent px-2.5 text-[12.5px] font-medium text-white hover:brightness-110"
            >
              Add machines
            </Link>
            <div className="mt-5 border-t border-line pt-4 font-medium">Connect GitHub</div>
            <p className="mt-1 text-ink-2">
              Runyard's GitHub App reads your runners and queued jobs, for a personal account or an
              organization.
            </p>
            <Link
              to="/settings/github"
              className="mt-3 inline-flex h-[28px] items-center rounded-[6px] border border-line bg-card px-2.5 text-[12.5px] font-medium hover:bg-hover"
            >
              Set up GitHub
            </Link>
          </>
        ) : (
          <p className="text-ink-2">An admin hasn't added any machines yet.</p>
        )}
      </Card>
    </div>
  );
}
