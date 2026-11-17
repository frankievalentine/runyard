import {
  FRONTEND_TOOLS,
  poolLabel,
  poolWorkflow,
  WORKFLOW_KINDS,
  type FrontendTool,
  type Pool,
  type WorkflowKind,
} from "@runyard/core";
import { useState } from "react";
import { isForgejo } from "../lib/pools.ts";
import { useYard } from "../lib/yard.ts";
import { CodeBox } from "./pool/bits.tsx";
import { Panel } from "./tt.tsx";

/** What a workflow puts in runs-on to land on this pool, with a file to start from, per forge it serves. */
export function UseInWorkflow({ pool }: { pool: Pool }) {
  const view = useYard();
  const forges = [
    ...(pool.scopes.some((s) => !isForgejo(view, s)) ? ["GitHub"] : []),
    ...(pool.scopes.some((s) => isForgejo(view, s)) ? ["Forgejo"] : []),
  ];
  return (
    <Panel title="Use it in a workflow" meta={forges.join(" and ")}>
      <WorkflowSnippet pool={pool} />
    </Panel>
  );
}

/** A row of choices, one pressed, like Settings' theme switch but sized for a line. */
function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg border-[1.5px] bg-tt-card px-2.5 py-1 text-[13px] font-semibold ${
            value === o.value
              ? "border-tt-ink shadow-[inset_0_0_0_1px_var(--tt-ink)]"
              : "border-tt-rule-2 text-tt-ink-2 hover:border-tt-ink-3"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The runs-on line and a file for each forge the pool serves, without a panel around it: the
 * starter, or a file that checks, tests and builds a frontend project or runs a Makefile.
 */
export function WorkflowSnippet({ pool }: { pool: Pool }) {
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
  const [kind, setKind] = useState<WorkflowKind>("starter");
  const [tool, setTool] = useState<FrontendTool>("npm");
  const about = WORKFLOW_KINDS.find((k) => k.kind === kind)?.about;
  return (
    <div className="flex flex-col gap-4 px-4 pb-4 text-[13.5px]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Choice
            label="Workflow"
            options={WORKFLOW_KINDS.map((k) => ({ value: k.kind, label: k.label }))}
            value={kind}
            onChange={setKind}
          />
          {kind === "frontend" && (
            <Choice
              label="Package manager"
              options={FRONTEND_TOOLS.map((t) => ({ value: t.tool, label: t.label }))}
              value={tool}
              onChange={setTool}
            />
          )}
        </div>
        <p className="text-[12.5px] text-tt-ink-3">{about}</p>
      </div>
      {forges.map((forge) => {
        const w = poolWorkflow(pool, forge, systems, { kind, tool });
        return (
          <div key={forge} className="flex flex-col gap-2.5">
            <p className="max-w-[70ch] text-tt-ink-2">
              {forges.length > 1 && (
                <b className="font-bold text-tt-ink">
                  {forge === "github" ? "GitHub. " : "Forgejo. "}
                </b>
              )}
              Jobs with <span className="font-board text-[12.5px]">runs-on: {w.runsOn}</span> run
              here. Add this file at <span className="font-board text-[12.5px]">{w.path}</span>:
            </p>
            <CodeBox text={w.yaml} label="Workflow file" />
          </div>
        );
      })}
      <p className="max-w-[70ch] text-[12.5px] text-tt-ink-3">
        Only this pool's runners carry{" "}
        <span className="font-board text-tt-ink-2">{poolLabel(pool)}</span>
        {pool.labels.length > 0 &&
          ", for jobs that must land here and not on another pool with the same labels"}
        .
        {mixed &&
          " Its machines run different systems and a job can land on any of them, so give each system its own pool or label when your steps differ."}
      </p>
    </div>
  );
}
