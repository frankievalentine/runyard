import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { api, call } from "../api.ts";
import { useYard } from "../lib/yard.ts";
import { checksQuery, sessionQuery } from "../lib/queries.ts";
import { machineToConnect, machineToReview, setupSteps, type SetupStep } from "../lib/setup.ts";
import { Icon } from "./icons.tsx";
import { Card, ErrorText, Section } from "./ui.tsx";

const button =
  "inline-flex h-[26px] items-center rounded-[6px] border border-line-strong bg-card shadow-[0_1px_1px_rgb(0_0_0/0.04)] px-2.5 text-[12px] font-medium hover:bg-hover";

/** Whether the signed-in user dismissed the overview's checklist, and a way to change it. */
function useDismissed() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const queryClient = useQueryClient();
  const set = useMutation({
    mutationFn: (setupDismissed: boolean) => call(api.me.$patch({ json: { setupDismissed } })),
    onSuccess: (next) => queryClient.setQueryData(sessionQuery.queryKey, next),
  });
  // Shown at once rather than after the round trip.
  const dismissed = set.isPending ? set.variables : session.setupDismissed;
  return { dismissed, setDismissed: (value: boolean) => set.mutate(value), error: set.error };
}

/** Where each unfinished step is done, as a link. */
function useStepActions(): Record<SetupStep["id"], ReactNode> {
  const view = useYard();
  const review = machineToReview(view);
  const stuck = machineToConnect(view);
  return {
    forge: (
      <Link to="/settings/connections" className={button}>
        Connect a forge
      </Link>
    ),
    machine: stuck ? (
      <Link to="/machines/$id" params={{ id: stuck.machine.id }} hash="setup" className={button}>
        Open {stuck.machine.name}
      </Link>
    ) : (
      <Link to="/machines/add" className={button}>
        Add machines
      </Link>
    ),
    pool: (
      <Link to="/pools/new" className={button}>
        New pool
      </Link>
    ),
    runners: review ? (
      <Link to="/machines/$id" params={{ id: review }} hash="changes" className={button}>
        Review changes
      </Link>
    ) : null,
  };
}

/**
 * The first-run checklist, at the top of the overview until the signed-in user
 * dismisses it (in any browser), even once every step is done. Steps come from what already
 * exists.
 */
export function SetupChecklist() {
  const view = useYard();
  const { dismissed, setDismissed } = useDismissed();
  const checks = useQuery(checksQuery);
  const actions = useStepActions();
  const steps = setupSteps(view);
  const done = steps.filter((s) => s.done).length;
  if (dismissed) return null;
  const finished = done === steps.length;
  const problems = (checks.data ?? []).filter((c) => c.state === "warn" || c.state === "bad");
  const next = steps.find((s) => !s.done)?.id;
  return (
    <Card className="mt-6 overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">
            {finished ? "Runyard is running" : "Get Runyard running"}
          </div>
          <div className="text-[12px] text-ink-2">
            {finished
              ? "Every step is done. Settings ▸ Account keeps this list."
              : `${done} of ${steps.length} done`}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-[12px] text-ink-2 hover:text-ink"
        >
          Dismiss
        </button>
      </div>
      <ol className="divide-y divide-line">
        {steps.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${s.done ? "bg-ok text-white" : s.id === next ? "border border-accent text-accent" : "border border-line text-ink-2"}`}
            >
              {s.done ? <Icon name="check" size={11} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={s.done ? "text-ink-2" : "font-medium"}>{s.title}</div>
              {!s.done && <div className="text-[12px] text-ink-2">{s.detail}</div>}
            </div>
            {!s.done && actions[s.id]}
          </li>
        ))}
        <li className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
          <span
            className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] ${view.boat ? "bg-ok text-white" : "border border-dashed border-line text-ink-3"}`}
          >
            {view.boat ? <Icon name="check" size={11} /> : "+"}
          </span>
          <div className="min-w-0 flex-1">
            <div className={view.boat ? "text-ink-2" : "font-medium"}>
              Connect boat.dev{" "}
              <span className="text-[12px] font-normal text-ink-3">· optional</span>
            </div>
            {!view.boat && (
              <div className="text-[12px] text-ink-2">
                For jobs with runs-on: boat: live cost, VM limits and VMs left running. Not needed
                for your own machines.
              </div>
            )}
          </div>
          {!view.boat && (
            <Link to="/boat" className={button}>
              Set up boat.dev
            </Link>
          )}
        </li>
      </ol>
      {problems.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-warn/5 px-4 py-2.5 text-[12.5px]">
          <span className="text-warn">
            <Icon name="alert" size={13} />
          </span>
          <span className="min-w-0 flex-1 text-ink-2">
            This machine: {problems.map((p) => p.title).join(", ")}
          </span>
          <Link to="/settings/connections" className="font-medium text-accent hover:underline">
            See fixes
          </Link>
        </div>
      )}
    </Card>
  );
}

/**
 * The checklist in brief for Settings ▸ Account: one line per step, a link
 * for the next one, and a way to put the full card back on the overview.
 */
export function SetupSummary() {
  const view = useYard();
  const actions = useStepActions();
  const { dismissed, setDismissed, error } = useDismissed();
  const steps = setupSteps(view);
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done)?.id;
  return (
    <Section
      title="Getting started"
      action={
        <button
          type="button"
          onClick={() => setDismissed(!dismissed)}
          className="text-[12px] text-ink-2 hover:text-ink"
        >
          {dismissed ? "Show on overview" : "Dismiss from overview"}
        </button>
      }
    >
      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-2.5 text-[12px] text-ink-2">
          {done === steps.length ? "Every step is done." : `${done} of ${steps.length} done`}
        </div>
        <ol className="divide-y divide-line">
          {steps.map((s) => (
            <li key={s.id} className="flex items-center gap-2.5 px-4 py-2 text-[13px]">
              <span className="flex w-3 shrink-0 justify-center text-ok">
                {s.done ? (
                  <Icon name="check" size={12} />
                ) : (
                  <span
                    className={`size-2.5 rounded-full border ${s.id === next ? "border-accent" : "border-line-strong"}`}
                  />
                )}
              </span>
              <span className={`min-w-0 flex-1 ${s.done ? "text-ink-2" : "font-medium"}`}>
                {s.title}
              </span>
              {s.id === next && actions[s.id]}
            </li>
          ))}
        </ol>
        {error ? <ErrorText className="border-t border-line px-4 py-2.5" error={error} /> : null}
      </Card>
    </Section>
  );
}
