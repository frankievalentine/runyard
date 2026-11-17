import { pendingChanges, type MachineView, type PlanItem } from "@runyard/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, call } from "../api.ts";
import { useYard } from "../lib/yard.ts";
import { timeUntil } from "../lib/format.ts";
import { Terminal } from "./Terminal.tsx";
import { useNow } from "../lib/now.ts";
import { runnerFor } from "../lib/pools.ts";
import { runnerStatus, type Tone } from "../lib/status.ts";
import { Dot, Field, Input, TtError, type DotTone } from "./machine/parts.tsx";
import { Elapsed } from "./runners.tsx";
import { Chip, Panel, Row, TtButton, ttButton, type ChipTone } from "./tt.tsx";

type Review = {
  id: string;
  items: PlanItem[];
  expiresAt: number;
  mayNeedSudo: boolean;
  /** The access token's name, when an agent prepared it. */
  preparedBy?: string;
};
type Operation = {
  id: string;
  status: "running" | "succeeded" | "failed";
  error: string | null;
  steps: { action: string; runnerName: string; scope: string; status: string; output: string }[];
};

const ACTION: Record<PlanItem["action"], string> = {
  install: "Install",
  start: "Start service",
  reconcileLabels: "Set labels",
  remove: "Remove",
  inspect: "Can't check",
  repairRegistration: "Check by hand",
  recoverLocal: "Check by hand",
  preserveService: "Left running",
  inspectOffline: "Offline",
  publicRepo: "Public repository",
  groupPolicy: "Group allows public repositories",
  unsupportedPlatform: "Unsupported platform",
  installTemplate: "Install runner software",
  removeTemplate: "Remove runner software",
  retire: "Retire",
  installTools: "Install tools",
  configureCleanup: "Set job hooks",
  recordJobs: "Record jobs",
  syncPath: "Update PATH",
};

const chipTone: Record<Tone, ChipTone> = {
  busy: "busy",
  ok: "ok",
  warn: "warn",
  bad: "error",
  muted: "neutral",
  info: "neutral",
};

/** The machine's runners: the ones the forge lists for it, and the ones its pools still call for. Ported from aarondfrancis/fleet's RunnerTable. */
export function MachineRunners({ m }: { m: MachineView }) {
  const view = useYard();
  const linked = view.runners.filter((r) => r.machineId === m.id);
  const missing = view.pools.desired.filter((d) => d.machineId === m.id && !runnerFor(view, d));
  const busy = linked.filter((r) => r.activity === "busy").length;
  return (
    <Panel
      title="Runners"
      meta={linked.length + missing.length > 0 && `${busy} of ${linked.length} busy`}
    >
      {linked.length === 0 && missing.length === 0 && (
        <p className="px-4 pt-0 pb-[18px] text-tt-ink-2">
          No runners. Add this machine to a pool to give it some.
        </p>
      )}
      {linked.map((r) => {
        const status = runnerStatus(r);
        const pool = view.pools.desired.find(
          (d) => d.name === r.name && d.machineId === m.id,
        )?.poolName;
        return (
          <div
            key={r.key}
            className="relative flex items-center gap-3 border-t border-tt-rule px-4 py-[11px] hover:bg-tt-hover"
          >
            <Light activity={r.activity} />
            <span className="min-w-0 flex-1">
              <Link
                to="/runners/$key"
                params={{ key: r.key }}
                className="block truncate font-board text-[13px] font-bold after:absolute after:inset-0"
              >
                {r.name}
              </Link>
              <small className="block truncate text-[12px] text-tt-ink-3">
                {pool ? `Pool ${pool}` : "No pool (will be removed)"} ·{" "}
                <span className="font-board">{r.scopeLabel}</span>
              </small>
            </span>
            <Chip tone={chipTone[status.tone]}>
              {r.job?.startedAt ? (
                <>
                  Running · <Elapsed since={r.job.startedAt} />
                </>
              ) : (
                status.label
              )}
            </Chip>
            {r.activity === "idle" && r.forge === "github" && (
              <Link
                to="/runners/$key"
                params={{ key: r.key }}
                className={`${ttButton.secondary} relative z-[1] max-sm:hidden`}
              >
                Test
              </Link>
            )}
          </div>
        );
      })}
      {missing.map((d) => (
        <button
          key={d.key}
          type="button"
          onClick={() => document.getElementById("changes")?.scrollIntoView({ behavior: "smooth" })}
          className="flex w-full items-center gap-3 border-t border-tt-rule px-4 py-[11px] text-left hover:bg-tt-hover"
        >
          <Light activity="offline" />
          <span className="min-w-0 flex-1">
            <b className="block truncate font-board text-[13px] font-bold">{d.name}</b>
            <small className="block truncate text-[12px] text-tt-ink-3">
              Pool {d.poolName} · <span className="font-board">{d.scope.target}</span>
            </small>
          </span>
          <Chip tone="plain">Not installed</Chip>
        </button>
      ))}
    </Panel>
  );
}

/** A runner's light, as on the Board's platforms: orange working, green idle, gray offline. */
function Light({ activity }: { activity: string }) {
  return (
    <i
      aria-hidden
      className={`h-[9px] w-[13px] flex-none rounded-[2px] border-[1.5px] ${
        activity === "busy"
          ? "border-tt-loco bg-tt-loco"
          : activity === "idle"
            ? "border-tt-ok"
            : "border-tt-rule-2 bg-tt-rule"
      }`}
    />
  );
}

/** What a waiting change does, as the design marks it: + adds, − removes, ~ changes. */
function opOf(text: string): ["+" | "−" | "~", string] {
  if (/^(Install|Record)/.test(text)) return ["+", "text-tt-ok-ink"];
  if (/^(Remove|Retire)/.test(text)) return ["−", "text-tt-bad-ink"];
  return ["~", "text-tt-warn-ink"];
}

/** aarondfrancis/fleet's Changes: review re-reads the machine and GitHub; execute reads them again before doing anything. */
export function MachineChanges({
  m,
  admin,
  reviewId,
  title = "Changes",
  anchor = "changes",
  autoPrepare = false,
  onSettled,
  startReview = 0,
}: {
  m: MachineView;
  admin: boolean;
  /** A review prepared elsewhere, shown until this page reviews again or runs it. */
  reviewId?: string;
  title?: ReactNode;
  /** The section's id for links; null where several are on one page. */
  anchor?: string | null;
  /** Prepare a review as soon as it's shown, as after saving a pool. */
  autoPrepare?: boolean;
  /** Told when this machine is done: its run succeeded, or its review found nothing to do. */
  onSettled?: () => void;
  /** Bumped by a Review changes button elsewhere on the page: prepares a review here. */
  startReview?: number;
}) {
  const now = useNow();
  const [ownReview, setReview] = useState<Review | null>(null);
  const [handedDone, setHandedDone] = useState(false);
  const handed = useQuery({
    queryKey: ["review", reviewId],
    queryFn: async () =>
      (await call(api.reviews[":id"].$get({ param: { id: reviewId! } }))) as unknown as Review,
    enabled: Boolean(reviewId) && admin,
    retry: false,
    staleTime: Infinity,
  });
  const review = ownReview ?? (handedDone ? null : (handed.data ?? null));
  const [operationId, setOperationId] = useState<string | null>(null);
  const [sudo, setSudo] = useState("");
  const prepare = useMutation({
    mutationFn: async () =>
      (await call(api.machines[":id"].review.$post({ param: { id: m.id } }))) as unknown as Review,
    onSuccess: (r) => {
      setReview(r);
      setHandedDone(true);
      setOperationId(null);
    },
  });
  const execute = useMutation({
    mutationFn: async (id: string) =>
      (await call(
        api.reviews[":id"].execute.$post({
          param: { id },
          json: sudo ? { sudoPassword: sudo } : {},
        }),
      )) as unknown as Operation,
    onSuccess: (op) => {
      setOperationId(op.id);
      setReview(null);
      setHandedDone(true);
      setSudo("");
    },
  });
  const operation = useQuery({
    queryKey: ["operation", operationId],
    queryFn: async () =>
      (await call(api.operations[":id"].$get({ param: { id: operationId! } }))) as Operation,
    enabled: operationId !== null,
    refetchInterval: (q) => (q.state.data?.status === "running" || !q.state.data ? 1000 : false),
  });
  // Once per mount: preparing only reads, so doing it unasked is safe.
  const prepared = useRef(false);
  useEffect(() => {
    if (!autoPrepare || !admin || prepared.current) return;
    prepared.current = true;
    prepare.mutate();
  }, [autoPrepare, admin, prepare]);
  // Another button asked for a review: preparing only reads, like the one here.
  const asked = useRef(startReview);
  useEffect(() => {
    if (startReview === asked.current || !admin) return;
    asked.current = startReview;
    prepare.mutate();
  }, [startReview, admin, prepare]);
  const settled =
    operation.data?.status === "succeeded" || (review !== null && review.items.length === 0);
  useEffect(() => {
    if (settled) onSettled?.();
  }, [settled, onSettled]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (review) execute.mutate(review.id);
  };
  const view = useYard();
  // What Runyard expects the review to find, until one is prepared here.
  const waiting = pendingChanges(view, m.id);
  const actionable = review?.items.filter((i) => !i.blocked) ?? [];
  const blocked = review?.items.filter((i) => i.blocked) ?? [];
  const expired = review !== null && review.expiresAt <= now;

  const reviewButton = (
    <TtButton
      variant={!review && !operationId && waiting.length ? "primary" : "secondary"}
      onClick={() => prepare.mutate()}
      disabled={prepare.isPending || operation.data?.status === "running"}
    >
      {prepare.isPending
        ? "Reviewing…"
        : review
          ? "Review again"
          : waiting.length
            ? "Review and run"
            : "Review changes"}
    </TtButton>
  );

  return (
    <Panel
      id={anchor ?? undefined}
      className="scroll-mt-4 overflow-hidden"
      title={title}
      meta={
        review
          ? actionable.length
            ? `${actionable.length} to run`
            : "Reviewed"
          : waiting.length
            ? `${waiting.length} waiting`
            : "None waiting"
      }
      action={admin && (review || operationId) ? reviewButton : undefined}
    >
      {!review && !operationId && waiting.length > 0 && (
        <>
          {waiting.map((w) => {
            const [op, color] = opOf(w);
            return (
              <Row key={w}>
                <span aria-hidden className={`w-3 font-board font-bold ${color}`}>
                  {op}
                </span>
                <span className="min-w-0 flex-1">{w}</span>
              </Row>
            );
          })}
          <Row className="flex-wrap">
            <span className="min-w-0 flex-1 basis-[200px] text-[12.5px] text-tt-ink-2">
              {admin
                ? "Review to confirm them. Nothing changes until you run it."
                : "An admin can review and apply them."}
            </span>
            {admin && reviewButton}
          </Row>
        </>
      )}
      {!review && !operationId && waiting.length === 0 && (
        <div className="flex flex-wrap items-center gap-3 px-4 pb-4">
          <p className="min-w-0 flex-1 basis-[200px] text-tt-ink-2">
            {admin
              ? `Nothing to change. Runyard compares ${m.name} with its pools after every check; reviewing is read-only.`
              : "An admin can review and apply this machine's runner changes."}
          </p>
          {admin && reviewButton}
        </div>
      )}
      <TtError className="px-4 pb-3" error={prepare.error} />
      {reviewId && !handedDone && <TtError className="px-4 pb-3" error={handed.error} />}
      {review?.preparedBy && (
        <div className="border-t border-tt-rule bg-tt-warn-bg px-4 py-2.5 text-[12.5px] text-tt-warn-ink">
          Prepared by the agent <span className="font-semibold">{review.preparedBy}</span>. Agents
          can't run changes; check it before you run it.
        </div>
      )}
      {review && review.items.length === 0 && (
        <p className="border-t border-tt-rule px-4 py-3.5 text-tt-ink-2">
          Everything matches its pools. Nothing to do.
        </p>
      )}
      {review && review.items.length > 0 && (
        <form onSubmit={submit}>
          {[...actionable, ...blocked].map((i) => (
            <div
              key={`${i.action}:${i.path}`}
              className="flex items-start gap-3 border-t border-tt-rule px-4 py-[11px] text-[13px] max-sm:flex-col max-sm:gap-1.5"
            >
              <span className="w-40 shrink-0 max-sm:w-auto">
                <Chip tone={i.blocked ? "warn" : i.action === "remove" ? "error" : "busy"}>
                  {ACTION[i.action]}
                </Chip>
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-board text-[12.5px] font-semibold break-words">
                  {i.runnerName}{" "}
                  <span className="font-normal text-tt-ink-3">· {i.scope.target}</span>
                </div>
                <div className="text-[12.5px] text-tt-ink-2">{i.reason}</div>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-3 border-t border-tt-rule px-4 py-3">
            {review.mayNeedSudo && (
              <div className="w-64 max-sm:w-full">
                <Field
                  label="Sudo password (if needed)"
                  hint="Used for this run only, never stored."
                >
                  <Input
                    type="password"
                    autoComplete="off"
                    value={sudo}
                    onChange={(e) => setSudo(e.target.value)}
                  />
                </Field>
              </div>
            )}
            <p className="min-w-0 flex-1 basis-[200px] text-[12.5px] text-tt-ink-2">
              {expired
                ? "This review expired. Review again."
                : actionable.length
                  ? `Runyard checks again first and stops if anything changed. Expires ${timeUntil(review.expiresAt, now)}.`
                  : "Nothing here can be done automatically."}
            </p>
            <TtButton
              type="submit"
              variant="primary"
              disabled={!actionable.length || expired || execute.isPending}
            >
              {execute.isPending
                ? "Starting…"
                : `Run ${actionable.length} change${actionable.length === 1 ? "" : "s"}`}
            </TtButton>
          </div>
          <TtError className="px-4 pb-3" error={execute.error} />
        </form>
      )}
      {operation.data && <OperationLog op={operation.data} />}
    </Panel>
  );
}

const STEP_STATUS: Record<string, string> = {
  pending: "Waiting",
  running: "Running…",
  succeeded: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

const stepTone = (status: string): DotTone =>
  status === "succeeded"
    ? "ok"
    : status === "failed"
      ? "bad"
      : status === "running"
        ? "warn"
        : "unknown";

function OperationLog({ op }: { op: Operation }) {
  return (
    <div className="border-t border-tt-rule">
      <div className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-bold">
        <Dot tone={op.status === "running" ? "warn" : op.status === "succeeded" ? "ok" : "bad"} />
        {op.status === "running"
          ? "Running…"
          : op.status === "succeeded"
            ? "Done"
            : `Failed: ${op.error}`}
      </div>
      {op.steps.map((s, i) => (
        <div key={i} className="border-t border-tt-rule px-4 py-2.5 text-[12.5px]">
          <div className="flex items-center gap-2">
            <Dot tone={stepTone(s.status)} />
            <span className="font-semibold">
              {ACTION[s.action as PlanItem["action"]] ?? s.action}
            </span>
            {/* Runners by name; a machine-wide step (tools) has no runner to name. */}
            {s.runnerName !== "Tools" && (
              <span className="min-w-0 truncate font-board text-tt-ink-2">{s.runnerName}</span>
            )}
            <span className="ml-auto shrink-0 text-tt-ink-3">
              {STEP_STATUS[s.status] ?? s.status}
            </span>
          </div>
          {(s.output || s.status === "running") && (
            <Terminal text={s.output} running={s.status === "running"} />
          )}
        </div>
      ))}
    </div>
  );
}
