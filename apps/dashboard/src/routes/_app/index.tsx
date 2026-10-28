import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ActiveAlerts,
  Attention,
  EventTimeline,
  MachineTable,
} from "../../components/machines.tsx";
import { Card, Legend, PageHeader, Section, Stat, StatStrip } from "../../components/ui.tsx";
import { Icon } from "../../components/icons.tsx";
import { useFleet } from "../../lib/fleet.ts";
import { plural } from "../../lib/format.ts";
import { sessionQuery } from "../../lib/queries.ts";

export const Route = createFileRoute("/_app/")({
  component: Overview,
});

/** fleet's overview. Runner counts, Working now and Queued join it once forges are connected. */
function Overview() {
  const view = useFleet();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const machines = view.machines;
  if (machines.length === 0)
    return <Welcome admin={session.user?.role === "admin"} discovered={view.discovered.length} />;

  const connected = machines.filter((m) => m.connection.state === "connected").length;
  const offline = machines.filter((m) => m.connection.state === "offline").length;
  const problems = machines.filter(
    (m) => m.connection.state === "error" || m.connection.state === "stale",
  ).length;
  return (
    <div>
      <PageHeader
        title="Fleet overview"
        subtitle={`${plural(machines.length, "machine")}${view.tailnet.name ? ` · ${view.tailnet.name}` : ""}`}
      />
      <div className="mt-8">
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
                style={{ width: `${(connected / machines.length) * 100}%` }}
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
      </div>

      {view.alerts.length > 0 && (
        <Section title="Active alerts" count={view.alerts.length}>
          <ActiveAlerts alerts={view.alerts} showMachine />
        </Section>
      )}
      <Attention view={view} />

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
          </>
        ) : (
          <p className="text-ink-2">An admin hasn't added any machines yet.</p>
        )}
      </Card>
    </div>
  );
}
