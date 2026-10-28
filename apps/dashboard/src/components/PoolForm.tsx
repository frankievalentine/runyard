import type { ForgejoMode, Pool, Scope } from "@runyard/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../api.ts";
import { fleetQuery, useFleet } from "../lib/fleet.ts";
import { osLabel } from "../lib/status.ts";
import { availableScopes, isForgejo, sameScope } from "../lib/pools.ts";
import { Button, TextField } from "./form.tsx";
import { ForgeBadge } from "./runners.tsx";
import { Card, EmptyLine, ErrorText } from "./ui.tsx";

/** Creates a pool, or edits one in place. */
export function PoolForm({ pool, onDone }: { pool?: Pool; onDone?: () => void }) {
  const view = useFleet();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(pool?.name ?? "");
  const [labels, setLabels] = useState(pool?.labels.join(", ") ?? "");
  const [slots, setSlots] = useState<Record<string, number>>(
    Object.fromEntries(pool?.machines.map((m) => [m.machineId, m.slots]) ?? []),
  );
  const [scopes, setScopes] = useState<Scope[]>(pool?.scopes ?? []);
  const [mode, setMode] = useState<ForgejoMode["kind"]>(pool?.forgejoMode.kind ?? "host");
  const [image, setImage] = useState(
    pool?.forgejoMode.kind === "docker" ? pool.forgejoMode.image : "node:22-bookworm",
  );
  const options = availableScopes(view);
  const servesForgejo = scopes.some((s) => isForgejo(view, s));

  const save = useMutation({
    mutationFn: async () => {
      const json = {
        name: name.trim(),
        labels: labels
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean),
        machines: Object.entries(slots)
          .filter(([, n]) => n > 0)
          .map(([machineId, n]) => ({ machineId, slots: n })),
        scopes: scopes.map((s) => ({
          forgeId: s.forgeId,
          kind: s.kind as "user" | "org" | "repo",
          target: s.target,
        })),
        forgejoMode: (mode === "docker"
          ? { kind: "docker", image: image.trim() }
          : { kind: "host" }) as ForgejoMode,
      };
      return pool
        ? call(api.pools[":id"].$put({ param: { id: pool.id }, json }))
        : call(api.pools.$post({ json }));
    },
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: fleetQuery.queryKey });
      if (onDone) onDone();
      else void navigate({ to: "/pools/$id", params: { id } });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const toggle = (scope: Scope) =>
    setScopes((current) =>
      current.some((s) => sameScope(s, scope))
        ? current.filter((s) => !sameScope(s, scope))
        : [...current, scope],
    );

  return (
    <Card className="max-w-2xl px-4 py-4">
      <form onSubmit={submit} className="flex flex-col gap-5 text-[13px]">
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="mac-builders"
          description="Lowercase letters, digits and dashes. Part of each runner's name and a runyard-pool-… label."
          required
        />
        <TextField
          label="Labels"
          value={labels}
          onChange={(e) => setLabels(e.target.value)}
          placeholder="xcode, macos-build"
          description="Comma-separated. GitHub adds self-hosted, the OS and architecture itself; Forgejo jobs match these labels exactly."
        />
        <fieldset>
          <legend className="mb-1.5 text-[12px] font-medium text-ink-2">
            Machines and runners per machine
          </legend>
          {view.machines.length === 0 ? (
            <EmptyLine>Add a machine first.</EmptyLine>
          ) : (
            <div className="divide-y divide-line rounded-md border border-line">
              {view.machines.map((m) => (
                <label key={m.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate">
                    {m.name}{" "}
                    <span className="text-ink-3">{m.os ? osLabel[m.os] : "OS not known yet"}</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={16}
                    aria-label={`Runners on ${m.name}`}
                    className="input !w-20"
                    value={slots[m.id] ?? 0}
                    onChange={(e) =>
                      setSlots({
                        ...slots,
                        [m.id]: Math.max(0, Math.min(16, Number(e.target.value) || 0)),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-[12px] font-medium text-ink-2">Serves</legend>
          {options.length === 0 ? (
            <EmptyLine>Install Runyard's GitHub App or connect Forgejo first (Settings).</EmptyLine>
          ) : (
            <div className="max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {options.map(({ scope, label, forge }) => (
                <label
                  key={`${scope.forgeId}:${scope.kind}:${scope.target}`}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={scopes.some((s) => sameScope(s, scope))}
                    onChange={() => toggle(scope)}
                  />
                  <span className="min-w-0 flex-1 font-mono text-[12.5px]">{label}</span>
                  {forge === "forgejo" && <ForgeBadge />}
                </label>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[12px] text-ink-3">
            A personal GitHub account's repositories each get their own runners: GitHub can't share
            one across them. A Forgejo account or organization shares its runners with all of its
            repositories.
          </p>
        </fieldset>
        {servesForgejo && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[12px] font-medium text-ink-2">Forgejo jobs run</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                checked={mode === "host"}
                onChange={() => setMode("host")}
              />
              On the machine, as the SSH user
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                checked={mode === "docker"}
                onChange={() => setMode("docker")}
              />
              In Docker containers (Docker must already be installed)
            </label>
            {mode === "docker" && (
              <TextField
                label="Default image"
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="node:22-bookworm"
                required
              />
            )}
            <p className="text-[12px] text-ink-3">
              forgejo-runner is published for Linux only, so Forgejo runners install on Linux
              machines with systemd.
            </p>
          </fieldset>
        )}
        {save.error && <ErrorText error={save.error} />}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {pool ? "Save pool" : "Create pool"}
          </Button>
          {onDone && <Button onClick={onDone}>Cancel</Button>}
        </div>
        <p className="text-[12px] text-ink-3">
          Saving changes nothing on machines. Review each machine's changes to apply them.
        </p>
      </form>
    </Card>
  );
}
