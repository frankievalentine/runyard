import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useFleet } from "../lib/fleet.ts";
import { checksQuery } from "../lib/queries.ts";
import { machineToReview, setupSteps, type SetupStep } from "../lib/setup.ts";
import { Icon } from "./icons.tsx";
import { Card } from "./ui.tsx";

const HIDDEN_KEY = "runyard.setupChecklistHidden";
const button =
  "inline-flex h-[26px] items-center rounded-[6px] border border-line bg-card px-2.5 text-[12px] font-medium hover:bg-hover";

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The first-run checklist, at the top of the overview until every step is
 * done or this viewer hides it. Steps come from what already exists.
 */
export function SetupChecklist() {
  const view = useFleet();
  const [hidden, setHidden] = useState(readHidden);
  const checks = useQuery(checksQuery);
  const steps = setupSteps(view);
  const done = steps.filter((s) => s.done).length;
  if (hidden || done === steps.length) return null;
  const review = machineToReview(view);
  const actions: Record<SetupStep["id"], ReactNode> = {
    forge: (
      <Link to="/settings/connections" className={button}>
        Connect a forge
      </Link>
    ),
    machine: (
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
  const problems = (checks.data ?? []).filter((c) => c.state === "warn" || c.state === "bad");
  const next = steps.find((s) => !s.done)?.id;
  const hide = () => {
    try {
      localStorage.setItem(HIDDEN_KEY, "1");
    } catch {
      // Storage unavailable: hidden for this visit only.
    }
    setHidden(true);
  };
  return (
    <Card className="mt-6 overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Get Runyard running</div>
          <div className="text-[12px] text-ink-2">
            {done} of {steps.length} done
          </div>
        </div>
        <button type="button" onClick={hide} className="text-[12px] text-ink-2 hover:text-ink">
          Hide
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
