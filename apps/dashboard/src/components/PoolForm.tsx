import {
  desiredRunners,
  POOL_NAME,
  type ForgeKind,
  type ForgejoMode,
  type Pool,
  type Scope,
} from "@runyard/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api, call } from "../api.ts";
import { fleetQuery, useFleet } from "../lib/fleet.ts";
import { slug, type PoolDraft } from "../lib/pool-suggestions.ts";
import { availableScopes, isForgejo, sameScope } from "../lib/pools.ts";
import { osLabel } from "../lib/status.ts";
import { Button, TextField } from "./form.tsx";
import { Icon } from "./icons.tsx";
import { ForgeBadge } from "./runners.tsx";
import { Card, EmptyLine, ErrorText } from "./ui.tsx";

const PREVIEW_ROWS = 8;

/**
 * Creates a pool, or edits one in place, in three steps: what it serves, where
 * it runs, and its labels and name. The preview shows the runners it calls for.
 */
export function PoolForm({
  pool,
  initial,
  onDone,
}: {
  pool?: Pool;
  /** Prefilled settings for a new pool, such as a suggestion. */
  initial?: PoolDraft;
  onDone?: () => void;
}) {
  const view = useFleet();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const start = pool ?? initial;
  const [name, setName] = useState(start?.name ?? "");
  // Until the name is typed, it follows the first label.
  const [nameTouched, setNameTouched] = useState(Boolean(start?.name));
  const [labels, setLabels] = useState(start?.labels.join(", ") ?? "");
  const [slots, setSlots] = useState<Record<string, number>>(
    Object.fromEntries(start?.machines.map((m) => [m.machineId, m.slots]) ?? []),
  );
  const [scopes, setScopes] = useState<Scope[]>(start?.scopes ?? []);
  const [mode, setMode] = useState<ForgejoMode["kind"]>(start?.forgejoMode.kind ?? "host");
  const [image, setImage] = useState(
    start?.forgejoMode.kind === "docker" ? start.forgejoMode.image : "node:22-bookworm",
  );
  const options = availableScopes(view);
  const servesForgejo = scopes.some((s) => isForgejo(view, s));
  const labelList = labels
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  const effectiveName = nameTouched ? name.trim() : slug(labelList[0] ?? "") || name.trim();
  const draft: PoolDraft = {
    name: effectiveName,
    labels: labelList,
    machines: Object.entries(slots)
      .filter(([, n]) => n > 0)
      .map(([machineId, n]) => ({ machineId, slots: n })),
    scopes,
    forgejoMode: mode === "docker" ? { kind: "docker", image: image.trim() } : { kind: "host" },
  };

  const preview = useMemo(() => {
    const info = new Map(view.machines.map((m) => [m.id, { name: m.name, os: m.os }]));
    const kinds = new Map<string, ForgeKind>([
      ...view.github.apps.map((a): [string, ForgeKind] => [a.forgeId, "github"]),
      ...view.forgejo.connections.map((c): [string, ForgeKind] => [c.forgeId, "forgejo"]),
    ]);
    return desiredRunners(
      [{ id: pool?.id ?? "new", ...draft, name: draft.name || "pool" }],
      info,
      kinds,
    );
    // The draft is rebuilt each render; its parts are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, pool?.id, draft.name, labels, slots, scopes, mode, image]);
  const unknownOs = draft.machines.filter(
    (m) => !view.machines.find((x) => x.id === m.machineId)?.os,
  );
  const forgejoOffLinux =
    servesForgejo &&
    draft.machines.some((m) => {
      const os = view.machines.find((x) => x.id === m.machineId)?.os;
      return os && os !== "linux";
    });
  const nameError =
    draft.name && !POOL_NAME.test(draft.name)
      ? "Use lowercase letters, digits and dashes, at most 24 characters."
      : null;

  const save = useMutation({
    mutationFn: async () => {
      const json = {
        ...draft,
        scopes: draft.scopes.map((s) => ({
          forgeId: s.forgeId,
          kind: s.kind as "user" | "org" | "repo",
          target: s.target,
        })),
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
  const setSlot = (id: string, n: number) =>
    setSlots({ ...slots, [id]: Math.max(0, Math.min(16, n)) });

  return (
    <Card className="max-w-3xl overflow-hidden">
      <form onSubmit={submit} className="text-[13px]">
        <Step
          n={1}
          title="What it serves"
          hint="Runners register with these accounts or repositories."
        >
          {options.length === 0 ? (
            <EmptyLine>Connect GitHub or Forgejo first, under Settings ▸ Connections.</EmptyLine>
          ) : (
            <div className="max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {options.map(({ scope, label, forge }) => (
                <label
                  key={`${scope.forgeId}:${scope.kind}:${scope.target}`}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-hover"
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
            A personal GitHub account's repositories each get their own runners; an organization or
            Forgejo account shares its runners with all of its repositories.
          </p>
        </Step>

        <Step
          n={2}
          title="Where it runs"
          hint="How many runners each machine gets. Most machines need one."
        >
          {view.machines.length === 0 ? (
            <EmptyLine>Add a machine first.</EmptyLine>
          ) : (
            <div className="divide-y divide-line rounded-md border border-line">
              {view.machines.map((m) => {
                const n = slots[m.id] ?? 0;
                return (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate">
                      <span className={n ? "font-medium" : ""}>{m.name}</span>{" "}
                      <span className="text-ink-3">{m.os ? osLabel[m.os] : "OS not read yet"}</span>
                    </span>
                    <div
                      className="flex items-center gap-1"
                      role="group"
                      aria-label={`Runners on ${m.name}`}
                    >
                      <Button
                        small
                        onClick={() => setSlot(m.id, n - 1)}
                        disabled={n === 0}
                        aria-label={`One fewer on ${m.name}`}
                      >
                        −
                      </Button>
                      <span className="w-7 text-center font-mono tabular">{n}</span>
                      <Button
                        small
                        onClick={() => setSlot(m.id, n + 1)}
                        disabled={n >= 16}
                        aria-label={`One more on ${m.name}`}
                      >
                        +
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {servesForgejo && (
            <fieldset className="mt-3 flex flex-col gap-2">
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
            </fieldset>
          )}
        </Step>

        <Step n={3} title="Labels and name" hint="Workflows pick these runners with runs-on.">
          <div className="grid grid-cols-1 gap-4 min-[700px]:grid-cols-2">
            <TextField
              label="Labels"
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              placeholder="xcode, gpu"
              description="Comma-separated. GitHub adds self-hosted, the OS and architecture itself."
            />
            <TextField
              label="Name"
              value={effectiveName}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
              placeholder="mac-builders"
              description={nameError ?? "Part of each runner's name, and a runyard-pool-… label."}
              required
            />
          </div>
        </Step>

        <div className="border-t border-line bg-sunken/40 px-5 py-4">
          <div className="font-medium">
            {preview.length === 0
              ? "No runners yet"
              : `Will call for ${preview.length} runner${preview.length === 1 ? "" : "s"}`}
          </div>
          {preview.length === 0 ? (
            <p className="mt-1 text-[12.5px] text-ink-2">
              Choose at least one account or repository and one machine.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 font-mono text-[12px]">
              {preview.slice(0, PREVIEW_ROWS).map((d) => (
                <li key={d.key} className="flex flex-wrap gap-x-2">
                  <span>{d.name}</span>
                  <span className="text-ink-3">
                    → {d.scope.target} on {view.machines.find((m) => m.id === d.machineId)?.name}
                  </span>
                </li>
              ))}
              {preview.length > PREVIEW_ROWS && (
                <li className="text-ink-3">and {preview.length - PREVIEW_ROWS} more</li>
              )}
            </ul>
          )}
          {unknownOs.length > 0 && (
            <Note>
              Machines whose OS hasn't been read yet get runners once Runyard reaches them.
            </Note>
          )}
          {forgejoOffLinux && (
            <Note>
              forgejo-runner is published for Linux only, so Forgejo runners on other machines won't
              install.
            </Note>
          )}
          {save.error && <ErrorText className="mt-3" error={save.error} />}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={save.isPending || Boolean(nameError) || !draft.name}
            >
              {pool ? "Save pool" : "Create pool"}
            </Button>
            {onDone && <Button onClick={onDone}>Cancel</Button>}
            <span className="text-[12px] text-ink-3">
              Saving changes nothing on machines; you review each machine's changes next.
            </span>
          </div>
        </div>
      </form>
    </Card>
  );
}

function Step({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-line px-5 py-4 last:border-b-0">
      <div className="mb-3 flex items-start gap-3">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-line text-[11px] font-medium text-ink-2">
          {n}
        </span>
        <div>
          <h3 className="font-medium">{title}</h3>
          <p className="text-[12px] text-ink-2">{hint}</p>
        </div>
      </div>
      <div className="pl-8">{children}</div>
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[12px] text-warn">
      <span className="mt-0.5">
        <Icon name="alert" size={12} />
      </span>
      {children}
    </p>
  );
}
