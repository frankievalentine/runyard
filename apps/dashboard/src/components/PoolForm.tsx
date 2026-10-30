import {
  desiredRunners,
  desiredTemplates,
  POOL_NAME,
  profileTools,
  readinessProblems,
  TOOL_PROFILES,
  toolInstallPlan,
  type CleanupMode,
  type ForgeKind,
  type ForgejoMode,
  type MachineView,
  type Pool,
  type PoolMode,
  type Scope,
  type ToolProfile,
} from "@runyard/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api, call } from "../api.ts";
import { yardQuery, useYard } from "../lib/yard.ts";
import {
  slug,
  suggestPools,
  type PoolDraft,
  type PoolSuggestion,
} from "../lib/pool-suggestions.ts";
import { availableScopes, isForgejo, sameScope } from "../lib/pools.ts";
import { osLabel } from "../lib/status.ts";
import { Button, Choice, TextField } from "./form.tsx";
import { Icon } from "./icons.tsx";
import { ForgeBadge } from "./runners.tsx";
import { Card, EmptyLine, ErrorText } from "./ui.tsx";

const PREVIEW_ROWS = 8;

const MODES = [
  [
    "persistent",
    "Persistent",
    "Each slot is a runner that stays registered and waits for jobs. Best for warm caches.",
  ],
  [
    "onDemand",
    "On demand",
    "A fresh runner for each queued job, removed after it. Runyard installs the runner software once. Linux and macOS.",
  ],
] as const;

const CLEANUPS = [
  ["off", "Keep everything", "Nothing is cleared between jobs."],
  ["workspace", "Clear the workspace", "The job's checkout and build output."],
  [
    "docker",
    "Workspace and Docker",
    "Also stopped containers, dangling images, unused networks and anonymous volumes, for every account on the machine.",
  ],
] as const;

const STEPS = ["What it's for", "Where it runs", "Check and create"] as const;
export type StepNo = 1 | 2 | 3;

/** Tools a new pool installs where missing: the basics, and Docker when its labels ask for it. */
function defaultTools(labels: string[]): ToolProfile[] {
  return labels.some((l) => l.toLowerCase() === "docker")
    ? ["essentials", "build", "docker"]
    : ["essentials", "build"];
}

/** A machine Runyard can reach, so a review can run on it. */
const reachable = (m: MachineView) =>
  m.connection.state === "connected" || m.connection.state === "stale";

/**
 * Creates or edits a pool in three short steps: what it's for (a waiting job,
 * or repositories and labels), where it runs, and a summary with sensible
 * defaults, each changeable in place. Saving opens the pool with each machine's
 * review ready to run, so the next step is always on screen.
 */
export function PoolForm({
  pool,
  initial,
  onDone,
  onCancel,
  header,
}: {
  pool?: Pool;
  /** Prefilled settings for a new pool, such as a suggestion. */
  initial?: PoolDraft;
  /** Instead of opening the pool after saving, as when editing it in place. */
  onDone?: (poolId: string) => void;
  onCancel?: () => void;
  /** The page's header, which can change with the step. */
  header?: (step: StepNo) => ReactNode;
}) {
  const view = useYard();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const start = pool ?? initial;
  const [step, setStep] = useState<StepNo>(
    start?.scopes.length && start.machines.length ? 3 : start?.scopes.length ? 2 : 1,
  );
  // Computed once, so suggestions don't reshuffle while the form is filled in.
  const [suggestions] = useState<PoolSuggestion[]>(() => (start ? [] : suggestPools(view)));
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
  const [poolMode, setPoolMode] = useState<PoolMode>(start?.mode ?? "persistent");
  const [toolProfiles, setToolProfiles] = useState<ToolProfile[]>(
    start?.toolProfiles ?? (pool ? [] : defaultTools(start?.labels ?? [])),
  );
  // Until tools are picked by hand, a new pool's follow its labels (docker adds Docker).
  const [toolsTouched, setToolsTouched] = useState(Boolean(pool || start?.toolProfiles));
  const [cleanup, setCleanup] = useState<CleanupMode>(
    start?.cleanup ?? (pool ? "off" : "workspace"),
  );
  // Which summary lines are open for changing.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const onDemand = poolMode === "onDemand";
  const options = availableScopes(view);
  const servesForgejo = scopes.some((s) => isForgejo(view, s));
  const labelList = labels
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  const profiles = toolsTouched ? toolProfiles : defaultTools(labelList);
  const chosen = view.machines.filter((m) => (slots[m.id] ?? 0) > 0);
  // Labels every chosen machine can honestly carry, from its last check, not yet in the list.
  const suggestedLabels =
    chosen.length && chosen.every((m) => m.readiness)
      ? (chosen[0]!.readiness?.capabilities ?? []).filter(
          (c) =>
            chosen.every((m) => m.readiness?.capabilities.includes(c)) &&
            !labelList.some((l) => l.toLowerCase() === c),
        )
      : [];
  const effectiveName = nameTouched ? name.trim() : slug(labelList[0] ?? "") || name.trim();
  const draft: PoolDraft & { mode: PoolMode; toolProfiles: ToolProfile[]; cleanup: CleanupMode } = {
    name: effectiveName,
    labels: labelList,
    machines: Object.entries(slots)
      .filter(([, n]) => n > 0)
      .map(([machineId, n]) => ({ machineId, slots: n })),
    scopes,
    forgejoMode: mode === "docker" ? { kind: "docker", image: image.trim() } : { kind: "host" },
    mode: poolMode,
    toolProfiles: profiles,
    // One-job runners start fresh each time; only persistent runners keep a workspace.
    cleanup: poolMode === "persistent" ? cleanup : "off",
  };

  const preview = useMemo(() => {
    const info = new Map(view.machines.map((m) => [m.id, { name: m.name, os: m.os }]));
    const kinds = new Map<string, ForgeKind>([
      ...view.github.apps.map((a): [string, ForgeKind] => [a.forgeId, "github"]),
      ...view.forgejo.connections.map((c): [string, ForgeKind] => [c.forgeId, "forgejo"]),
    ]);
    const asPool: Pool = {
      id: pool?.id ?? "new",
      paused: false,
      ...draft,
      name: draft.name || "pool",
    };
    return {
      runners: desiredRunners([asPool], info, kinds),
      templates: desiredTemplates([asPool], info, kinds),
    };
    // The draft is rebuilt each render; its parts are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, pool?.id, draft.name, labels, slots, scopes, mode, image, poolMode]);
  const osOf = (machineId: string) => view.machines.find((x) => x.id === machineId)?.os;
  const unknownOs = draft.machines.filter((m) => !osOf(m.machineId));
  const forgejoOffLinux =
    servesForgejo &&
    draft.machines.some((m) => {
      const os = osOf(m.machineId);
      return os && os !== "linux";
    });
  const offPlatform =
    onDemand &&
    draft.machines.some((m) => {
      const os = osOf(m.machineId);
      return os && os !== "linux" && os !== "macos";
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
      await queryClient.invalidateQueries({ queryKey: yardQuery.queryKey });
      if (onDone) onDone(id);
      else void navigate({ to: "/pools/$id", params: { id }, search: { setup: true } });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (step < 3) setStep((step + 1) as StepNo);
    else save.mutate();
  };
  const toggleScope = (scope: Scope) =>
    setScopes((current) =>
      current.some((s) => sameScope(s, scope))
        ? current.filter((s) => !sameScope(s, scope))
        : [...current, scope],
    );
  const setSlot = (id: string, n: number) =>
    setSlots({ ...slots, [id]: Math.max(0, Math.min(16, n)) });
  const toggleOpen = (key: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const applySuggestion = (s: PoolSuggestion) => {
    setScopes(s.draft.scopes);
    setLabels(s.draft.labels.join(", "));
    setSlots(Object.fromEntries(s.draft.machines.map((m) => [m.machineId, m.slots])));
    setName(s.draft.name);
    setNameTouched(true);
    if (s.draft.mode) setPoolMode(s.draft.mode);
    setStep(2);
  };
  const total = draft.machines.reduce((n, m) => n + m.slots, 0);
  const canContinue = step === 1 ? scopes.length > 0 : step === 2 ? total > 0 : true;
  const mayVisit = (n: StepNo) => n === 1 || scopes.length > 0;

  const form = (
    <Card className="max-w-3xl overflow-hidden">
      <form onSubmit={submit} className="text-[13px]">
        <ol className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line px-5 py-3 text-[12.5px]">
          {STEPS.map((step3, i) => {
            const title = pool && i === 2 ? "Check and save" : step3;
            const n = (i + 1) as StepNo;
            const current = n === step;
            return (
              <li key={title}>
                <button
                  type="button"
                  onClick={() => setStep(n)}
                  disabled={!mayVisit(n) || (n === 3 && total === 0)}
                  aria-current={current ? "step" : undefined}
                  className={`flex items-center gap-2 disabled:opacity-50 ${current ? "font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
                >
                  <span
                    className={`flex size-5 items-center justify-center rounded-full border text-[11px] ${current ? "border-accent bg-accent text-white" : n < step ? "border-accent text-accent" : "border-line"}`}
                  >
                    {n}
                  </span>
                  {/* On a phone only the current step is named; the others are their numbers. */}
                  <span className={current ? "" : "max-sm:sr-only"}>{title}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {step === 1 && (
          <div className="flex flex-col gap-5 px-5 py-4">
            {suggestions.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="font-medium">From what's waiting</h3>
                <div className="grid grid-cols-1 gap-2 min-[700px]:grid-cols-2">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => applySuggestion(s)}
                      className="flex flex-col gap-1 rounded-md border border-line px-3 py-2.5 text-left hover:border-accent hover:bg-accent/5"
                    >
                      <span className="font-medium">{s.title}</span>
                      <span className="text-[12px] text-ink-2">{s.detail}</span>
                      <span className="mt-0.5 text-[12px] font-medium text-accent">
                        Make runners for this →
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">
                {suggestions.length ? "Or choose yourself" : "Which repositories or accounts"}
              </h3>
              {options.length === 0 ? (
                <EmptyLine>
                  Connect GitHub or Forgejo first, under{" "}
                  <Link to="/settings/connections" className="text-accent hover:underline">
                    Settings ▸ Connections
                  </Link>
                  .
                </EmptyLine>
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
                        onChange={() => toggleScope(scope)}
                      />
                      <span className="min-w-0 flex-1 font-mono text-[12.5px]">{label}</span>
                      <ForgeBadge forge={forge} />
                    </label>
                  ))}
                </div>
              )}
              <p className="text-[12px] text-ink-3">
                A personal GitHub account's repositories each get their own runners; an organization
                or Forgejo account shares its runners with all of its repositories.
              </p>
              <TextField
                label="Labels"
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                placeholder="linux-build"
                description="What your workflows ask for in runs-on, comma-separated. GitHub adds self-hosted, the OS and architecture itself."
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-2 px-5 py-4">
            <h3 className="font-medium">Which machines</h3>
            <p className="text-[12px] text-ink-2">
              Each machine you pick gets one runner. What a machine is missing is installed by its
              review.
            </p>
            {view.machines.length === 0 ? (
              <EmptyLine>
                No machines yet.{" "}
                <Link to="/machines/add" className="text-accent hover:underline">
                  Add one
                </Link>{" "}
                first.
              </EmptyLine>
            ) : (
              <div className="divide-y divide-line rounded-md border border-line">
                {view.machines.map((m) => (
                  <MachineChoice
                    key={m.id}
                    m={m}
                    on={(slots[m.id] ?? 0) > 0}
                    onToggle={(on) => setSlot(m.id, on ? Math.max(1, slots[m.id] ?? 0) : 0)}
                    profiles={profiles}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col">
            <ul className="divide-y divide-line">
              <Summary
                label="Serves"
                value={
                  scopes.length
                    ? scopes.map((s) => s.target).join(", ")
                    : "Nothing yet: pick a repository or account"
                }
                onChange={() => setStep(1)}
              />
              <Summary
                label="Labels"
                value={
                  labelList.length ? (
                    <span className="font-mono">{labelList.join(", ")}</span>
                  ) : (
                    "None besides Runyard's own"
                  )
                }
                onChange={() => setStep(1)}
              >
                {suggestedLabels.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                    <span>
                      {chosen.length === 1 ? "This machine has" : "Every chosen machine has"}:
                    </span>
                    {suggestedLabels.map((l) => (
                      <button
                        key={l}
                        type="button"
                        className="rounded-md border border-line bg-card px-2 py-0.5 font-mono text-[12px] text-ink hover:bg-hover"
                        onClick={() => setLabels(labelList.length ? `${labels.trim()}, ${l}` : l)}
                      >
                        + {l}
                      </button>
                    ))}
                  </div>
                )}
              </Summary>
              <Summary
                label="Runs on"
                value={chosen.map((m) => m.name).join(", ") || "No machines yet"}
                onChange={() => setStep(2)}
              />
              <Summary
                label="Runners"
                value={
                  onDemand
                    ? `On demand: a fresh runner per job, up to ${total} at once`
                    : total === chosen.length
                      ? `Persistent: one per machine, kept registered`
                      : `Persistent: ${total} kept registered`
                }
                open={open.has("mode")}
                onChange={() => toggleOpen("mode")}
              >
                <fieldset className="grid grid-cols-1 gap-2 min-[700px]:grid-cols-2">
                  <legend className="sr-only">How runners run</legend>
                  {MODES.map(([value, title, text]) => (
                    <Choice
                      key={value}
                      type="radio"
                      name="poolMode"
                      checked={poolMode === value}
                      onChange={() => setPoolMode(value)}
                      title={title}
                      detail={text}
                    />
                  ))}
                </fieldset>
                <p className="mt-3 mb-1.5 text-[12px] text-ink-2">
                  {onDemand
                    ? "The most one-job runners each machine runs at once."
                    : "How many runners each machine gets. Most machines need one."}
                </p>
                <div className="divide-y divide-line rounded-md border border-line">
                  {chosen.map((m) => {
                    const n = slots[m.id] ?? 0;
                    return (
                      <div key={m.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                        <div
                          className="flex items-center gap-1"
                          role="group"
                          aria-label={`Runners on ${m.name}`}
                        >
                          <Button
                            small
                            onClick={() => setSlot(m.id, n - 1)}
                            disabled={n <= 1}
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
              </Summary>
              <Summary
                label="Tools"
                value={
                  profiles.length
                    ? `Installs ${profiles.map((p) => TOOL_PROFILES[p].title).join(", ")} where missing`
                    : "Installs nothing"
                }
                open={open.has("tools")}
                onChange={() => toggleOpen("tools")}
              >
                <div className="grid grid-cols-1 gap-2 min-[700px]:grid-cols-3">
                  {(Object.keys(TOOL_PROFILES) as ToolProfile[]).map((p) => {
                    const on = profiles.includes(p);
                    return (
                      <Choice
                        key={p}
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          setToolsTouched(true);
                          setToolProfiles(on ? profiles.filter((x) => x !== p) : [...profiles, p]);
                        }}
                        title={TOOL_PROFILES[p].title}
                        detail={TOOL_PROFILES[p].detail}
                      />
                    );
                  })}
                </div>
              </Summary>
              {!onDemand && (
                <Summary
                  label="After each job"
                  value={CLEANUPS.find(([v]) => v === cleanup)![1]}
                  open={open.has("cleanup")}
                  onChange={() => toggleOpen("cleanup")}
                >
                  <p className="mb-2 text-[12px] text-ink-2">
                    Persistent runners keep their workspace and Docker data between jobs, which
                    keeps builds warm but lets one job affect the next. GitHub runners on Linux and
                    macOS; changing it restarts each runner while it's idle.
                  </p>
                  <div className="grid grid-cols-1 gap-2 min-[700px]:grid-cols-3">
                    {CLEANUPS.map(([value, title, detail]) => (
                      <Choice
                        key={value}
                        type="radio"
                        name="cleanup"
                        checked={cleanup === value}
                        onChange={() => setCleanup(value)}
                        title={title}
                        detail={detail}
                      />
                    ))}
                  </div>
                </Summary>
              )}
              {servesForgejo && (
                <Summary
                  label="Forgejo jobs"
                  value={
                    mode === "docker"
                      ? `In Docker containers (${image || "no image"})`
                      : "On the machine"
                  }
                  open={open.has("forgejo")}
                  onChange={() => toggleOpen("forgejo")}
                >
                  <fieldset className="flex flex-col gap-2">
                    <legend className="sr-only">Forgejo jobs run</legend>
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
                      In Docker containers (requires Docker)
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
                </Summary>
              )}
              <Summary
                label="Name"
                value={<span className="font-mono">{effectiveName || "none yet"}</span>}
                open={open.has("name") || Boolean(nameError) || !effectiveName}
                onChange={() => toggleOpen("name")}
              >
                <TextField
                  label="Pool name"
                  value={effectiveName}
                  onChange={(e) => {
                    setNameTouched(true);
                    setName(e.target.value);
                  }}
                  placeholder="linux-builders"
                  description={
                    nameError ?? "Part of each runner's name, and a runyard-pool-… label."
                  }
                  required
                />
              </Summary>
            </ul>

            <div className="border-t border-line bg-sunken/40 px-5 py-3 text-[12px]">
              <div className="mb-1 font-medium text-ink-2">
                {onDemand ? "Runner software" : "Runners it registers"}
              </div>
              {onDemand ? (
                preview.templates.map((t) => (
                  <div key={t.key} className="text-ink-2">
                    <span className="font-medium text-ink">
                      {view.machines.find((m) => m.id === t.machineId)?.name}
                    </span>{" "}
                    keeps {t.runnerKind === "forgejo" ? "forgejo-runner" : "GitHub's runner"} at{" "}
                    <span className="font-mono">{t.path}</span>
                  </div>
                ))
              ) : (
                <ul className="space-y-0.5 font-mono">
                  {preview.runners.slice(0, PREVIEW_ROWS).map((d) => (
                    <li key={d.key} className="flex flex-wrap gap-x-2">
                      <span>{d.name}</span>
                      <span className="text-ink-3">
                        → {d.scope.target} on{" "}
                        {view.machines.find((m) => m.id === d.machineId)?.name}
                      </span>
                    </li>
                  ))}
                  {preview.runners.length > PREVIEW_ROWS && (
                    <li className="text-ink-3">and {preview.runners.length - PREVIEW_ROWS} more</li>
                  )}
                </ul>
              )}
              {offPlatform && (
                <Note>
                  On-demand runners run on Linux and macOS for now; other machines are skipped.
                </Note>
              )}
              {unknownOs.length > 0 && (
                <Note>
                  Machines whose OS hasn't been read yet get runners once Runyard reaches them.
                </Note>
              )}
              {forgejoOffLinux && (
                <Note>
                  forgejo-runner is published for Linux only, so Forgejo runners on other machines
                  won't install.
                </Note>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          {step > 1 && (
            <Button onClick={() => setStep((step - 1) as StepNo)} disabled={save.isPending}>
              Back
            </Button>
          )}
          {onCancel && (
            <Button onClick={onCancel} disabled={save.isPending}>
              Cancel
            </Button>
          )}
          <span className="flex-1" />
          <Button
            type="submit"
            variant="primary"
            disabled={
              !canContinue ||
              (step === 3 && (save.isPending || Boolean(nameError) || !draft.name || total === 0))
            }
          >
            {step < 3
              ? "Continue"
              : save.isPending
                ? "Saving…"
                : pool
                  ? "Save and review"
                  : "Create and review"}
          </Button>
        </div>
        {save.error && <ErrorText className="px-5 pb-3" error={save.error} />}
      </form>
    </Card>
  );
  if (!header) return form;
  return (
    <div>
      {header(step)}
      <div className="mt-6">{form}</div>
    </div>
  );
}

/** A machine to pick, with what its review would do there, or why it can't be picked yet. */
function MachineChoice({
  m,
  on,
  onToggle,
  profiles,
}: {
  m: MachineView;
  on: boolean;
  onToggle: (on: boolean) => void;
  profiles: ToolProfile[];
}) {
  const ok = reachable(m) && m.os !== null;
  const install =
    m.os && m.readiness ? toolInstallPlan(m.os, m.readiness, profileTools(profiles)) : null;
  // Only what every runner needs; label checks belong to the machine's other pools.
  const problems = readinessProblems(m.readiness).filter(
    (p) => p.tier === "required" && !p.id.startsWith("tool-"),
  );
  return (
    <label
      className={`flex items-start gap-3 px-3 py-2.5 ${ok ? "cursor-pointer hover:bg-hover" : "opacity-60"}`}
    >
      <input
        type="checkbox"
        className="mt-[3px] shrink-0"
        checked={on}
        disabled={!ok && !on}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{m.name}</span>
          <span className="text-[12px] text-ink-3">{m.os ? osLabel[m.os] : "OS not read yet"}</span>
        </span>
        <span className="block text-[12px] text-ink-2">
          {!ok ? (
            <>
              Runyard can't reach it yet.{" "}
              <Link
                to="/machines/$id"
                params={{ id: m.id }}
                className="text-accent hover:underline"
              >
                Finish its setup
              </Link>
            </>
          ) : !m.readiness ? (
            "Not checked yet; its review checks it first."
          ) : install && (install.install.length || install.blocked.length) ? (
            <>
              {install.install.length > 0 && `Runyard will install ${install.install.join(", ")}.`}
              {install.blocked.map((b) => (
                <span key={b.reason} className="block text-warn">
                  Needs {b.tools.join(", ")} by hand: {b.reason}
                </span>
              ))}
            </>
          ) : (
            "Has everything it needs."
          )}
          {ok &&
            problems.map((p) => (
              <span key={p.id} className="block text-warn">
                {p.title}: {p.value}
              </span>
            ))}
        </span>
      </span>
    </label>
  );
}

/** A summary line: what's set, with Change; open, its controls below. */
function Summary({
  label,
  value,
  open,
  onChange,
  children,
}: {
  label: string;
  value: ReactNode;
  open?: boolean;
  onChange: () => void;
  children?: ReactNode;
}) {
  return (
    <li className="px-5 py-3">
      <div className="flex items-baseline gap-3">
        <span className="w-28 shrink-0 text-[12px] text-ink-2">{label}</span>
        <span className="min-w-0 flex-1 break-words">{value}</span>
        <button
          type="button"
          onClick={onChange}
          className="shrink-0 text-[12px] font-medium text-accent hover:underline"
        >
          {open ? "Done" : "Change"}
        </button>
      </div>
      {/* Children that aren't controls (label hints) show always; controls only when open. */}
      {children && (open || open === undefined) && (
        <div className="mt-2.5 min-[600px]:pl-31">{children}</div>
      )}
    </li>
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
