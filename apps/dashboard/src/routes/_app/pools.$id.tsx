import {
  forgeKindsOf,
  poolLabel,
  poolRequiredTools,
  poolTools,
  readinessProblems,
  TOOL_PROFILES,
  toolInstallPlan,
  type Dispatch,
  type MachineView,
  type Pool,
} from "@runyard/core";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { MachineChanges } from "../../components/changes.tsx";
import { Dispatches } from "../../components/Dispatches.tsx";
import { countsLine, useJobs } from "../../components/Jobs.tsx";
import { MigrationsIn } from "../../components/Migration.tsx";
import { machineSign, PoolForm } from "../../components/PoolForm.tsx";
import {
  DeletePool,
  PauseButton,
  PublicAccount,
  PublicRepo,
} from "../../components/pool/actions.tsx";
import {
  Lab,
  machineChip,
  NoticeBar,
  noticeButton,
  poolStatus,
} from "../../components/pool/bits.tsx";
import { PoolJobs } from "../../components/pool/PoolJobs.tsx";
import { Chip, PageHead, Panel, TtButton, ttButton, type ChipTone } from "../../components/tt.tsx";
import { UseInWorkflow } from "../../components/UseInWorkflow.tsx";
import { isForgejo, runnerFor, scopeLabel } from "../../lib/pools.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { runnerStatus } from "../../lib/status.ts";
import { useYard } from "../../lib/yard.ts";

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

const BACK = { to: "/pools", label: "Pools" };

/**
 * A pool, as in the Timetable design: its head with status and actions, what still needs doing,
 * then two columns. Left: how to use it, its runners and jobs (or one-job runners). Right: its
 * labels, machines, runners moving in and public repositories.
 */
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
      <div>
        <PageHead title="Pool not found" back={BACK} />
        <Panel>
          <p className="px-4 py-4 text-[14px] text-tt-ink-2">
            This pool no longer exists.{" "}
            <Link to="/pools" className="font-bold text-tt-ink underline">
              Back to Pools
            </Link>
          </p>
        </Panel>
      </div>
    );
  }
  const admin = session.user?.role === "admin";
  if (editing) {
    return (
      <div>
        <PageHead
          title={`Edit ${pool.name}`}
          back={{ to: `/pools/${pool.id}`, label: pool.name }}
          lede={
            <span className="max-lg:hidden">
              Change what it serves, where it runs and how. Saving changes nothing until you run
              each machine's review.
            </span>
          }
        />
        <PoolForm
          pool={pool}
          onCancel={() => setEditing(false)}
          onFinish={() => setEditing(false)}
        />
      </div>
    );
  }

  const kinds = forgeKindsOf(view);
  const required = poolRequiredTools(pool, kinds);
  const tools = poolTools(pool, kinds);
  const desired = view.pools.desired.filter((d) => d.poolId === pool.id);
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
  const servesForgejo = pool.scopes.some((s) => isForgejo(view, s));
  const onDemand = pool.mode === "onDemand";
  const templates = view.pools.templates.filter((t) => t.poolId === pool.id);
  const installed = new Set(view.pools.templateRecords.map((t) => t.key));
  const dispatches = view.pools.dispatches.filter((d) => d.poolId === pool.id);
  const machinesNeedingReview = onDemand
    ? [...new Set(templates.filter((t) => !installed.has(t.key)).map((t) => t.machineId))]
    : [...new Set(desired.filter((d) => !runnerFor(view, d)).map((d) => d.machineId))];
  const status = poolStatus(view, pool);
  const moving = view.pools.migrations.filter((m) => m.poolId === pool.id);
  const facts = [
    pool.cleanup !== "off" &&
      `Its GitHub runners clear their workspace${pool.cleanup === "docker" ? " and prune unused Docker data" : ""} after each job.`,
    tools.length > 0 &&
      `Installs ${[
        ...pool.toolProfiles.map((p) => TOOL_PROFILES[p].title),
        ...required.map((r) => r.title),
      ].join(", ")} where missing, through each machine's review.`,
    servesForgejo &&
      (pool.forgejoMode.kind === "docker"
        ? `Forgejo jobs run in Docker (${pool.forgejoMode.image}).`
        : "Forgejo jobs run on the machine, as the SSH user."),
  ].filter((f): f is string => Boolean(f));

  return (
    <div>
      <PageHead
        title={
          <span className="text-[30px] font-bold tracking-[-.01em] [font-stretch:100%] max-lg:text-[24px]">
            {pool.name}
          </span>
        }
        back={BACK}
        status={<Chip tone={status.tone}>{status.label}</Chip>}
        lede={`${onDemand ? "On demand · " : ""}${pool.scopes.map(scopeLabel).join(", ")} · ${pool.machines.length} machine${pool.machines.length === 1 ? "" : "s"}`}
        actions={
          admin && (
            <div className="flex flex-wrap gap-2 max-lg:w-full max-lg:[&>*]:flex-1">
              <TtButton onClick={() => setEditing(true)}>Edit</TtButton>
              {/* Only on-demand pools start runners by themselves, so only they pause. */}
              {onDemand && <PauseButton pool={pool} />}
              <DeletePool pool={pool} onDeleted={() => void navigate({ to: "/pools" })} />
            </div>
          )
        }
      />
      {view.pools.collisions.length > 0 && (
        <NoticeBar tone="error">Runner names collide. {view.pools.collisions.join(" ")}</NoticeBar>
      )}
      <ReadinessBar pool={pool} />
      {!admin && machinesNeedingReview.length > 0 && (
        <NoticeBar>
          {onDemand ? "Runner software to install." : "Runners to install."} An admin reviews and
          runs each machine's changes to install them.
        </NoticeBar>
      )}
      {admin && (setup || machinesNeedingReview.length > 0) && (
        <SetUpOnMachines
          pool={pool}
          // Just saved: every machine, prepared. Later: those still missing runners.
          machineIds={setup ? pool.machines.map((x) => x.machineId) : machinesNeedingReview}
          justSaved={Boolean(setup)}
          onDismiss={() => void navigate({ to: "/pools/$id", params: { id: pool.id }, search: {} })}
        />
      )}

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] 3xl:grid-cols-[minmax(0,1fr)_480px] lg:gap-[18px]">
        <div className="flex min-w-0 flex-col gap-3 lg:gap-[18px]">
          <UseInWorkflow pool={pool} />
          {!onDemand && (
            <Panel title="Runners" meta={desired.length}>
              {desired.length === 0 ? (
                <p className="px-4 pb-4 text-[13.5px] text-tt-ink-2">
                  No runners: choose machines whose operating system Runyard has read.
                </p>
              ) : (
                desired.map((d) => {
                  const runner = runnerFor(view, d);
                  const machine = view.machines.find((m) => m.id === d.machineId);
                  const s = runner ? runnerStatus(runner) : null;
                  const chip: [ChipTone, string] = !runner
                    ? ["neutral", "Not installed"]
                    : runner.activity === "busy"
                      ? ["busy", runner.job ? `Running ${runner.job.name}` : "Running a job"]
                      : [
                          s!.tone === "ok" ? "ok" : s!.tone === "bad" ? "error" : "neutral",
                          s!.label,
                        ];
                  return (
                    <Link
                      key={d.key}
                      {...(runner
                        ? { to: "/runners/$key", params: { key: runner.key } }
                        : { to: "/machines/$id", params: { id: d.machineId } })}
                      className="flex items-center gap-3 border-t border-tt-rule px-4 py-[11px] hover:bg-tt-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <b className="block truncate font-board text-[13px] font-semibold">
                          {d.name}
                        </b>
                        <small className="block truncate text-[12px] text-tt-ink-3">
                          {machine?.name ?? d.machineId} · serves {d.scope.target}
                        </small>
                      </span>
                      <span className="max-w-[45%] truncate">
                        <Chip tone={chip[0]}>{chip[1]}</Chip>
                      </span>
                    </Link>
                  );
                })
              )}
            </Panel>
          )}
          {/* An on-demand pool's jobs are its one-job runners' rows. */}
          {!onDemand && <PoolJobs poolId={pool.id} showMachine={pool.machines.length > 1} />}
          {onDemand && <OneJobRunners poolId={pool.id} dispatches={dispatches} />}
        </div>
        <div className="flex min-w-0 flex-col gap-3 lg:gap-[18px]">
          <Panel title="Labels">
            <div className="flex flex-wrap gap-1 px-4 pb-3">
              {[...pool.labels, "runyard", poolLabel(pool)].map((l) => (
                <Lab key={l}>{l}</Lab>
              ))}
            </div>
            {facts.map((f) => (
              <p key={f} className="px-4 pb-2.5 text-[12.5px] text-tt-ink-2">
                {f}
              </p>
            ))}
          </Panel>
          <Panel
            title="Machines"
            meta={
              onDemand ? "Starts a runner when a matching job is queued" : `${pool.machines.length}`
            }
          >
            {pool.machines.map(({ machineId, slots }) => (
              <PoolMachine
                key={machineId}
                pool={pool}
                machineId={machineId}
                slots={slots}
                installed={installed}
              />
            ))}
          </Panel>
          {moving.length > 0 && (
            <Panel title="Moving in" meta={moving.length}>
              <MigrationsIn poolId={pool.id} />
            </Panel>
          )}
          {admin && repos.length > 0 && (
            <Panel title="Public repositories">
              <p className="px-4 pb-3 text-[12.5px] text-tt-ink-2">
                Runyard won't register runners for a public repository until you allow it. Any
                runner here runs whatever workflow a pull request brings, so lock the repository
                down first.
              </p>
              {repos.map((s) => (
                <PublicRepo key={s.target} scope={s} />
              ))}
            </Panel>
          )}
          {admin && accounts.length > 0 && (
            <Panel title={repos.length ? "Public on Forgejo" : "Public repositories"}>
              <p className="px-4 pb-3 text-[12.5px] text-tt-ink-2">
                A Forgejo account runner serves every repository it owns, public ones included.
                Runyard won't register runners for a public repository or an account with one until
                you allow it: any runner here runs whatever workflow a pull request brings.
              </p>
              {accounts.map((a) => (
                <PublicAccount key={`${a.scope.forgeId}:${a.scope.target}`} {...a} />
              ))}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The yellow bar when some of the pool's machines can't serve its jobs: missing something
 * required, or something its labels promise, that the pool doesn't install itself.
 */
function ReadinessBar({ pool }: { pool: Pool }) {
  const view = useYard();
  const kinds = forgeKindsOf(view);
  const labels = new Set(pool.labels.map((l) => `label-${l.toLowerCase()}`));
  const machineIds = pool.machines.map((x) => x.machineId);
  const rows = view.machines
    .filter((m) => machineIds.includes(m.id))
    .map((m) => {
      // What the pool installs where missing; the machine's review takes care of those.
      const installs = new Set(
        m.os && m.readiness
          ? toolInstallPlan(m.os, m.readiness, poolTools(pool, kinds, m.os)).install.map((t) =>
              t === "docker" ? "docker" : `tool-${t}`,
            )
          : [],
      );
      return {
        m,
        problems: readinessProblems(m.readiness).filter(
          (i) => (i.tier !== "label" || labels.has(i.id)) && !installs.has(i.id),
        ),
      };
    })
    .filter((r) => r.problems.length > 0);
  if (rows.length === 0) return null;
  return (
    <NoticeBar
      action={
        rows.length === 1 && (
          <Link to="/machines/$id" params={{ id: rows[0]!.m.id }} className={noticeButton}>
            Open machine
          </Link>
        )
      }
    >
      Some machines can't serve this pool's jobs yet.
      {rows.map(({ m, problems }) => (
        <span key={m.id} className="block text-[13px] font-medium">
          {rows.length > 1 ? (
            <Link to="/machines/$id" params={{ id: m.id }} className="font-bold underline">
              {m.name}
            </Link>
          ) : (
            <b className="font-bold">{m.name}</b>
          )}
          : {problems.map((i) => `${i.title}: ${i.value}`).join("; ")}
        </span>
      ))}
    </NoticeBar>
  );
}

/** A machine in the pool: its sign, how much of the pool it's running, and its state. */
function PoolMachine({
  pool,
  machineId,
  slots,
  installed,
}: {
  pool: Pool;
  machineId: string;
  slots: number;
  installed: Set<string>;
}) {
  const view = useYard();
  const machine = view.machines.find((m) => m.id === machineId);
  let line: string;
  let chip = machine ? machineChip(machine) : <Chip>Removed</Chip>;
  if (pool.mode === "onDemand") {
    const templates = view.pools.templates.filter(
      (t) => t.poolId === pool.id && t.machineId === machineId,
    );
    const ready = templates.length > 0 && templates.every((t) => installed.has(t.key));
    const unsupported = machine?.os && machine.os !== "linux" && machine.os !== "macos";
    const running = view.pools.dispatches.filter(
      (d) =>
        d.poolId === pool.id &&
        d.machineId === machineId &&
        (d.state === "starting" || d.state === "running"),
    ).length;
    line = `${running} of ${slots} running · ${
      unsupported
        ? "Linux and macOS only"
        : !machine?.os
          ? "OS not read yet"
          : ready
            ? "Runner software installed"
            : "Not installed: review changes"
    }`;
    if (unsupported) chip = <Chip tone="error">Unsupported</Chip>;
    else if (machine?.os && !ready) chip = <Chip tone="warn">Review changes</Chip>;
  } else {
    const mine = view.pools.desired
      .filter((d) => d.poolId === pool.id && d.machineId === machineId)
      .flatMap((d) => runnerFor(view, d) ?? []);
    line = `${mine.filter((r) => r.activity === "busy").length} of ${mine.length || slots} running`;
  }
  const needsReview = pool.mode === "onDemand" ? line.endsWith("review changes") : false;
  return (
    <Link
      to="/machines/$id"
      params={{ id: machineId }}
      hash={needsReview ? "changes" : undefined}
      className="flex items-center gap-3 border-t border-tt-rule px-4 py-[11px] hover:bg-tt-hover"
    >
      {machine ? machineSign(view, machine) : null}
      <span className="min-w-0 flex-1">
        <b className="block truncate font-bold">{machine?.name ?? machineId}</b>
        <small className="block truncate text-[12px] text-tt-ink-3">{line}</small>
      </span>
      {chip}
    </Link>
  );
}

/** Each machine's review, to set the pool up there: after saving, or while runners are missing. */
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
  const text = allDone
    ? pool.mode === "onDemand"
      ? `Jobs asking for ${labels} now get a fresh runner on these machines.`
      : `Its runners come online within a minute; jobs asking for ${labels} start on them.`
    : justSaved
      ? "Nothing has changed on your machines yet. Each machine's review lists exactly what it will do; run it to install what this pool needs. Busy runners finish their jobs and are left alone."
      : pool.mode === "onDemand"
        ? "One-job runners start only where the runner software is installed. Review and run each machine."
        : "These machines don't have this pool's runners yet. Review and run each machine.";
  if (machines.length === 0) return null;
  return (
    <Panel
      className="mb-3 lg:mb-[18px]"
      title={
        allDone
          ? "Set up on every machine"
          : justSaved
            ? "Saved. Now set it up on your machines"
            : "Not set up on every machine yet"
      }
      action={
        (justSaved || allDone) && (
          <button
            type="button"
            onClick={onDismiss}
            className={allDone ? ttButton.primary : ttButton.secondary}
          >
            {allDone ? "Done" : "Hide"}
          </button>
        )
      }
    >
      <p className="px-4 pb-3 text-[13.5px] text-tt-ink-2">{text}</p>
      <div className="flex flex-col gap-4 px-4 pb-4 [&_section]:mt-0">
        {machines.map((m) => (
          <MachineChanges
            key={m.id}
            m={m}
            admin
            anchor={null}
            autoPrepare={justSaved}
            onSettled={() => setSettled((s) => (s.has(m.id) ? s : new Set(s).add(m.id)))}
            title={
              <span className="flex items-center gap-2.5">
                {machineSign(view, m)}
                <Link
                  to="/machines/$id"
                  params={{ id: m.id }}
                  className="text-[14px] font-bold hover:underline"
                >
                  {m.name}
                </Link>
                {settled.has(m.id) && <Chip tone="ok">Done</Chip>}
              </span>
            }
          />
        ))}
      </div>
    </Panel>
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
    <Panel
      title="One-job runners"
      meta={jobs.data ? `Last 7 days: ${countsLine(jobs.data.counts)}` : dispatches.length}
    >
      <Dispatches
        bare
        dispatches={dispatches.slice(0, 20)}
        jobs={jobs.data?.jobs ?? []}
        empty="None yet. A runner starts when a matching job is queued and is removed after it."
      />
    </Panel>
  );
}
