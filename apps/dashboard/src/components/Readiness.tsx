import {
  readinessProblems,
  type MachineView,
  type ReadinessItem,
  type ReadinessTier,
} from "@runyard/core";
import { Link } from "@tanstack/react-router";
import type { Tone } from "../lib/status.ts";
import { useYard } from "../lib/yard.ts";
import { Callout, Card, Section, StatusDot } from "./ui.tsx";

const TIERS: [ReadinessTier, string, string][] = [
  ["required", "Required", "Jobs fail without these."],
  ["label", "Its pools' labels", "What its labels promise jobs."],
  ["recommended", "Recommended", "Commonly needed by builds."],
];

const tone: Record<ReadinessItem["status"], Tone> = {
  ok: "ok",
  missing: "bad",
  warn: "warn",
  unknown: "muted",
};

/** Whether the machine has what its pools' jobs need, from its last check. */
export function RunnerReadiness({ m }: { m: MachineView }) {
  const r = m.readiness;
  const problems = readinessProblems(r);
  return (
    <Section
      title="Runner readiness"
      action={
        r && (
          <span className={`text-[12px] ${problems.length ? "text-bad" : "text-ink-2"}`}>
            {problems.length
              ? `${problems.length} to fix`
              : `Ready${r.capabilities.length ? ` · has ${r.capabilities.join(", ")}` : ""}`}
          </span>
        )
      }
    >
      {!r ? (
        <p className="text-[12px] text-ink-2">
          Appears after a successful SSH check: the tools jobs commonly need, the clock, and whether
          the machine reaches your forges.
        </p>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 min-[1100px]:grid-cols-3">
          {TIERS.map(([tier, title, sub]) => {
            const items = r.items.filter((i) => i.tier === tier);
            if (!items.length) return null;
            return (
              <Card key={tier} className="min-w-0 overflow-hidden">
                <div className="border-b border-line bg-sunken/40 px-4 py-2.5">
                  <div className="text-[12px] font-medium">{title}</div>
                  <div className="text-[11.5px] text-ink-2">{sub}</div>
                </div>
                <ul className="divide-y divide-line">
                  {items.map((i) => (
                    <li key={i.id} className="px-4 py-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-2 text-[12px]">
                        <span className="flex min-w-0 items-center gap-2 text-ink-2">
                          <StatusDot tone={tone[i.status]} hollow={i.status === "unknown"} />
                          <span className="break-words">{i.title}</span>
                        </span>
                        <span className="font-medium break-words">{i.value}</span>
                      </div>
                      {i.status !== "ok" && (
                        <p className="mt-1 text-[11.5px] leading-relaxed break-words text-ink-2">
                          {i.detail}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/**
 * The pool's machines that can't serve its jobs: missing something required,
 * or something its labels promise.
 */
export function PoolReadiness({
  poolLabels,
  machineIds,
}: {
  poolLabels: string[];
  machineIds: string[];
}) {
  const view = useYard();
  const labels = new Set(poolLabels.map((l) => `label-${l.toLowerCase()}`));
  const rows = view.machines
    .filter((m) => machineIds.includes(m.id))
    .map((m) => ({
      m,
      problems: readinessProblems(m.readiness).filter(
        (i) => i.tier !== "label" || labels.has(i.id),
      ),
    }))
    .filter((r) => r.problems.length > 0);
  if (rows.length === 0) return null;
  return (
    <Callout className="mt-6" tone="warn" title="Some machines can't serve this pool's jobs yet">
      <ul className="mt-1 flex flex-col gap-1">
        {rows.map(({ m, problems }) => (
          <li key={m.id}>
            <Link
              to="/machines/$id"
              params={{ id: m.id }}
              className="font-medium text-accent hover:underline"
            >
              {m.name}
            </Link>
            : {problems.map((i) => `${i.title}: ${i.value}`).join("; ")}
          </li>
        ))}
      </ul>
    </Callout>
  );
}
