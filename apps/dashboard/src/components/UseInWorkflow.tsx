import { poolLabel, poolWorkflow, type Pool } from "@runyard/core";
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

/** The runs-on line and a starting file for each forge the pool serves, without a panel around it. */
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
  return (
    <div className="flex flex-col gap-4 px-4 pb-4 text-[13.5px]">
      {forges.map((forge) => {
        const w = poolWorkflow(pool, forge, systems);
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
