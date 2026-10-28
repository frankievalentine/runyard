import type { MigrationState, MigrationView, RunnerView, YardView } from "@runyard/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../api.ts";
import { sameScope } from "../lib/pools.ts";
import type { Tone } from "../lib/status.ts";
import { yardQuery, useYard } from "../lib/yard.ts";
import { Button, TextField } from "./form.tsx";
import { Card, ErrorText, Pill } from "./ui.tsx";

export const migrationStatus: Record<MigrationState, { tone: Tone; label: string }> = {
  gone: { tone: "muted", label: "Gone" },
  noReplacement: { tone: "bad", label: "No pool runner" },
  labels: { tone: "warn", label: "Labels missing" },
  busy: { tone: "busy", label: "Running a job" },
  waiting: { tone: "muted", label: "Waiting" },
  ready: { tone: "ok", label: "Ready to retire" },
};

export function migrationFor(view: YardView, r: RunnerView): MigrationView | undefined {
  return view.pools.migrations.find(
    (m) => sameScope(m.scope, r.scope) && m.runnerName.toLowerCase() === r.name.toLowerCase(),
  );
}

const scopeJson = (r: { scope: RunnerView["scope"] }) => ({
  forgeId: r.scope.forgeId,
  kind: r.scope.kind as "user" | "org" | "repo",
  target: r.scope.target,
});

/**
 * Moves a runner Runyard didn't install into a pool: a runner from the pool
 * on the same machine replaces it, then the machine's review retires it on
 * the forge. Only for runners already placed on their machine.
 */
export function MoveIntoPool({ r, machineId }: { r: RunnerView; machineId: string }) {
  const view = useYard();
  const queryClient = useQueryClient();
  const migration = migrationFor(view, r);
  const machine = view.machines.find((m) => m.id === machineId);
  const eligible = view.pools.pools.filter(
    (p) =>
      p.mode === "persistent" &&
      p.machines.some((m) => m.machineId === machineId) &&
      p.scopes.some((s) => sameScope(s, r.scope)),
  );
  const [poolId, setPoolId] = useState(eligible[0]?.id ?? "");
  const [path, setPath] = useState("");
  const save = useMutation({
    mutationFn: (next: { poolId: string | null; path?: string }) =>
      call(
        api.runners.migration.$put({
          json: { scope: scopeJson(r), runnerName: r.name, ...next },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });

  if (migration) {
    const status = migrationStatus[migration.state];
    return (
      <Card className="mt-3 flex flex-col gap-2 px-4 py-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Moving into pool</span>
          <Link
            to="/pools/$id"
            params={{ id: migration.poolId }}
            className="text-accent hover:underline"
          >
            {migration.poolName}
          </Link>
          <Pill tone={status.tone}>{status.label}</Pill>
        </div>
        <p className="text-[12.5px] text-ink-2">{migration.detail}</p>
        <div className="flex flex-wrap items-center gap-3">
          {migration.state !== "gone" && (
            <Link
              to="/machines/$id"
              params={{ id: machineId }}
              className="text-[12.5px] font-medium text-accent hover:underline"
            >
              Review {machine?.name ?? "the machine"}
            </Link>
          )}
          <Button
            small
            variant="ghost"
            disabled={save.isPending}
            onClick={() => save.mutate({ poolId: null })}
          >
            {migration.state === "gone" ? "Dismiss" : "Cancel the move"}
          </Button>
        </div>
        <p className="text-[12px] text-ink-2">
          Retiring only deregisters it on the forge. Runyard shows the steps to remove its service,
          and never changes its directory.
        </p>
        {save.error && <ErrorText error={save.error} />}
      </Card>
    );
  }

  if (eligible.length === 0) {
    return (
      <Card className="mt-3 flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
        <span className="min-w-0 flex-1 text-ink-2">
          To let Runyard take this runner over, a persistent pool needs to run on{" "}
          {machine?.name ?? "its machine"} for {r.scopeLabel}.
        </span>
        <Link
          to="/pools/new"
          search={{ fromRunner: r.key }}
          className="text-[12.5px] font-medium text-accent hover:underline"
        >
          Create a pool from this runner
        </Link>
      </Card>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ poolId, path: path.trim() });
  };
  return (
    <Card className="mt-3 px-4 py-3 text-[13px]">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <span className="font-medium">Move into pool</span>
            <select
              className="input !w-auto"
              value={poolId}
              onChange={(e) => setPoolId(e.target.value)}
            >
              {eligible.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" small variant="primary" disabled={save.isPending || !poolId}>
            Start
          </Button>
        </div>
        <div className="max-w-xl">
          <TextField
            label="Its directory (optional)"
            description="Only used to fill in the steps for removing its service afterwards."
            className="input font-mono"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/home/ci/actions-runner"
          />
        </div>
        <p className="text-[12px] text-ink-2">
          The pool's runner on {machine?.name ?? "this machine"} replaces it. Once that runner is
          online and idle, the machine's review retires this one on the forge.
        </p>
        {save.error && <ErrorText error={save.error} />}
      </form>
    </Card>
  );
}

/** The pool page's runners moving in. */
export function MigrationsIn({ poolId }: { poolId: string }) {
  const view = useYard();
  const moving = view.pools.migrations.filter((m) => m.poolId === poolId);
  if (moving.length === 0) return null;
  return (
    <Card className="divide-y divide-line">
      {moving.map((m) => {
        const status = migrationStatus[m.state];
        const runner = view.runners.find(
          (r) => sameScope(r.scope, m.scope) && r.name.toLowerCase() === m.runnerName.toLowerCase(),
        );
        return (
          <div key={`${m.scope.target}:${m.runnerName}`} className="flex flex-col gap-1 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              {runner ? (
                <Link
                  to="/runners/$key"
                  params={{ key: runner.key }}
                  className="font-mono text-accent hover:underline"
                >
                  {m.runnerName}
                </Link>
              ) : (
                <span className="font-mono">{m.runnerName}</span>
              )}
              <span className="text-ink-2">
                on {view.machines.find((x) => x.id === m.machineId)?.name} · {m.scope.target}
              </span>
              <Pill tone={status.tone}>{status.label}</Pill>
            </div>
            <p className="text-[12.5px] text-ink-2">{m.detail}</p>
          </div>
        );
      })}
    </Card>
  );
}
