import type { Dispatch, MachineView, Pool, Scope } from "@runyard/core";
import { countsLine, Jobs, useJobs } from "../../components/Jobs.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { MachineChanges } from "../../components/changes.tsx";
import { Dispatches } from "../../components/Dispatches.tsx";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { Button, TextField } from "../../components/form.tsx";
import {
  forgeKindsOf,
  poolLabel,
  poolRequiredTools,
  poolTools,
  poolWorkflow,
  TOOL_PROFILES,
} from "@runyard/core";
import { MigrationsIn } from "../../components/Migration.tsx";
import { PoolReadiness } from "../../components/Readiness.tsx";
import { Icon } from "../../components/icons.tsx";
import { PoolForm } from "../../components/PoolForm.tsx";
import { CopyValue } from "../../components/CopyValue.tsx";
import { Label } from "../../components/runners.tsx";
import {
  Callout,
  Card,
  EmptyLine,
  ErrorText,
  LinkRow,
  LinkTable,
  PageHeader,
  Pill,
  Section,
  StatusDot,
} from "../../components/ui.tsx";
import { yardQuery, useYard } from "../../lib/yard.ts";
import { isForgejo, runnerFor, scopeLabel } from "../../lib/pools.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { runnerStatus } from "../../lib/status.ts";

export const Route = createFileRoute("/_app/pools/$id")({
  /** `setup`: just saved, so each machine's review is prepared and shown first. */
  validateSearch: (search: Record<string, unknown>): { setup?: boolean } =>
    search.setup === true || search.setup === "true" ? { setup: true } : {},
  component: KeyedPoolPage,
});

/** Each id gets the page fresh: moving between them never carries one's state to the next. */
function KeyedPoolPage() {
  return <PoolPage key={Route.useParams().id} />;
}

function PoolPage() {
  const { id } = Route.useParams();
  const { setup } = Route.useSearch();
  const view = useYard();
  const navigate = useNavigate();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const [editing, setEditing] = useState(false);
  const pool = view.pools.pools.find((p) => p.id === id);
  if (!pool) {
    return (
      <Card>
        <EmptyLine>
          This pool no longer exists.{" "}
          <Link to="/" className="text-accent hover:underline">
            Back to the overview
          </Link>
        </EmptyLine>
      </Card>
    );
  }
  const admin = session.user?.role === "admin";
  const kinds = forgeKindsOf(view);
  const required = poolRequiredTools(pool, kinds);
  const tools = poolTools(pool, kinds);
  const desired = view.pools.desired.filter((d) => d.poolId === pool.id);

  const existing = desired.filter((d) => runnerFor(view, d)).length;
  const repos = pool.scopes.filter((s) => s.kind === "repo" && !isForgejo(view, s));
  // Forgejo accounts and single repositories with something public, as last read.
  const accounts = pool.scopes.flatMap((s) => {
    if (!isForgejo(view, s)) return [];
    const conn = view.forgejo.connections.find((c) => c.forgeId === s.forgeId);
    const observed = conn?.scopes.find(
      (x) => x.kind === s.kind && x.target.toLowerCase() === s.target.toLowerCase(),
    );
    return observed?.publicRepos?.length ? [{ scope: s, publicRepos: observed.publicRepos }] : [];
  });
  const forgejoMode = pool.scopes.some((s) => isForgejo(view, s))
    ? pool.forgejoMode.kind === "docker"
      ? ` · Forgejo jobs in Docker (${pool.forgejoMode.image})`
      : " · Forgejo jobs on the machine"
    : "";
  const onDemand = pool.mode === "onDemand";
  const templates = view.pools.templates.filter((t) => t.poolId === pool.id);
  const installed = new Set(view.pools.templateRecords.map((t) => t.key));
  const dispatches = view.pools.dispatches.filter((d) => d.poolId === pool.id);
  const running = dispatches.filter((d) => d.state === "starting" || d.state === "running");
  const machinesNeedingReview = onDemand
    ? [...new Set(templates.filter((t) => !installed.has(t.key)).map((t) => t.machineId))]
    : [...new Set(desired.filter((d) => !runnerFor(view, d)).map((d) => d.machineId))];

  return (
    <div>
      <PageHeader
        icon={<Icon name="plan" size={18} />}
        title={pool.name}
        status={
          <>
            {onDemand ? (
              pool.paused ? (
                <Pill tone="warn">Paused</Pill>
              ) : running.length ? (
                <Pill tone="busy">{running.length} running</Pill>
              ) : (
                <Pill tone="muted" hollow>
                  Idle
                </Pill>
              )
            ) : (
              <Pill
                tone={existing === desired.length && desired.length ? "ok" : "muted"}
                hollow={existing < desired.length}
              >
                {existing} of {desired.length} runners
              </Pill>
            )}
          </>
        }
        subtitle={`${onDemand ? "On demand · " : ""}${pool.scopes.map(scopeLabel).join(", ")} · ${pool.machines.length} machine${pool.machines.length === 1 ? "" : "s"}${forgejoMode}`}
        actions={
          admin && (
            <div className="flex items-center gap-2">
              {!editing && (
                <Button small onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              {/* Only on-demand pools start runners by themselves, so only they pause. */}
              {onDemand && <PauseButton pool={pool} />}
              <DeletePool pool={pool} onDeleted={() => void navigate({ to: "/" })} />
            </div>
          )
        }
      />
      {editing && (
        <div className="mt-6">
          <PoolForm
            pool={pool}
            onCancel={() => setEditing(false)}
            onDone={() => {
              setEditing(false);
              void navigate({ to: "/pools/$id", params: { id: pool.id }, search: { setup: true } });
            }}
          />
        </div>
      )}
      {pool.labels.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {[...pool.labels, "runyard", poolLabel(pool)].map((l) => (
            <Label key={l}>{l}</Label>
          ))}
        </div>
      )}
      {pool.cleanup !== "off" && (
        <p className="mt-3 text-[12.5px] text-ink-2">
          Its GitHub runners clear their workspace
          {pool.cleanup === "docker" ? " and prune unused Docker data" : ""} after each job.
        </p>
      )}
      {tools.length > 0 && (
        <p className="mt-3 text-[12.5px] text-ink-2">
          Installs{" "}
          {[
            ...pool.toolProfiles.map((p) => TOOL_PROFILES[p].title),
            ...required.map((r) => r.title),
          ].join(", ")}{" "}
          where missing, through each machine's review.
        </p>
      )}
      {view.pools.collisions.length > 0 && (
        <Callout tone="bad" title="Runner names collide">
          {view.pools.collisions.join(" ")}
        </Callout>
      )}
      {admin && !editing && (setup || machinesNeedingReview.length > 0) && (
        <SetUpOnMachines
          pool={pool}
          // Just saved: every machine, prepared. Later: those still missing runners.
          machineIds={setup ? pool.machines.map((x) => x.machineId) : machinesNeedingReview}
          justSaved={Boolean(setup)}
          onDismiss={() => void navigate({ to: "/pools/$id", params: { id: pool.id }, search: {} })}
        />
      )}
      {!admin && machinesNeedingReview.length > 0 && (
        <Callout tone="warn" title={onDemand ? "Runner software to install" : "Runners to install"}>
          An admin reviews and runs each machine's changes to install them.
        </Callout>
      )}
      <PoolReadiness pool={pool} />
      <UseInWorkflow pool={pool} />

      {onDemand && (
        <>
          <Section title="Machines" count={pool.machines.length}>
            <OnDemandMachines pool={pool} />
          </Section>
          <OneJobRunners poolId={pool.id} dispatches={dispatches} />
        </>
      )}
      {!onDemand && (
        <Section title="Runners" count={desired.length}>
          {desired.length === 0 ? (
            <Card>
              <EmptyLine>
                No runners: choose machines whose operating system Runyard has read.
              </EmptyLine>
            </Card>
          ) : (
            <LinkTable
              columns={[
                { label: "Runner" },
                { label: "Machine" },
                { label: "Serves" },
                { label: "Status" },
              ]}
              minWidth="min-w-[560px]"
            >
              {desired.map((d) => {
                const runner = runnerFor(view, d);
                const status = runner
                  ? runnerStatus(runner)
                  : { tone: "muted" as const, label: "Not installed", hollow: true };
                const open = () =>
                  runner
                    ? void navigate({ to: "/runners/$key", params: { key: runner.key } })
                    : void navigate({ to: "/machines/$id", params: { id: d.machineId } });
                return (
                  <LinkRow
                    key={d.key}
                    onOpen={open}
                    opener={<span className="font-mono text-[12.5px]">{d.name}</span>}
                  >
                    <td className="px-3 py-2.5">
                      {view.machines.find((m) => m.id === d.machineId)?.name}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[12px] text-ink-2">
                      {d.scope.target}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-2">
                        <StatusDot tone={status.tone} hollow={status.hollow} />
                        {status.label}
                      </span>
                    </td>
                  </LinkRow>
                );
              })}
            </LinkTable>
          )}
        </Section>
      )}
      {/* An on-demand pool's jobs are its one-job runners' rows above. */}
      {!onDemand && <Jobs filter={{ pool: pool.id }} showMachine={pool.machines.length > 1} />}
      {view.pools.migrations.some((m) => m.poolId === pool.id) && (
        <Section
          title="Moving in"
          count={view.pools.migrations.filter((m) => m.poolId === pool.id).length}
        >
          <MigrationsIn poolId={pool.id} />
        </Section>
      )}
      {admin && repos.length > 0 && (
        <Section title="Public repositories">
          <p className="mb-3 max-w-2xl text-[12.5px] text-ink-2">
            Runyard won't register runners for a public repository until you allow it. Any runner
            here runs whatever workflow a pull request brings, so lock the repository down first.
          </p>
          <div className="space-y-3">
            {repos.map((s) => (
              <PublicRepo key={s.target} scope={s} />
            ))}
          </div>
        </Section>
      )}
      {admin && accounts.length > 0 && (
        <Section title="Public repositories">
          <p className="mb-3 max-w-2xl text-[12.5px] text-ink-2">
            A Forgejo account runner serves every repository it owns, public ones included. Runyard
            won't register runners for a public repository or an account with one until you allow
            it: any runner here runs whatever workflow a pull request brings.
          </p>
          <div className="space-y-3">
            {accounts.map((a) => (
              <PublicAccount key={`${a.scope.forgeId}:${a.scope.target}`} {...a} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

type Check = { public: boolean; forkApproval: string | null };

/** The guard for one repository: what GitHub confirms, what it can't, and the typed override. */
function PublicRepo({ scope }: { scope: Scope }) {
  const check = useQuery({
    queryKey: ["public-repo", scope.forgeId, scope.target],
    queryFn: async () =>
      (await call(
        api["public-repos"].check.$get({ query: { forgeId: scope.forgeId, repo: scope.target } }),
      )) as Check,
  });
  const [confirm, setConfirm] = useState("");
  const allow = useMutation({
    mutationFn: () =>
      call(
        api["public-repos"].$post({
          json: { forgeId: scope.forgeId, repo: scope.target, confirm },
        }),
      ),
    onSuccess: () => setConfirm(""),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    allow.mutate();
  };
  if (check.isPending) return null;
  if (check.error) return <ErrorText error={check.error} />;
  if (!check.data?.public) {
    return (
      <Card className="flex items-center gap-2 px-4 py-3 text-[12.5px]">
        <StatusDot tone="ok" />
        <span className="font-mono">{scope.target}</span> is private. No override needed.
      </Card>
    );
  }
  const strict = check.data.forkApproval === "all_external_contributors";
  const items: { ok: boolean | null; text: string }[] = [
    {
      ok: null,
      text: "Pull requests are turned off, or limited to collaborators (Settings ▸ General ▸ Pull requests). GitHub's API doesn't report this.",
    },
    {
      ok: check.data.forkApproval === null ? null : strict,
      text: `Fork pull request workflows need approval for all external contributors (Settings ▸ Actions ▸ General).${check.data.forkApproval && !strict ? ` Currently: ${check.data.forkApproval.replace(/_/g, " ")}.` : ""}`,
    },
    {
      ok: null,
      text: "No workflow that runs on these runners is triggered by issues, comments or pull_request_target.",
    },
  ];
  return (
    <Card className="px-4 py-3 text-[12.5px]">
      <div className="flex items-center gap-2 font-medium">
        <StatusDot tone="warn" />
        <span className="font-mono">{scope.target}</span> is public
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((i) => (
          <li key={i.text} className="flex items-start gap-2">
            <span className="mt-0.5 w-24 shrink-0">
              {i.ok === true ? (
                <Pill tone="ok">Confirmed</Pill>
              ) : i.ok === false ? (
                <Pill tone="bad">Not set</Pill>
              ) : (
                <Pill tone="muted" hollow>
                  Can't verify
                </Pill>
              )}
            </span>
            <span className="text-ink-2">{i.text}</span>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-60 flex-1">
          <TextField
            label={`Type ${scope.target} to allow runners for it`}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="danger"
          disabled={allow.isPending || confirm !== scope.target}
        >
          Allow runners
        </Button>
      </form>
      {allow.error && <ErrorText className="mt-2" error={allow.error} />}
      {allow.isSuccess && (
        <p className="mt-2 text-ink-2">
          Allowed. Review the machines' changes to install its runners.
        </p>
      )}
    </Card>
  );
}

/** The typed override for a Forgejo account whose runners would serve public repositories. */
function PublicAccount({ scope, publicRepos }: { scope: Scope; publicRepos: string[] }) {
  const [confirm, setConfirm] = useState("");
  const allow = useMutation({
    mutationFn: () =>
      call(
        api["public-repos"].$post({
          json: { forgeId: scope.forgeId, repo: scope.target, confirm },
        }),
      ),
    onSuccess: () => setConfirm(""),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    allow.mutate();
  };
  return (
    <Card className="px-4 py-3 text-[12.5px]">
      <div className="flex items-center gap-2 font-medium">
        <StatusDot tone="warn" />
        <span className="font-mono">{scope.target}</span>
        {scope.kind === "repo"
          ? " is public"
          : publicRepos.length === 1
            ? " owns a public repository"
            : ` owns ${publicRepos.length} public repositories`}
      </div>
      {scope.kind !== "repo" && (
        <p className="mt-1.5 font-mono text-ink-2">
          {publicRepos.slice(0, 8).join(", ")}
          {publicRepos.length > 8 && ", …"}
        </p>
      )}
      <p className="mt-2 text-ink-2">
        Before allowing it, turn off pull requests on these repositories or make them private, and
        make sure no workflow on these runners is triggered by issues, comments or
        pull_request_target. Runyard can't check these settings on Forgejo.
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-60 flex-1">
          <TextField
            label={`Type ${scope.target} to allow runners for it`}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="danger"
          disabled={allow.isPending || confirm !== scope.target}
        >
          Allow runners
        </Button>
      </form>
      {allow.error && <ErrorText className="mt-2" error={allow.error} />}
      {allow.isSuccess && (
        <p className="mt-2 text-ink-2">
          Allowed. Review the machines' changes to install its runners.
        </p>
      )}
    </Card>
  );
}

/** Stops one-job runners starting for the pool, or lets them start again. Running ones finish. */
/** What a workflow puts in runs-on to land on this pool, with a file to start from, per forge it serves. */
function UseInWorkflow({ pool }: { pool: Pool }) {
  const view = useYard();
  const systems = pool.machines.flatMap((pm) => {
    const os = view.machines.find((m) => m.id === pm.machineId)?.os;
    return os ? [os] : [];
  });
  const forges = [
    ...(pool.scopes.some((s) => !isForgejo(view, s)) ? (["github"] as const) : []),
    ...(pool.scopes.some((s) => isForgejo(view, s)) ? (["forgejo"] as const) : []),
  ];
  const mixed = new Set(systems).size > 1;
  return (
    <Section title="Use it in a workflow">
      <Card>
        <div className="flex flex-col gap-4 px-4 py-3 text-[12.5px]">
          {forges.map((forge) => {
            const w = poolWorkflow(pool, forge, systems);
            return (
              <div key={forge} className="flex flex-col gap-1.5">
                <span className="max-w-[70ch] text-ink-2">
                  {forges.length > 1 && (
                    <span className="font-medium text-ink">
                      {forge === "github" ? "GitHub. " : "Forgejo. "}
                    </span>
                  )}
                  Jobs with <span className="font-mono">runs-on: {w.runsOn}</span> run here. To
                  start, add this file at <span className="font-mono">{w.path}</span>.
                </span>
                <pre className="max-h-72 overflow-auto rounded-md border border-line bg-bg px-2.5 py-2 font-mono text-[11.5px] leading-relaxed">
                  {w.yaml}
                </pre>
                <div>
                  <CopyValue
                    value={w.yaml}
                    label="Workflow file"
                    className="text-[12.5px] font-medium text-accent"
                  >
                    Copy the file
                  </CopyValue>
                </div>
              </div>
            );
          })}
          <p className="max-w-[70ch] text-ink-2">
            Only this pool's runners carry <span className="font-mono">{poolLabel(pool)}</span>
            {pool.labels.length > 0 &&
              ", for jobs that must land here and not on another pool with the same labels"}
            .
            {mixed &&
              " Its machines run different systems and a job can land on any of them, so give each system its own pool or label when your steps differ."}
          </p>
        </div>
      </Card>
    </Section>
  );
}

function PauseButton({ pool }: { pool: Pool }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () =>
      call(
        api.pools[":id"].paused.$put({ param: { id: pool.id }, json: { paused: !pool.paused } }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });
  return (
    <Button
      small
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
      title={toggle.error?.message}
    >
      {pool.paused ? "Resume" : "Pause"}
    </Button>
  );
}

/** Each machine's runner software and how many of its slots are in use. */
function OnDemandMachines({ pool }: { pool: Pool }) {
  const view = useYard();
  const navigate = useNavigate();
  const installed = new Set(view.pools.templateRecords.map((t) => t.key));
  const active = view.pools.dispatches.filter(
    (d) => d.poolId === pool.id && (d.state === "starting" || d.state === "running"),
  );
  return (
    <LinkTable
      columns={[{ label: "Machine" }, { label: "Runner software" }, { label: "Running" }]}
      minWidth="min-w-[480px]"
    >
      {pool.machines.map(({ machineId, slots }) => {
        const machine = view.machines.find((m) => m.id === machineId);
        const templates = view.pools.templates.filter(
          (t) => t.poolId === pool.id && t.machineId === machineId,
        );
        const ready = templates.length > 0 && templates.every((t) => installed.has(t.key));
        const unsupported = machine?.os && machine.os !== "linux" && machine.os !== "macos";
        const status = unsupported
          ? { tone: "bad" as const, label: "Linux and macOS only", hollow: false }
          : !machine?.os
            ? { tone: "muted" as const, label: "OS not read yet", hollow: true }
            : ready
              ? { tone: "ok" as const, label: "Installed", hollow: false }
              : { tone: "warn" as const, label: "Not installed: review changes", hollow: true };
        const n = active.filter((d) => d.machineId === machineId).length;
        return (
          <LinkRow
            key={machineId}
            onOpen={() =>
              void navigate({
                to: "/machines/$id",
                params: { id: machineId },
                hash: ready ? undefined : "changes",
              })
            }
            opener={<span className="font-medium">{machine?.name ?? machineId}</span>}
          >
            <td className="px-3 py-2.5">
              <span className="inline-flex items-center gap-2">
                <StatusDot tone={status.tone} hollow={status.hollow} />
                {status.label}
              </span>
            </td>
            <td className="px-3 py-2.5 font-mono text-[12px] tabular">
              {n} of {slots}
            </td>
          </LinkRow>
        );
      })}
    </LinkTable>
  );
}

function SetUpOnMachines({
  pool,
  machineIds,
  justSaved,
  onDismiss,
}: {
  pool: Pool;
  machineIds: string[];
  justSaved: boolean;
  onDismiss: () => void;
}) {
  const view = useYard();
  // Fixed when shown, so machines don't drop out of the list as they finish.
  const [ids] = useState(machineIds);
  const machines = ids
    .map((mid) => view.machines.find((m) => m.id === mid))
    .filter((m): m is MachineView => m !== undefined);
  const [settled, setSettled] = useState<Set<string>>(new Set());
  const allDone = machines.length > 0 && machines.every((m) => settled.has(m.id));
  const labels = pool.labels.length ? pool.labels.join(", ") : poolLabel(pool);
  const heading = allDone
    ? "Set up on every machine"
    : justSaved
      ? "Saved. Now set it up on your machines"
      : "Not set up on every machine yet";
  const text = allDone
    ? pool.mode === "onDemand"
      ? `Jobs asking for ${labels} now get a fresh runner on these machines.`
      : `Its runners come online within a minute; jobs asking for ${labels} start on them.`
    : justSaved
      ? "Nothing has changed on your machines yet. Each machine's review below lists exactly what it will do; run it to install what this pool needs."
      : pool.mode === "onDemand"
        ? "One-job runners start only where the runner software is installed. Review and run each machine below."
        : "These machines don't have this pool's runners yet. Review and run each machine below.";
  return (
    <section
      className={`mt-6 rounded-lg border px-4 py-4 ${allDone ? "border-ok/40 bg-ok/5" : "border-accent/40 bg-accent/5"}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className={`mt-0.5 ${allDone ? "text-ok" : "text-accent"}`}>
          <Icon name={allDone ? "check" : "plan"} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">{heading}</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-2">{text}</p>
        </div>
        {(justSaved || allDone) && (
          <Button small variant={allDone ? "primary" : "ghost"} onClick={onDismiss}>
            {allDone ? "Done" : "Hide"}
          </Button>
        )}
      </div>
      {machines.map((m) => (
        <MachineChanges
          key={m.id}
          m={m}
          admin
          anchor={null}
          autoPrepare={justSaved}
          onSettled={() => setSettled((s) => (s.has(m.id) ? s : new Set(s).add(m.id)))}
          title={
            <Link to="/machines/$id" params={{ id: m.id }} className="hover:underline">
              On {m.name}
            </Link>
          }
        />
      ))}
    </section>
  );
}

function DeletePool({ pool, onDeleted }: { pool: Pool; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => call(api.pools[":id"].$delete({ param: { id: pool.id } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: yardQuery.queryKey });
      onDeleted();
    },
  });
  return (
    <ConfirmDialog
      trigger="Delete"
      title={`Delete ${pool.name}?`}
      description="Its runners keep running until you review each machine's changes, which then remove them. Directories are kept."
      confirm="Delete pool"
      onConfirm={() => remove.mutate()}
      pending={remove.isPending}
      error={remove.error}
    />
  );
}

/**
 * An on-demand pool's one-job runners, each with the job it ran: its result,
 * the runner's log and the job's. Run history's counts head the list, since
 * each runner runs one job.
 */
function OneJobRunners({ poolId, dispatches }: { poolId: string; dispatches: Dispatch[] }) {
  const jobs = useJobs({ pool: poolId });
  return (
    <Section
      title="One-job runners"
      count={dispatches.length}
      action={
        jobs.data && (
          <span className="text-[12px] text-ink-2">
            Last 7 days: {countsLine(jobs.data.counts)}
          </span>
        )
      }
    >
      <Dispatches dispatches={dispatches.slice(0, 20)} jobs={jobs.data?.jobs ?? []} />
    </Section>
  );
}
