import { pendingChanges, type MachineView, type PlanItem } from "@runyard/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, call } from "../api.ts";
import { useYard } from "../lib/yard.ts";
import { timeUntil } from "../lib/format.ts";
import { Terminal } from "./Terminal.tsx";
import { useNow } from "../lib/now.ts";
import { runnerFor } from "../lib/pools.ts";
import { runnerStatus } from "../lib/status.ts";
import { Button, TextField } from "./form.tsx";
import { Elapsed } from "./runners.tsx";
import { Card, EmptyLine, ErrorText, LinkRow, LinkTable, Pill, Section, StatusDot } from "./ui.tsx";

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
};

/** The machine's runners: the ones GitHub lists for it, and the ones its pools still call for. ported from aarondfrancis/fleet's RunnerTable. */
export function MachineRunners({ m }: { m: MachineView }) {
  const view = useYard();
  const navigate = useNavigate();
  const linked = view.runners.filter((r) => r.machineId === m.id);
  const missing = view.pools.desired.filter((d) => d.machineId === m.id && !runnerFor(view, d));
  if (linked.length === 0 && missing.length === 0) {
    return (
      <Section title="Runners">
        <Card>
          <EmptyLine>No runners. Add this machine to a pool to give it some.</EmptyLine>
        </Card>
      </Section>
    );
  }
  return (
    <Section title="Runners" count={linked.length + missing.length}>
      <LinkTable
        columns={[{ label: "Runner" }, { label: "Serves" }, { label: "Pool" }, { label: "Status" }]}
        minWidth="min-w-[560px]"
      >
        {linked.map((r) => {
          const status = runnerStatus(r);
          const pool = view.pools.desired.find(
            (d) => d.name === r.name && d.machineId === m.id,
          )?.poolName;
          return (
            <LinkRow
              key={r.key}
              onOpen={() => void navigate({ to: "/runners/$key", params: { key: r.key } })}
              opener={<span className="font-mono text-[12.5px]">{r.name}</span>}
            >
              <td className="px-3 py-2.5 font-mono text-[12px] text-ink-2">{r.scopeLabel}</td>
              <td className="px-3 py-2.5 text-ink-2">{pool ?? "No pool (will be removed)"}</td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-2">
                  <StatusDot tone={status.tone} hollow={status.hollow} />
                  {r.job?.startedAt ? <Elapsed since={r.job.startedAt} /> : status.label}
                </span>
              </td>
            </LinkRow>
          );
        })}
        {missing.map((d) => (
          <LinkRow
            key={d.key}
            onOpen={() => document.getElementById("changes")?.scrollIntoView()}
            opener={<span className="font-mono text-[12.5px]">{d.name}</span>}
          >
            <td className="px-3 py-2.5 font-mono text-[12px] text-ink-2">{d.scope.target}</td>
            <td className="px-3 py-2.5 text-ink-2">{d.poolName}</td>
            <td className="px-3 py-2.5">
              <span className="inline-flex items-center gap-2">
                <StatusDot tone="muted" hollow />
                Not installed
              </span>
            </td>
          </LinkRow>
        ))}
      </LinkTable>
    </Section>
  );
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

  return (
    <section id={anchor ?? undefined} className="mt-8 min-w-0 scroll-mt-4">
      <div className="mb-2 flex min-h-7 flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {admin && (
          <div className="ml-auto">
            <Button
              small
              variant={!review && !operationId && waiting.length ? "primary" : "default"}
              onClick={() => prepare.mutate()}
              disabled={prepare.isPending || operation.data?.status === "running"}
            >
              {prepare.isPending
                ? "Reviewing…"
                : review
                  ? "Review again"
                  : waiting.length
                    ? `Review ${waiting.length === 1 ? "1 change" : `${waiting.length} changes`}`
                    : "Review changes"}
            </Button>
          </div>
        )}
      </div>
      <Card className="overflow-hidden">
        {!review && !operationId && waiting.length > 0 && (
          <div className="px-4 py-3 text-[13px]">
            <div className="flex items-center gap-2 font-medium">
              <span className="size-2 shrink-0 rounded-full bg-accent" aria-hidden />
              {waiting.length === 1 ? "A change is waiting" : `${waiting.length} changes waiting`}
            </div>
            <ul className="mt-1.5 ml-4 list-disc text-[12.5px] text-ink-2">
              {waiting.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-ink-3">
              {admin
                ? "Review to confirm them. Nothing changes until you run it."
                : "An admin can review and apply them."}
            </p>
          </div>
        )}
        {!review && !operationId && waiting.length === 0 && (
          <EmptyLine>
            {admin
              ? "No changes waiting. Reviewing is read-only."
              : "An admin can review and apply this machine's runner changes."}
          </EmptyLine>
        )}
        {prepare.error && <ErrorText className="px-4 py-3" error={prepare.error} />}
        {reviewId && !handedDone && handed.error && (
          <ErrorText className="px-4 py-3" error={handed.error} />
        )}
        {review?.preparedBy && (
          <div className="border-b border-line bg-accent/5 px-4 py-2.5 text-[12.5px]">
            Prepared by the agent <span className="font-medium">{review.preparedBy}</span>. Agents
            can't run changes; check it before you run it.
          </div>
        )}
        {review && review.items.length === 0 && (
          <EmptyLine>Everything matches its pools. Nothing to do.</EmptyLine>
        )}
        {review && review.items.length > 0 && (
          <form onSubmit={submit}>
            <ul className="divide-y divide-line">
              {[...actionable, ...blocked].map((i) => (
                <li
                  key={`${i.action}:${i.path}`}
                  className="flex items-start gap-3 px-4 py-3 text-[12.5px] max-sm:flex-col max-sm:gap-1.5"
                >
                  <span className="mt-0.5 w-40 shrink-0 max-sm:mt-0 max-sm:w-auto">
                    <Pill
                      tone={i.blocked ? "warn" : i.action === "remove" ? "bad" : "busy"}
                      hollow={i.blocked}
                    >
                      {ACTION[i.action]}
                    </Pill>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono">
                      {i.runnerName} <span className="text-ink-3">· {i.scope.target}</span>
                    </div>
                    <div className="text-ink-2">{i.reason}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-3 border-t border-line px-4 py-3">
              {review.mayNeedSudo && (
                <div className="w-64">
                  <TextField
                    label="Sudo password (if needed)"
                    type="password"
                    autoComplete="off"
                    value={sudo}
                    onChange={(e) => setSudo(e.target.value)}
                    description="Used for this run only, never stored."
                  />
                </div>
              )}
              <p className="min-w-0 flex-1 text-[12px] text-ink-2">
                {expired
                  ? "This review expired. Review again."
                  : actionable.length
                    ? `Runyard checks again first and stops if anything changed. Expires ${timeUntil(review.expiresAt, now)}.`
                    : "Nothing here can be done automatically."}
              </p>
              <Button
                type="submit"
                variant="primary"
                disabled={!actionable.length || expired || execute.isPending}
              >
                {execute.isPending
                  ? "Starting…"
                  : `Run
 ${actionable.length} change${actionable.length === 1 ? "" : "s"}`}
              </Button>
            </div>
            {execute.error && <ErrorText className="px-4 pb-3" error={execute.error} />}
          </form>
        )}
        {operation.data && <OperationLog op={operation.data} />}
      </Card>
    </section>
  );
}

const STEP_STATUS: Record<string, string> = {
  pending: "Waiting",
  running: "Running…",
  succeeded: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

function OperationLog({ op }: { op: Operation }) {
  return (
    <div className="border-t border-line">
      <div className="flex items-center gap-2 px-4 py-2.5 text-[12.5px] font-medium">
        <StatusDot
          tone={op.status === "running" ? "busy" : op.status === "succeeded" ? "ok" : "bad"}
        />
        {op.status === "running"
          ? "Running…"
          : op.status === "succeeded"
            ? "Done"
            : `Failed: ${op.error}`}
      </div>
      <ul className="divide-y divide-line">
        {op.steps.map((s, i) => (
          <li key={i} className="px-4 py-2.5 text-[12.5px]">
            <div className="flex items-center gap-2">
              <StatusDot
                tone={
                  s.status === "succeeded"
                    ? "ok"
                    : s.status === "failed"
                      ? "bad"
                      : s.status === "running"
                        ? "busy"
                        : "muted"
                }
                hollow={s.status === "pending" || s.status === "skipped"}
              />
              <span className="font-medium">
                {ACTION[s.action as PlanItem["action"]] ?? s.action}
              </span>
              {/* Runners by name; a machine-wide step (tools) has no runner to name. */}
              {s.runnerName !== "Tools" && (
                <span className="min-w-0 truncate font-mono text-ink-2">{s.runnerName}</span>
              )}
              <span className="ml-auto shrink-0 text-ink-2">
                {STEP_STATUS[s.status] ?? s.status}
              </span>
            </div>
            {(s.output || s.status === "running") && (
              <Terminal text={s.output} running={s.status === "running"} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
