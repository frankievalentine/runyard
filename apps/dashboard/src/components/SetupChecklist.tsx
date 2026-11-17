import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { api, call } from "../api.ts";
import { useYard } from "../lib/yard.ts";
import { sessionQuery } from "../lib/queries.ts";
import { machineToConnect, machineToReview, setupSteps, type SetupStep } from "../lib/setup.ts";
import { Icon } from "./icons.tsx";
import { Card, ErrorText, Section } from "./ui.tsx";

const button =
  "inline-flex h-[26px] items-center rounded-[6px] border border-line-strong bg-card shadow-[0_1px_1px_rgb(0_0_0/0.04)] px-2.5 text-[12px] font-medium hover:bg-hover";

/** Whether the signed-in user skipped the Board's Getting started band, and a way to change it. */
export function useDismissed() {
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
 * Getting started in brief for Settings ▸ Account: one line per step, a link for the next one,
 * the way to the full route, and a way to put its band back on the Board.
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
          {dismissed ? "Show on the Board" : "Hide from the Board"}
        </button>
      }
    >
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[12px] text-ink-2">
          <span className="min-w-0 flex-1">
            {done === steps.length ? "Every step is done." : `${done} of ${steps.length} done`}
          </span>
          <Link to="/start" className="font-medium text-ink hover:underline">
            Open Getting started
          </Link>
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
