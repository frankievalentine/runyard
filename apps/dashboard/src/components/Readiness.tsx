import {
  forgeKindsOf,
  poolTools,
  readinessProblems,
  toolInstallPlan,
  type MachineView,
  type Pool,
  type ReadinessItem,
  type ReadinessTier,
} from "@runyard/core";
import { Link } from "@tanstack/react-router";
import type { Tone } from "../lib/status.ts";
import { useYard } from "../lib/yard.ts";
import { CommandBox } from "./CopyValue.tsx";
import { Callout, GroupedCard, Section, StatusDot } from "./ui.tsx";

const TIERS: [ReadinessTier, string, string][] = [
  ["required", "Required", "Jobs fail without these."],
  ["label", "Its pools' labels", ""],
  ["recommended", "Recommended", ""],
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
        <p className="text-[12px] text-ink-2">Appears after the first SSH check.</p>
      ) : (
        <GroupedCard
          groups={TIERS.map(([tier, title, sub]) => ({
            key: tier,
            title,
            sub,
            rows: r.items
              .filter((i) => i.tier === tier)
              .map((i) => [
                i.id,
                <div className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-3 text-[12px]">
                    <span className="flex min-w-0 items-center gap-2 text-ink-2">
                      <StatusDot tone={tone[i.status]} hollow={i.status === "unknown"} />
                      <span className="break-words">{i.title}</span>
                    </span>
                    <span className="min-w-0 text-right font-medium break-words">{i.value}</span>
                  </div>
                  {i.status !== "ok" && (
                    <p className="mt-1 max-w-[60ch] text-[11.5px] leading-relaxed break-words text-ink-2">
                      {i.detail}
                    </p>
                  )}
                  {i.status !== "ok" && i.command && (
                    <CommandBox command={i.command} className="mt-1.5 w-fit max-w-full" />
                  )}
                </div>,
              ]),
          }))}
        />
      )}
    </Section>
  );
}

/**
 * The pool's machines that can't serve its jobs: missing something required,
 * or something its labels promise.
 */
export function PoolReadiness({ pool }: { pool: Pool }) {
  const view = useYard();
  const kinds = forgeKindsOf(view);
  const labels = new Set(pool.labels.map((l) => `label-${l.toLowerCase()}`));
  const machineIds = pool.machines.map((x) => x.machineId);
  const rows = view.machines
    .filter((m) => machineIds.includes(m.id))
    .map((m) => {
      // What the pool installs where missing; the machine's review takes care of those.
      const installs = new Set(
        m.os && m.readiness
          ? toolInstallPlan(m.os, m.readiness, poolTools(pool, kinds, m.os)).install.map((t) =>
              t === "docker" ? "docker" : `tool-${t}`,
            )
          : [],
      );
      return {
        m,
        problems: readinessProblems(m.readiness).filter(
          (i) => (i.tier !== "label" || labels.has(i.id)) && !installs.has(i.id),
        ),
      };
    })

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
