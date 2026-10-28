import type { MachineView, PlanItem } from "@runyard/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../api.ts";
import { useYard } from "../lib/yard.ts";
import { timeAgo } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";
import { runnerFor } from "../lib/pools.ts";
import { runnerStatus } from "../lib/status.ts";
import { Button, TextField } from "./form.tsx";
import { Elapsed } from "./runners.tsx";
import { Card, EmptyLine, ErrorText, LinkRow, LinkTable, Pill, Section, StatusDot } from "./ui.tsx";

type Review = { id: string; items: PlanItem[]; expiresAt: number; mayNeedSudo: boolean };
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
  repairRegistration: "Needs a look",
  recoverLocal: "Needs a look",
  preserveService: "Left running",
  inspectOffline: "Offline",
  publicRepo: "Public repository",
  groupPolicy: "Group allows public repositories",
  unsupportedPlatform: "Unsupported platform",
  installTemplate: "Install runner software",
  removeTemplate: "Remove runner software",
  retire: "Retire",
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
export function MachineChanges({ m, admin }: { m: MachineView; admin: boolean }) {
  const now = useNow();
  const [review, setReview] = useState<Review | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [sudo, setSudo] = useState("");
  const prepare = useMutation({
    mutationFn: async () =>
      (await call(api.machines[":id"].review.$post({ param: { id: m.id } }))) as unknown as Review,
    onSuccess: (r) => {
      setReview(r);
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
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (review) execute.mutate(review.id);
  };
  const actionable = review?.items.filter((i) => !i.blocked) ?? [];
  const blocked = review?.items.filter((i) => i.blocked) ?? [];
  const expired = review !== null && review.expiresAt <= now;

  return (
    <section id="changes" className="mt-8 min-w-0 scroll-mt-4">
      <div className="mb-2 flex min-h-7 flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-semibold">Changes</h2>
        {admin && (
          <div className="ml-auto">
            <Button
              small
              onClick={() => prepare.mutate()}
              disabled={prepare.isPending || operation.data?.status === "running"}
            >
              {prepare.isPending ? "Reviewing…" : review ? "Review again" : "Review changes"}
            </Button>
          </div>
        )}
      </div>
      <Card className="overflow-hidden">
        {!review && !operationId && (
          <EmptyLine>
            {admin
              ? "Review compares this machine's pools with the machine and GitHub. It reads only; nothing changes until you run it."
              : "An admin can review and apply this machine's runner changes."}
          </EmptyLine>
        )}
        {prepare.error && <ErrorText className="px-4 py-3" error={prepare.error} />}
        {review && review.items.length === 0 && (
          <EmptyLine>Everything matches its pools. Nothing to do.</EmptyLine>
        )}
        {review && review.items.length > 0 && (
          <form onSubmit={submit}>
            <ul className="divide-y divide-line">
              {[...actionable, ...blocked].map((i) => (
                <li
                  key={`${i.action}:${i.path}`}
                  className="flex items-start gap-3 px-4 py-3 text-[12.5px]"
                >
                  <span className="mt-0.5 w-40 shrink-0">
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
                    ? `Runyard re-reads the machine and GitHub first and does nothing if anything changed. Expires ${timeAgo(review.expiresAt, now).replace(" ago", "")}.`
                    : "Nothing here can be done automatically."}
              </p>
              <Button
                type="submit"
                variant="primary"
                disabled={!actionable.length || expired || execute.isPending}
              >
                {execute.isPending
                  ? "Checking…"
                  : `Run ${actionable.length} change${actionable.length === 1 ? "" : "s"}`}
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
              <span className="font-mono">
                {ACTION[s.action as PlanItem["action"]] ?? s.action} {s.runnerName}
              </span>
              <span className="text-ink-3">{s.status}</span>
            </div>
            {s.output && (
              <pre className="mt-1.5 max-h-48 overflow-auto rounded bg-sunken/60 px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-ink-2 select-text">
                {s.output}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
