import type { RunnerView } from "@runyard/core";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Icon } from "../../components/icons.tsx";
import { PoolForm } from "../../components/PoolForm.tsx";
import { PageHeader } from "../../components/ui.tsx";
import { useYard } from "../../lib/yard.ts";
import { slug, type PoolDraft } from "../../lib/pool-suggestions.ts";
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
  if (runner && fromDraft) {
    return (
      <div>
        <PageHeader
          icon={<Icon name="plan" size={18} />}
          title="New pool"
          subtitle={`A pool that can take over ${runner.name}: on its machine, for ${runner.scopeLabel}, with its labels. Once it's saved, start the move from the runner's page.`}
        />
        <div className="mt-6">
          <PoolForm
            initial={fromDraft}
            onDone={() => void navigate({ to: "/runners/$key", params: { key: runner.key } })}
          />
        </div>
      </div>
    );
  }
  return (
    <PoolForm
      header={(step) => (
        <PageHeader
          icon={<Icon name="plan" size={18} />}
          title="New pool"
          subtitle={
            step === 3
              ? "Saving doesn't change your machines. Next, you'll see what each machine needs and run it."
              : "Choose which repositories it runs jobs for and which machines run them."
          }
        />
      )}
    />
  );
}
