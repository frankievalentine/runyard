import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { api, call } from "../api.ts";
import { useYard } from "../lib/yard.ts";
import { sessionQuery } from "../lib/queries.ts";
import { machineToConnect, machineToReview, setupSteps, type SetupStep } from "../lib/setup.ts";
import { Icon } from "./icons.tsx";
import { ErrorText } from "./ui.tsx";
import { Panel, ttButton } from "./tt.tsx";

const button = `${ttButton.secondary} !px-2.5 !py-[5px] !text-[12px]`;

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
 * Getting started in brief for Settings, as in the Timetable design: one line per step, the way to
 * the next one and to the full route, and a way to put its band back on the Board.
 */
export function SetupSummary() {
  const view = useYard();
  const actions = useStepActions();
  const { dismissed, setDismissed, error } = useDismissed();
  const steps = setupSteps(view);
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done)?.id;
  return (
    <Panel
      id="getting-started"
      title="Getting started"
      meta={done === steps.length ? "Every step is done" : undefined}
      action={
        done < steps.length && (
          <Link to="/start" className={`${ttButton.primary} !px-3 !py-[6px] !text-[12.5px]`}>
            Start
          </Link>
        )
      }
    >
      {done < steps.length && (
        <p className="px-4 pb-1.5 text-[12.5px] text-tt-ink-2">
          {done} of {steps.length} done
        </p>
      )}
      <ol className="pb-2">
        {steps.map((s) => (
          <li
            key={s.id}
            className={`flex items-center gap-2.5 px-4 py-2 text-[13px] ${s.done ? "" : "text-tt-ink-2"}`}
          >
            {s.done ? (
              <span className="text-tt-ok">
                <Icon name="check" size={15} />
              </span>
            ) : (
              <span
                aria-hidden
                className={`m-px size-[13px] flex-none rounded-full border-2 ${s.id === next ? "border-tt-ink" : "border-tt-rule-2"}`}
              />
            )}
            <span className={`min-w-0 flex-1 ${s.id === next ? "font-semibold text-tt-ink" : ""}`}>
              {s.title}
              <span className="sr-only">{s.done ? " (done)" : ""}</span>
            </span>
            {s.id === next && actions[s.id]}
          </li>
        ))}
      </ol>
      <div className="flex items-center border-t border-tt-rule px-4 py-2.5">
        <Link
          to="/start"
          className="flex-1 text-[12.5px] font-semibold text-tt-ink-2 hover:text-tt-ink"
        >
          Open Getting started
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(!dismissed)}
          className="text-[12.5px] font-semibold text-tt-ink-2 hover:text-tt-ink"
        >
          {dismissed ? "Show on the Board" : "Hide from the Board"}
        </button>
      </div>
      {error ? <ErrorText className="border-t border-tt-rule px-4 py-2.5" error={error} /> : null}
    </Panel>
  );
}
