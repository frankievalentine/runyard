import { createFileRoute, Link } from "@tanstack/react-router";
import { CopyValue } from "../../components/CopyValue.tsx";
import { Icon } from "../../components/icons.tsx";
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
} from "../../components/ui.tsx";
import { useFleet } from "../../lib/fleet.ts";
import { timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { runnerStatus } from "../../lib/status.ts";

export const Route = createFileRoute("/_app/runners/$key")({
  component: Runner,
});

/** fleet's RunnerDetail; machine and runner-management state join it with runner management. */
function Runner() {
  const { key } = Route.useParams();
  const view = useFleet();
  const now = useNow();
  const r = view.runners.find((x) => x.key === key);
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
        title={<CopyValue value={r.name} label="Runner name" className="font-mono text-[18px]" />}
        status={
          <Pill tone={status.tone} hollow={status.hollow}>
            {status.label}
          </Pill>
        }
        subtitle={
          <>
            Not linked to a machine · <CopyValue value={r.scopeLabel} label={scopeKind} />
            {r.os && ` · ${r.os}`}
          </>
        }
      />
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
            rows={[]}
            footer="Runyard links runners to machines when it registers them. Runners registered by hand show here unlinked."
          />
        </div>
      </Section>
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
