import type { MigrationState, MigrationView, RunnerView, YardView } from "@runyard/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, call } from "../api.ts";
import { sameScope } from "../lib/pools.ts";
import type { Tone } from "../lib/status.ts";
import { yardQuery, useYard } from "../lib/yard.ts";
import { Button, TextField } from "./form.tsx";
import { Icon } from "./icons.tsx";
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
 * Taking over a runner Runyard didn't install, as three steps on its page:
 * say which machine it runs on, move it into a pool there (the pool's runner
 * replaces it), then retire it through that machine's review. The first step
 * alone shows it on the machine without managing it.
 */
export function TakeOver({ r }: { r: RunnerView }) {
  const view = useYard();
  const queryClient = useQueryClient();
  const assigned = view.assignedRunners.includes(r.key);
  const machineId = assigned ? r.machineId : null;
  const machine = machineId ? view.machines.find((m) => m.id === machineId) : undefined;
  const migration = migrationFor(view, r);
  const eligible = machineId
    ? view.pools.pools.filter(
        (p) =>
          p.mode === "persistent" &&
          p.machines.some((m) => m.machineId === machineId) &&
          p.scopes.some((s) => sameScope(s, r.scope)),
      )
    : [];
  const [poolId, setPoolId] = useState("");
  const [path, setPath] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey });
  const place = useMutation({
    mutationFn: (next: string | null) =>
      call(
        api.runners.assignment.$put({
          json: { scope: scopeJson(r), runnerName: r.name, machineId: next },
        }),
      ),
    onSuccess: refresh,
  });
  const move = useMutation({
    mutationFn: (next: { poolId: string | null; path?: string }) =>
      call(
        api.runners.migration.$put({
          json: { scope: scopeJson(r), runnerName: r.name, ...next },
        }),
      ),
    onSuccess: refresh,
  });
  const chosenPool = poolId || eligible[0]?.id || "";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    move.mutate({ poolId: chosenPool, path: path.trim() });
  };
  const status = migration ? migrationStatus[migration.state] : null;
  const retired = migration?.state === "gone";

  return (
    <Card className="mt-6 overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <div className="text-[14px] font-semibold">Take over this runner</div>
        <p className="mt-0.5 text-[12.5px] text-ink-2">
          Runyard didn't register it, so it shows it but never changes it. To have Runyard run it
          instead, a runner from one of its pools replaces it.
        </p>
      </div>
      <ol className="divide-y divide-line text-[13px]">
        <Step
          n={1}
          done={Boolean(machine)}
          current={!machine}
          title="Choose the machine it runs on"
        >
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Runs on"
              className="input !w-auto"
              value={machineId ?? ""}
              disabled={place.isPending || Boolean(migration)}
              onChange={(e) => place.mutate(e.target.value || null)}
            >
              <option value="">Not chosen</option>
              {view.machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <span className="text-[12px] text-ink-2">
              {migration
                ? "Cancel the move to change it."
                : "It then shows on that machine's page. You can stop here."}
            </span>
          </div>
          {place.error && <ErrorText className="mt-2" error={place.error} />}
        </Step>

        <Step
          n={2}
          done={Boolean(migration)}
          current={Boolean(machine) && !migration}
          title="Move it into a pool"
        >
          {!machine ? (
            <p className="text-[12.5px] text-ink-3">Choose its machine first.</p>
          ) : migration ? (
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="text-ink-2">Moving into</span>
              <Link
                to="/pools/$id"
                params={{ id: migration.poolId }}
                className="text-accent hover:underline"
              >
                {migration.poolName}
              </Link>
              <Button
                small
                variant="ghost"
                disabled={move.isPending}
                onClick={() => move.mutate({ poolId: null })}
              >
                {retired ? "Dismiss" : "Cancel the move"}
              </Button>
            </div>
          ) : eligible.length === 0 ? (
            <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
              <span className="min-w-0 flex-1 text-ink-2">
                No persistent pool runs on {machine.name} for {r.scopeLabel} yet.
              </span>
              <Link
                to="/pools/new"
                search={{ fromRunner: r.key }}
                className="font-medium text-accent hover:underline"
              >
                Create a pool from this runner
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Pool"
                  className="input !w-auto"
                  value={chosenPool}
                  onChange={(e) => setPoolId(e.target.value)}
                >
                  {eligible.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <Button type="submit" small variant="primary" disabled={move.isPending}>
                  Start the move
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
            </form>
          )}
          {move.error && <ErrorText className="mt-2" error={move.error} />}
        </Step>

        <Step
          n={3}
          done={retired}
          current={Boolean(migration) && !retired}
          title="Review and retire it"
        >
          {!migration || !status ? (
            <p className="text-[12.5px] text-ink-3">
              Once the pool's runner on {machine?.name ?? "its machine"} is online and idle, the
              machine's review retires this one on the forge.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={status.tone}>{status.label}</Pill>
                <span className="text-[12.5px] text-ink-2">{migration.detail}</span>
              </div>
              {!retired && machineId && (
                <div>
                  <Link
                    to="/machines/$id"
                    params={{ id: machineId }}
                    hash="changes"
                    className={`inline-flex h-[28px] items-center rounded-[6px] px-2.5 text-[12.5px] font-medium ${
                      migration.state === "ready" || migration.state === "waiting"
                        ? "bg-accent text-white hover:brightness-110"
                        : "border border-line-strong bg-card hover:bg-hover"
                    }`}
                  >
                    Review {machine?.name ?? "the machine"}
                  </Link>
                </div>
              )}
              <p className="text-[12px] text-ink-3">
                Retiring only deregisters it on the forge. Runyard then shows the steps to remove
                its service, and never changes its directory.
              </p>
            </div>
          )}
        </Step>
      </ol>
    </Card>
  );
}

function Step({
  n,
  done,
  current,
  title,
  children,
}: {
  n: number;
  done: boolean;
  current: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3 px-4 py-3">
      <span
        className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${
          done
            ? "bg-ok text-white"
            : current
              ? "border border-accent text-accent"
              : "border border-line text-ink-3"
        }`}
      >
        {done ? <Icon name="check" size={11} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`mb-1.5 ${done || current ? "font-medium" : "text-ink-2"}`}>{title}</div>
        {children}
      </div>
    </li>
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
