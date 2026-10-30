import { useSuspenseQuery } from "@tanstack/react-query";
import { Jobs } from "../../components/Jobs.tsx";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CopyValue } from "../../components/CopyValue.tsx";
import { Icon } from "../../components/icons.tsx";
import { migrationFor, TakeOver } from "../../components/Migration.tsx";
import { TestThisRunner } from "../../components/TestJob.tsx";
import { Elapsed, JobTitle, Label } from "../../components/runners.tsx";
import {
  Card,
  EmptyLine,
  KeyValuePanel,
  PageHeader,
  Pill,
  Section,
  Stat,
  StatStrip,
  Separated,
} from "../../components/ui.tsx";
import { useYard } from "../../lib/yard.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { formatDollars, timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { runnerStatus } from "../../lib/status.ts";

export const Route = createFileRoute("/_app/runners/$key")({
  component: KeyedRunner,
});

/** Each key gets the page fresh: moving between them never carries one's state to the next. */
function KeyedRunner() {
  return <Runner key={Route.useParams().key} />;
}

/** aarondfrancis/fleet's RunnerDetail; machine and runner-management state join it with runner management. */
function Runner() {
  const { key } = Route.useParams();
  const view = useYard();
  const now = useNow();
  const r = view.runners.find((x) => x.key === key);
  const vm = r ? view.boatVms[r.key] : undefined;
  const { data: session } = useSuspenseQuery(sessionQuery);
  const admin = session.user?.role === "admin";
  const machine = r?.machineId ? view.machines.find((m) => m.id === r.machineId) : undefined;
  const assigned = r ? view.assignedRunners.includes(r.key) : false;
  const migration = r ? migrationFor(view, r) : undefined;
  // Runyard's own persistent runners: linked to a machine by a registration, not an admin.
  const registered = Boolean(r?.machineId) && !assigned && !r?.onDemand && !r?.ephemeral;
  if (!r) {
    return (
      <Card>
        <EmptyLine>
          {view.forgejo.connections.length ? "The forge" : "GitHub"} no longer lists this runner.{" "}
          <Link to="/" className="text-accent hover:underline">
            Back to the overview
          </Link>
        </EmptyLine>
      </Card>
    );
  }
  const status = runnerStatus(r);
  const scopeKind =
    r.scope.kind === "org" ? "Organization" : r.scope.kind === "user" ? "Account" : "Repository";
  return (
    <div>
      <PageHeader
        icon={<Icon name="runner" size={16} />}
        title={
          <CopyValue
            value={r.name}
            label="Runner name"
            className="font-mono text-[18px]"
            showIcon={false}
          />
        }
        status={
          <Pill tone={status.tone} hollow={status.hollow}>
            {status.label}
          </Pill>
        }
        subtitle={
          <Separated>
            {[
              <span key="where">
                {r.onDemand ? (
                  `A one-job runner on ${r.onDemand}`
                ) : machine ? (
                  <>
                    On{" "}
                    <Link
                      to="/machines/$id"
                      params={{ id: machine.id }}
                      className="text-accent hover:underline"
                    >
                      {machine.name}
                    </Link>
                    {assigned ? " (assigned)" : ""}
                  </>
                ) : (
                  "Unassigned"
                )}
              </span>,
              migration && <span key="moving">moving into pool {migration.poolName}</span>,
              <CopyValue key="scope" value={r.scopeLabel} label={scopeKind} showIcon={false} />,
              r.os && <span key="os">{r.os}</span>,
              !r.listed && (
                <span key="listed">
                  known from its running job; GitHub's runner list doesn't include it
                </span>
              ),
            ]}
          </Separated>
        }
      />
      {vm && (
        <p className="mt-3 text-[12.5px] text-ink-2">
          Running on boat.dev VM <span className="font-mono text-ink">{vm.id}</span> · {vm.type}
          {vm.size && ` (${vm.size})`} ·{" "}
          {vm.dollars === null
            ? "cost unknown"
            : `${formatDollars(vm.dollars)} so far at list price`}
        </p>
      )}
      {admin && !r.onDemand && !r.ephemeral && (!r.machineId || assigned) && <TakeOver r={r} />}
      <div className="mt-8">
        <StatStrip cols={3}>
          <Stat
            label="Connected to GitHub"
            value={r.status === "online" ? "Yes" : "No"}
            tone={r.stale ? "muted" : r.status === "online" ? "ok" : "bad"}
            hollow={r.stale}
            sub={r.stale ? `as of ${timeAgo(r.asOf, now)} · stale` : `read ${timeAgo(r.asOf, now)}`}
          />
          <Stat
            label="Doing work"
            value={
              r.activity === "busy"
                ? "Running job"
                : r.activity === "idle"
                  ? "Idle"
                  : r.activity === "offline"
                    ? "No"
                    : "Unknown"
            }
            tone={r.activity === "unknown" ? "warn" : status.tone}
            hollow={status.hollow}
            sub={
              r.activity === "offline"
                ? "Runner is offline"
                : r.activity === "unknown"
                  ? "No fresh GitHub data"
                  : "Reported by GitHub"
            }
          />
          <Stat
            label={scopeKind}
            value={r.scopeLabel}
            sub={
              r.scope.kind === "org"
                ? "serves the organization's repositories"
                : r.scope.kind === "user"
                  ? "serves the account's repositories"
                  : r.scope.kind === "instance"
                    ? "serves the whole instance"
                    : "serves this repository only"
            }
          />
        </StatStrip>
      </div>
      {r.activity === "busy" && (
        <div className="mt-6">
          {r.job ? (
            <Card className="border-busy/25 bg-busy/5 px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <JobTitle job={r.job} />
                </div>
                {r.job.startedAt && (
                  <span className="shrink-0 font-mono text-[13px] text-accent tabular">
                    <Elapsed since={r.job.startedAt} />
                  </span>
                )}
              </div>
            </Card>
          ) : (
            <Card className="border-busy/25 bg-busy/5 px-4 py-3 text-[13px] text-ink-2">
              GitHub reports this runner busy. Job details aren't available: the job's repository
              may be outside the scanned repositories, or the scan hasn't caught up yet.
            </Card>
          )}
        </div>
      )}
      <Section title="State">
        <div className="grid grid-cols-1 gap-3 min-[1000px]:grid-cols-2">
          <KeyValuePanel
            title="GitHub"
            rows={[
              ["Status", `${r.status}${r.activity === "busy" ? ", busy" : ""}`],
              ["Runner ID", <span className="font-mono text-[12px]">{r.id}</span>, String(r.id)],
              ["Version", r.version ?? "—"],
              ["Ephemeral", r.ephemeral ? "Yes" : "No"],
            ]}
            footer={
              <span className={`flex items-center gap-1.5 ${r.stale ? "text-warn" : ""}`}>
                {r.stale && <Icon name="alert" size={12} />}As of {timeAgo(r.asOf, now)}
                {r.stale ? " (stale)" : ""}
              </span>
            }
          />
          <KeyValuePanel
            title="On a machine"
            rows={
              machine
                ? [
                    ["Machine", machine.name],
                    ["How", assigned ? "Assigned by an admin" : "Registered by Runyard"],
                  ]
                : []
            }
            footer={
              r.onDemand
                ? `${r.onDemand} starts a fresh VM for each job; it isn't one of your machines.`
                : machine
                  ? assigned
                    ? migration
                      ? `Runyard retires it once pool ${migration.poolName}'s runner here stands in.`
                      : "Shown on the machine only; Runyard doesn't manage this runner."
                    : "Runyard manages this runner through its pool."
                  : "Runyard places runners on machines when it registers them. For one registered another way, choose its machine under Take over this runner."
            }
          />
        </div>
      </Section>
      {r.forge === "github" && !r.onDemand && <Jobs filter={{ runner: r.name }} />}
      {admin && registered && r.forge === "github" && <TestThisRunner r={r} />}
      {r.labels.length > 0 && (
        <Section title="Labels" count={r.labels.length}>
          <Card className="flex flex-wrap gap-1.5 px-4 py-3">
            {r.labels.map((l) => (
              <Label key={l}>{l}</Label>
            ))}
          </Card>
        </Section>
      )}
    </div>
  );
}
