import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { FleetView } from "@runyard/core";
import { api, call } from "../../api.ts";
import { Button } from "../../components/form.tsx";
import { ActiveAlerts, EventList, MachineTable } from "../../components/machines.tsx";
import {
  Callout,
  Card,
  EmptyLine,
  ErrorText,
  Section,
  Stat,
  StatStrip,
} from "../../components/ui.tsx";
import { fleetQuery, useFleet } from "../../lib/fleet.ts";
import { plural, timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { healthQuery, sessionQuery } from "../../lib/queries.ts";
import { diagnosticWarnings } from "../../lib/status.ts";

export const Route = createFileRoute("/_app/")({
  component: Overview,
});

function Overview() {
  const fleet = useFleet();
  const now = useNow();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const health = useQuery(healthQuery);
  const queryClient = useQueryClient();
  const check = useMutation({
    mutationFn: async () => (await call(api.check.$post())) as FleetView,
    onSuccess: (view) => queryClient.setQueryData(fleetQuery.queryKey, view),
  });
  const machines = fleet.machines;
  const connected = machines.filter((m) => m.connection.state === "connected").length;
  const offline = machines.filter((m) => m.connection.state === "offline").length;
  const failing = machines.filter(
    (m) => m.connection.state === "error" || m.connection.state === "stale",
  ).length;
  const warnings = machines.reduce((n, m) => n + diagnosticWarnings(m), 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[20px] font-semibold tracking-tight">Overview</h1>
        <span className="text-[12px] text-ink-2">
          {fleet.tailnet.name ? `Tailnet ${fleet.tailnet.name}` : "No tailnet"}
          {health.data && ` · Runyard v${health.data.version}`}
        </span>
        <div className="ml-auto">
          <Button small onClick={() => check.mutate()} disabled={check.isPending}>
            {check.isPending ? "Checking…" : "Check now"}
          </Button>
        </div>
      </div>
      {check.error && <ErrorText className="mt-2" error={check.error} />}
      {fleet.tailnet.error && (
        <Callout tone="warn" title="Tailscale can't be read">
          {fleet.tailnet.error}
          {fleet.tailnet.at !== null &&
            ` Showing the tailnet as of ${timeAgo(fleet.tailnet.at, now)}.`}{" "}
          Machines are still checked over SSH; offline alerts wait for fresh tailnet data.
        </Callout>
      )}

      <div className="mt-6">
        <StatStrip>
          <Stat label="Machines" value={machines.length} sub={`${connected} connected`} />
          <Stat
            label="Offline"
            value={offline}
            tone={offline ? "muted" : undefined}
            sub="on the tailnet"
          />
          <Stat
            label="SSH problems"
            value={failing}
            tone={failing ? "bad" : undefined}
            sub={failing ? "see each machine" : "every check succeeded"}
          />
          <Stat
            label="Diagnostics"
            value={warnings}
            tone={warnings ? "warn" : undefined}
            sub={warnings ? plural(warnings, "warning") : "no warnings"}
          />
        </StatStrip>
      </div>

      {fleet.alerts.length > 0 && (
        <Section title="Active alerts">
          <ActiveAlerts alerts={fleet.alerts} showMachine />
        </Section>
      )}

      <Section title="Machines">
        {machines.length > 0 ? (
          <MachineTable machines={machines} />
        ) : (
          <Card>
            <EmptyLine>
              No machines yet.{" "}
              {session.user?.role === "admin" ? (
                <Link to="/machines/add" className="text-accent hover:underline">
                  Add one by SSH target or from your tailnet.
                </Link>
              ) : (
                "An admin can add them."
              )}
            </EmptyLine>
          </Card>
        )}
      </Section>

      <Section title="Recent events">
        <EventList />
      </Section>
    </>
  );
}
