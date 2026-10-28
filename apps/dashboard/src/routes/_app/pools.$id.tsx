import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { Dispatch, Pool, Scope } from "@runyard/core";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { Button, TextField } from "../../components/form.tsx";
import { MigrationsIn } from "../../components/Migration.tsx";
import { Icon } from "../../components/icons.tsx";
import { PoolForm } from "../../components/PoolForm.tsx";
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
import { formatElapsed, timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";

export const Route = createFileRoute("/_app/pools/$id")({
  component: PoolPage,
});

function PoolPage() {
  const { id } = Route.useParams();
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
  const desired = view.pools.desired.filter((d) => d.poolId === pool.id);
  const existing = desired.filter((d) => runnerFor(view, d)).length;
  const repos = pool.scopes.filter((s) => s.kind === "repo" && !isForgejo(view, s));
  const accounts = pool.scopes.flatMap((s) => {
    if (s.kind === "repo" || !isForgejo(view, s)) return [];
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
            {admin && !editing && (
              <Button small variant="ghost" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </>
        }
        subtitle={`${onDemand ? "On demand · " : ""}${pool.scopes.map(scopeLabel).join(", ")} · ${pool.machines.length} machine${pool.machines.length === 1 ? "" : "s"}${forgejoMode}`}
        actions={
          admin && (
            <>
              {onDemand && <PauseButton pool={pool} />}
              <DeletePool pool={pool} onDeleted={() => void navigate({ to: "/" })} />
            </>
          )
        }
      />
      {editing && (
        <div className="mt-6">
          <PoolForm pool={pool} onDone={() => setEditing(false)} />
        </div>
      )}
      {pool.labels.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {[...pool.labels, "runyard", `runyard-pool-${pool.name}`].map((l) => (
            <Label key={l}>{l}</Label>
          ))}
        </div>
      )}
      {view.pools.collisions.length > 0 && (
        <Callout tone="bad" title="Runner names collide">
          {view.pools.collisions.join(" ")}
        </Callout>
      )}
      {machinesNeedingReview.length > 0 && (
        <Callout tone="warn" title={onDemand ? "Runner software to install" : "Runners to install"}>
          {onDemand
            ? "One-job runners start only on machines with the runner software installed. Review each machine's changes:"
            : "Saving a pool changes nothing on machines. Review each machine's changes:"}{" "}
          {machinesNeedingReview.map((mid, i) => (
            <span key={mid}>
              {i > 0 && ", "}
              <Link
                to="/machines/$id"
                params={{ id: mid }}
                hash="changes"
                className="font-medium text-accent hover:underline"
              >
                {view.machines.find((m) => m.id === mid)?.name ?? mid}
              </Link>
            </span>
          ))}
          .
        </Callout>
      )}
      {onDemand && (
        <>
          <Section title="Machines" count={pool.machines.length}>
            <OnDemandMachines pool={pool} />
          </Section>
          <Section title="Recent one-job runners" count={dispatches.length}>
            <Dispatches dispatches={dispatches.slice(0, 20)} />
          </Section>
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
            Runyard won't register runners for a public repository until you allow it. A persistent
            runner runs whatever workflow a pull request brings, so lock the repository down first.
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
            A Forgejo account or organization runner serves every repository it owns, public ones
            included. Runyard won't register runners for it until you allow it: a persistent runner
            runs whatever workflow a pull request brings.
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
        <span className="font-mono">{scope.target}</span> owns{" "}
        {publicRepos.length === 1
          ? "a public repository"
          : `${publicRepos.length} public repositories`}
      </div>
      <p className="mt-1.5 font-mono text-ink-2">
        {publicRepos.slice(0, 8).join(", ")}
        {publicRepos.length > 8 && ", …"}
      </p>
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

const DISPATCH_STATE = {
  starting: { tone: "busy", label: "Starting", hollow: true },
  running: { tone: "busy", label: "Running", hollow: false },
  done: { tone: "ok", label: "Finished", hollow: false },
  failed: { tone: "bad", label: "Failed", hollow: false },
} as const;

/** One-job runners the pool started, newest first, with how each ended. */
function Dispatches({ dispatches }: { dispatches: Dispatch[] }) {
  const view = useYard();
  const now = useNow();
  if (dispatches.length === 0) {
    return (
      <Card>
        <EmptyLine>
          None yet. A runner starts here when a matching job is queued and no idle runner can take
          it.
        </EmptyLine>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line">
        {dispatches.map((d) => {
          const state = DISPATCH_STATE[d.state];
          const runner = view.runners.find(
            (r) => r.scope.forgeId === d.scope.forgeId && r.name === d.runnerName,
          );
          const took = (d.endedAt ?? now) - d.startedAt;
          return (
            <li key={d.id} className="flex flex-wrap items-start gap-3 px-4 py-2.5 text-[12.5px]">
              <span className="mt-1.5">
                <StatusDot tone={state.tone} hollow={state.hollow} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {runner ? (
                    <Link
                      to="/runners/$key"
                      params={{ key: runner.key }}
                      className="font-mono font-medium hover:underline"
                    >
                      {d.runnerName}
                    </Link>
                  ) : (
                    <span className="font-mono font-medium">{d.runnerName}</span>
                  )}
                  <span className="text-ink-2">
                    {state.label} ·{" "}
                    {view.machines.find((m) => m.id === d.machineId)?.name ?? d.machineId} · for job{" "}
                    {d.jobId} in {d.scope.target}
                  </span>
                </div>
                {runner?.job && (
                  <div className="text-ink-2">
                    Running {runner.job.name} in {runner.job.repo}
                  </div>
                )}
                {d.detail && (
                  <div className={d.state === "failed" ? "text-bad" : "text-ink-2"}>{d.detail}</div>
                )}
              </div>
              <span
                className="shrink-0 text-[11.5px] text-ink-3 tabular"
                title={new Date(d.startedAt).toLocaleString()}
              >
                {timeAgo(d.startedAt, now)} · {formatElapsed(took)}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
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
    <AlertDialog.Root>
      <AlertDialog.Trigger render={<Button small variant="danger" />}>Delete</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-black/30" />
        <AlertDialog.Popup className="panel fixed top-1/2 left-1/2 w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 p-5">
          <AlertDialog.Title className="text-[15px] font-semibold">
            Delete {pool.name}?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-[13px] text-ink-2">
            Its runners keep running until you review each machine's changes, which then remove
            them. Directories are kept.
          </AlertDialog.Description>
          {remove.error && <ErrorText className="mt-2" error={remove.error} />}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close render={<Button />}>Cancel</AlertDialog.Close>
            <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Delete pool
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
