import type { RunnerView } from "@runyard/core";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { InfoTip, TipText } from "../../components/InfoTip.tsx";
import { PoolForm } from "../../components/PoolForm.tsx";
import { PageHead, Panel, ttButton } from "../../components/tt.tsx";
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

const LEDE =
  "Say which machines should run jobs, for which repositories, and with which labels. Runyard turns that into runners, and changes nothing until you review it.";

/** New pool, as in the Timetable design: a route of four stops beside a summary of the pool. */
function NewPool() {
  const view = useYard();
  const { fromRunner } = Route.useSearch();
  const navigate = useNavigate();
  const runner = fromRunner ? view.runners.find((r) => r.key === fromRunner) : undefined;
  const [fromDraft] = useState(() =>
    runner ? draftFromRunner(runner, new Set(view.pools.pools.map((p) => p.name))) : null,
  );
  const back = { to: "/pools", label: "Pools" };
  if (view.github.apps.length === 0 && view.forgejo.connections.length === 0) {
    return (
      <div>
        <PageHead title="New pool" back={back} />
        <Panel>
          <div className="flex max-w-[660px] flex-col items-start gap-2.5 px-6 pt-[26px] pb-7 max-lg:px-4">
            <h3 className="text-[18px] leading-tight font-extrabold">Connect a forge first</h3>
            <p className="text-[14px] text-tt-ink-2">
              Connect GitHub or Forgejo first, under Settings ▸ Connections. A pool needs
              repositories or accounts to serve.
            </p>
            <Link to="/settings/connections" className={`${ttButton.primary} mt-1`}>
              Open Settings
            </Link>
          </div>
        </Panel>
      </div>
    );
  }
  if (runner && fromDraft) {
    return (
      <div>
        <PageHead
          title="New pool"
          back={{ to: `/runners/${runner.key}`, label: runner.name }}
          lede={`A pool that can take over ${runner.name}: on its machine, for ${runner.scopeLabel}, with its labels. Once it's saved, start the move from the runner's page.`}
        />
        <PoolForm
          initial={fromDraft}
          onSaved={() => void navigate({ to: "/runners/$key", params: { key: runner.key } })}
          onCancel={() => void navigate({ to: "/runners/$key", params: { key: runner.key } })}
        />
      </div>
    );
  }
  return (
    <div>
      <PageHead
        title={
          <span className="inline-flex items-center gap-2">
            New pool
            <InfoTip label="New pool" large>
              <TipText what={LEDE} />
            </InfoTip>
          </span>
        }
        back={back}
      />
      <PoolForm />
    </div>
  );
}
