import { poolLabel, poolWorkflow, type Pool } from "@runyard/core";
import { isForgejo } from "../lib/pools.ts";
import { useYard } from "../lib/yard.ts";
import { CopyValue } from "./CopyValue.tsx";
import { Card, Section } from "./ui.tsx";

/** What a workflow puts in runs-on to land on this pool, with a file to start from, per forge it serves. */
export function UseInWorkflow({ pool }: { pool: Pool }) {
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
    <Section title="Use it in a workflow">
      <Card>
        <div className="flex flex-col gap-4 px-4 py-3 text-[12.5px]">
          {forges.map((forge) => {
            const w = poolWorkflow(pool, forge, systems);
            return (
              <div key={forge} className="flex flex-col gap-1.5">
                <span className="max-w-[70ch] text-ink-2">
                  {forges.length > 1 && (
                    <span className="font-medium text-ink">
                      {forge === "github" ? "GitHub. " : "Forgejo. "}
                    </span>
                  )}
                  Jobs with <span className="font-mono">runs-on: {w.runsOn}</span> run here. To
                  start, add this file at <span className="font-mono">{w.path}</span>.
                </span>
                <pre className="max-h-72 overflow-auto rounded-md border border-line bg-bg px-2.5 py-2 font-mono text-[11.5px] leading-relaxed">
                  {w.yaml}
                </pre>
                <div>
                  <CopyValue
                    value={w.yaml}
                    label="Workflow file"
                    className="text-[12.5px] font-medium text-accent"
                  >
                    Copy the file
                  </CopyValue>
                </div>
              </div>
            );
          })}
          <p className="max-w-[70ch] text-ink-2">
            Only this pool's runners carry <span className="font-mono">{poolLabel(pool)}</span>
            {pool.labels.length > 0 &&
              ", for jobs that must land here and not on another pool with the same labels"}
            .
            {mixed &&
              " Its machines run different systems and a job can land on any of them, so give each system its own pool or label when your steps differ."}
          </p>
        </div>
      </Card>
    </Section>
  );
}
