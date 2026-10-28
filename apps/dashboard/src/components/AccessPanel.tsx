import { accessSteps, type AccessStep, type MachineView } from "@runyard/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, call } from "../api.ts";
import { sshKeyQuery } from "../lib/queries.ts";
import { yardQuery } from "../lib/yard.ts";
import { CopyValue } from "./CopyValue.tsx";
import { Button } from "./form.tsx";
import { Card, ErrorText, StatusDot } from "./ui.tsx";

/**
 * How Runyard gets into a machine it hasn't reached yet: each SSH step in
 * order, where the last check left off, and the commands for that step.
 * Shown until the first successful check.
 */
export function AccessPanel({ m, admin }: { m: MachineView; admin: boolean }) {
  const queryClient = useQueryClient();
  const key = useQuery({ ...sshKeyQuery, enabled: admin });
  const steps = accessSteps(m, key.data?.line ?? null);
  const check = useMutation({
    mutationFn: () => call(api.machines[":id"].check.$post({ param: { id: m.id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });
  return (
    <section id="setup" className="mt-6 scroll-mt-6">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">Connect Runyard to {m.name}</div>
            <div className="text-[12px] text-ink-2">
              Runyard reaches machines over SSH, read-only until you review a change.
            </div>
          </div>
          <Button small onClick={() => check.mutate()} disabled={check.isPending}>
            {check.isPending ? "Checking…" : "Check again"}
          </Button>
        </div>
        <ol className="divide-y divide-line">
          {steps.map((s, i) => (
            <Step key={s.id} step={s} n={i + 1} admin={admin} />
          ))}
        </ol>
        {check.error && <ErrorText className="px-4 pb-3" error={check.error} />}
      </Card>
    </section>
  );
}

function Step({ step, n, admin }: { step: AccessStep; n: number; admin: boolean }) {
  const current = step.state === "current";
  return (
    <li className={`flex gap-3 px-4 py-3 ${current ? "bg-warn/5" : ""}`}>
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
        {step.state === "done" ? (
          <StatusDot tone="ok" />
        ) : current ? (
          <StatusDot tone="warn" />
        ) : (
          <span className="text-[12px] text-ink-2 tabular">{n}</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] font-medium ${step.state === "todo" ? "text-ink-2" : ""}`}>
          {step.title}
        </div>
        {step.state !== "done" && <p className="mt-0.5 text-[12.5px] text-ink-2">{step.detail}</p>}
        {current && admin && step.commands.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {step.commands.map((c) => (
              <div key={c.label} className="flex flex-col gap-1">
                <span className="text-[12px] text-ink-2">{c.label}</span>
                <div className="rounded-md border border-line bg-bg px-2.5 py-1.5">
                  <CopyValue
                    value={c.text}
                    label="Command"
                    className="font-mono text-[12px] break-all whitespace-pre-wrap"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
