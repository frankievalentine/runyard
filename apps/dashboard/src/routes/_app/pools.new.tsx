import type { RunnerView } from "@runyard/core";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Icon } from "../../components/icons.tsx";
import { PoolForm } from "../../components/PoolForm.tsx";
import { Card, PageHeader, Section } from "../../components/ui.tsx";
import { useYard } from "../../lib/yard.ts";
import {
  slug,
  suggestPools,
  type PoolDraft,
  type PoolSuggestion,
} from "../../lib/pool-suggestions.ts";
import { isBuiltinLabel } from "../../lib/status.ts";
import { sessionQuery } from "../../lib/queries.ts";

export const Route = createFileRoute("/_app/pools/new")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.user?.role !== "admin") throw redirect({ to: "/" });
  },
  /** `fromRunner`: a runner Runyard didn't install, to build a pool that can take it over. */
  validateSearch: (search: Record<string, unknown>): { fromRunner?: string } =>
    typeof search.fromRunner === "string" ? { fromRunner: search.fromRunner } : {},
  component: NewPool,
});

/** A pool that can take over a runner: its machine, its scope and its custom labels. */
function draftFromRunner(r: RunnerView, taken: Set<string>): PoolDraft | null {
  if (!r.machineId) return null;
  const labels = r.labels.filter((l) => !isBuiltinLabel(l)).map((l) => l.toLowerCase());
  const base = slug(labels[0] ?? r.name).slice(0, 20) || "pool";
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  return {
    name,
    labels,
    machines: [{ machineId: r.machineId, slots: 1 }],
    scopes: [r.scope],
    forgejoMode: { kind: "host" },
    mode: "persistent",
  };
}

function NewPool() {
  const view = useYard();
  const { fromRunner } = Route.useSearch();
  const navigate = useNavigate();
  const runner = fromRunner ? view.runners.find((r) => r.key === fromRunner) : undefined;
  const [fromDraft] = useState(() =>
    runner ? draftFromRunner(runner, new Set(view.pools.pools.map((p) => p.name))) : null,
  );
  // Computed once, so suggestions don't reshuffle while the form is being filled in.
  const [suggestions] = useState(() => suggestPools(view));
  const [picked, setPicked] = useState<PoolSuggestion | null>(null);
  if (runner && fromDraft) {
    return (
      <div>
        <PageHeader
          icon={<Icon name="plan" size={18} />}
          title="New pool"
          subtitle={`A pool that can take over ${runner.name}: on its machine, for ${runner.scopeLabel}, with its labels. Once it's saved, start the move from the runner's page.`}
        />
        <Section title="Check and adjust">
          <PoolForm
            initial={fromDraft}
            onDone={() => void navigate({ to: "/runners/$key", params: { key: runner.key } })}
          />
        </Section>
      </div>
    );
  }
  return (
    <div>
      <PageHeader
        icon={<Icon name="plan" size={18} />}
        title="New pool"
        subtitle="A pool is a set of runners with the same labels, on machines you choose, for the accounts or repositories you choose."
      />
      {suggestions.length > 0 && (
        <Section title="Suggested">
          <div className="grid max-w-3xl grid-cols-1 gap-2 min-[800px]:grid-cols-2">
            {suggestions.map((s) => {
              const active = picked?.id === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setPicked(active ? null : s)}
                  className={`flex flex-col gap-1 rounded-lg border px-4 py-3 text-left text-[13px] ${active ? "border-accent bg-accent/5" : "border-line bg-card hover:bg-hover"}`}
                >
                  <span className="font-medium">{s.title}</span>
                  <span className="text-[12px] text-ink-2">{s.detail}</span>
                  <span className="mt-1 text-[12px] font-medium text-accent">
                    {active ? "Using this · click to clear" : "Use this"}
                  </span>
                </button>
              );
            })}
          </div>
        </Section>
      )}
      <Section
        title={
          picked ? "Check and adjust" : suggestions.length ? "Or start from scratch" : "Set it up"
        }
      >
        {/* A new key starts the form over from the picked suggestion. */}
        <PoolForm key={picked?.id ?? "blank"} initial={picked?.draft} />
      </Section>
      {view.machines.length === 0 && (
        <Card className="mt-4 max-w-3xl px-4 py-3 text-[12.5px] text-ink-2">
          Pools run on your machines; add one under Machines ▸ + first.
        </Card>
      )}
    </div>
  );
}
