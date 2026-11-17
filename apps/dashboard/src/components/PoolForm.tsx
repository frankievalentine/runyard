import {
  desiredRunners,
  desiredTemplates,
  forgeKindsOf,
  POOL_NAME,
  poolRequiredTools,
  poolTools,
  readinessProblems,
  TOOL_PROFILES,
  toolInstallPlan,
  toolList,
  type ToolId,
  type CleanupMode,
  type ForgeKind,
  type ForgejoMode,
  type MachineView,
  type Pool,
  type PoolMode,
  type Scope,
  type ToolProfile,
  type YardView,
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
import { availableScopes, isForgejo, sameScope, type ScopeOption } from "../lib/pools.ts";
import { osLine } from "../lib/status.ts";
import { MachineChanges } from "./changes.tsx";
import { Icon } from "./icons.tsx";
import { ErrLine, machineChip, NpNote } from "./pool/bits.tsx";
import { RouteLine } from "./RouteLine.tsx";
import { Chip, Panel, Sign, TtButton, ttButton } from "./tt.tsx";
import { ErrorText } from "./ui.tsx";
import { WorkflowSnippet } from "./UseInWorkflow.tsx";

const PREVIEW_ROWS = 8;

const bodyBox =
  "flex min-w-0 flex-col gap-[18px] rounded-xl border border-tt-rule bg-tt-card px-4 py-[18px] text-[14px] text-tt-ink lg:min-h-[460px] lg:px-6 lg:py-[22px]";

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

export type StepNo = 1 | 2 | 3 | 4;

/** Tools a new pool installs where missing: the basics, and Docker when its labels ask for it. */
function defaultTools(labels: string[]): ToolProfile[] {
  return labels.some((l) => l.toLowerCase() === "docker")
    ? ["essentials", "build", "docker"]
    : ["essentials", "build"];
}

/** A machine Runyard can reach, so a review can run on it. */
const reachable = (m: MachineView) =>
  m.connection.state === "connected" || m.connection.state === "stale";

/** "a, b and c". */
const listOf = (xs: string[]) =>
  xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** A machine's platform sign: its place in the yard, dimmed offline, red when SSH fails. */
export function machineSign(view: YardView, m: MachineView, large = false) {
  return (
    <Sign
      n={view.machines.indexOf(m) + 1}
      large={large}
      tone={
        m.connection.state === "error"
          ? "error"
          : m.connection.state === "offline"
            ? "dim"
            : "normal"
      }
    />
  );
}

/**
 * Creates or edits a pool, as the Timetable design's New pool: what it's for (a waiting job, or
 * repositories and labels), where it runs, a check with sensible defaults, each changeable in
 * place, then each machine's review. A dark summary beside it shows the pool as it's built.
 * Saving changes nothing on a machine; each review runs only when asked.
 */
export function PoolForm({
  pool,
  initial,
  onSaved,
  onCancel,
  onFinish,
}: {
  pool?: Pool;
  /** Prefilled settings for a new pool, such as a suggestion. */
  initial?: PoolDraft;
  /** Instead of each machine's review after saving: the caller takes over, as for a runner's move. */
  onSaved?: (poolId: string) => void;
  /** Cancel's target; without it, back to the Pools list. */
  onCancel?: () => void;
  /** Leaving after the reviews ("Open the pool", "Review later"); without it, opens the pool. */
  onFinish?: (poolId: string) => void;
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
  // After saving: the pool, the machines whose reviews are shown, and which of them are done.
  const [saved, setSaved] = useState<{ id: string; name: string; machineIds: string[] } | null>(
    null,
  );
  const [settled, setSettled] = useState<Set<string>>(new Set());

  const onDemand = poolMode === "onDemand";
  const options = availableScopes(view);
  const servesForgejo = scopes.some((s) => isForgejo(view, s));
  // GitHub doesn't say which repositories are public until a review checks them.
  const servesGitHubRepo = scopes.some((s) => s.kind === "repo" && !isForgejo(view, s));
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
  // What the pool installs by itself, because of how its runners run, beside the profiles.
  const kinds = forgeKindsOf(view);
  const required = poolRequiredTools(draft, kinds);

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
  const nameError = !draft.name
    ? "Give the pool a name."
    : !POOL_NAME.test(draft.name)
      ? "Use lowercase letters, digits and dashes, at most 24 characters."
      : view.pools.pools.some((p) => p.name === draft.name && p.id !== pool?.id)
        ? `There's already a pool named ${draft.name}. Pick another name.`
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
      if (onSaved) {
        onSaved(id);
        return;
      }
      // Each machine it now runs on, and any it left, which its review cleans up.
      const machineIds = [
        ...new Set([
          ...draft.machines.map((m) => m.machineId),
          ...(pool?.machines.map((m) => m.machineId) ?? []),
        ]),
      ].filter((mid) => view.machines.some((m) => m.id === mid));
      setSaved({ id, name: draft.name, machineIds });
      setStep(4);
      window.scrollTo({ top: 0 });
    },
  });
  const finish = (id: string) =>
    onFinish ? onFinish(id) : void navigate({ to: "/pools/$id", params: { id } });
  const cancel = () => (onCancel ? onCancel() : void navigate({ to: "/pools" }));
  const goTo = (n: StepNo) => {
    setStep(n);
    window.scrollTo({ top: 0 });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (step < 3) goTo((step + 1) as StepNo);
    else if (step === 3 && !nameError && total > 0 && !save.isPending) save.mutate();
  };
  // Choosing a Forgejo account drops its single repositories: its runner serves them already.
  const covers = (account: Scope, s: Scope) =>
    s.kind === "repo" &&
    account.kind !== "repo" &&
    s.forgeId === account.forgeId &&
    s.target.split("/")[0]!.toLowerCase() === account.target.toLowerCase();
  const toggleScope = (scope: Scope) =>
    setScopes((current) =>
      current.some((s) => sameScope(s, scope))
        ? current.filter((s) => !sameScope(s, scope))
        : [...current.filter((s) => !(isForgejo(view, scope) && covers(scope, s))), scope],
    );
  const setSlot = (id: string, n: number) =>
    setSlots({ ...slots, [id]: Math.max(0, Math.min(16, n)) });
  const applySuggestion = (s: PoolSuggestion) => {
    setScopes(s.draft.scopes);
    setLabels(s.draft.labels.join(", "));
    setSlots(Object.fromEntries(s.draft.machines.map((m) => [m.machineId, m.slots])));
    setName(s.draft.name);
    setNameTouched(true);
    if (s.draft.mode) setPoolMode(s.draft.mode);
    goTo(2);
  };
  const total = draft.machines.reduce((n, m) => n + m.slots, 0);
  const publicScopes = scopes.filter((s) => publicNote(view, s));

  const stops = [
    "What it's for",
    "Where it runs",
    pool ? "Check and save" : "Check and create",
    ...(onSaved ? [] : ["Review and run"]),
  ];
  const routeLine = (
    <>
      <div className="mt-1 mb-5 max-lg:mb-2 max-lg:[&_.top-6]:hidden max-lg:[&>ol]:!pb-1">
        {/* On a phone the line carries no labels; the step is named under it. */}
        <RouteLine
          stops={stops.map((label, i) => ({
            id: label,
            label,
            done: saved ? i < 3 : i < step - 1,
          }))}
          current={step - 1}
          // Done stops can be opened again, until the pool is saved.
          onSelect={
            saved
              ? undefined
              : (i) => {
                  if (i === 0 || scopes.length) goTo((i + 1) as StepNo);
                }
          }
        />
      </div>
      <p className="mb-3 text-[13px] text-tt-ink-2 lg:hidden">
        Step {step} of {stops.length}: <b className="text-tt-ink">{stops[step - 1]}</b>
      </p>
    </>
  );

  const foot = (left: ReactNode, right: ReactNode, why?: string | null) => (
    <div className="mt-auto flex flex-wrap items-center justify-end gap-2.5 pt-1.5 max-lg:[&>button]:flex-1 max-lg:[&>a]:flex-1">
      {why && (
        <span className="mr-auto max-lg:basis-full">
          <ErrLine id="np-why">{why}</ErrLine>
        </span>
      )}
      {left}
      {right}
    </div>
  );

  let body: ReactNode;
  if (step === 1) {
    const ok = scopes.length > 0;
    body = (
      <>
        <StepHead title="What it's for">
          Which repositories this pool's runners take jobs from, and the labels your workflows ask
          for.
        </StepHead>
        {suggestions.length > 0 && (
          <div>
            <H3>From what's waiting</H3>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => applySuggestion(s)}
                  className="flex flex-col gap-[3px] rounded-[10px] border-[1.5px] border-tt-rule-2 bg-tt-card px-3.5 py-3 text-left text-tt-ink hover:border-tt-loco"
                >
                  <b className="font-bold">{s.title}</b>
                  <small className="text-[12.5px] text-tt-ink-2">{s.detail}</small>
                  <em className="mt-[3px] text-[12.5px] font-bold text-tt-busy-ink not-italic">
                    Make runners for this →
                  </em>
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <H3>{suggestions.length ? "Or choose yourself" : "Which repositories or accounts"}</H3>
          {options.length === 0 ? (
            <p className="text-[13.5px] text-tt-ink-2">
              Connect GitHub or Forgejo first, under{" "}
              <Link to="/settings/connections" className="font-bold text-tt-ink underline">
                Settings ▸ Connections
              </Link>
              .
            </p>
          ) : (
            <div
              role="group"
              aria-label="Repositories and accounts"
              className="max-h-[22rem] overflow-y-auto rounded-[10px] border border-tt-rule"
            >
              {options.map((o) => (
                <ScopeRow
                  key={`${o.scope.forgeId}:${o.scope.kind}:${o.scope.target}`}
                  option={o}
                  view={view}
                  scopes={scopes}
                  onToggle={() => toggleScope(o.scope)}
                />
              ))}
            </div>
          )}
          <NpNote>
            Personal GitHub repositories each get their own runners. An organization or a Forgejo
            account shares one runner across its repositories, or pick single Forgejo repositories
            under it.
          </NpNote>
        </div>
        <Field
          id="np-labels"
          label="Labels"
          value={labels}
          onChange={setLabels}
          placeholder="linux-build"
          hint="What your workflows ask for in runs-on, comma-separated. GitHub adds self-hosted, the OS and architecture itself."
        />
        {foot(
          <TtButton onClick={cancel}>Cancel</TtButton>,
          <button
            type="submit"
            className={ttButton.primary}
            disabled={!ok}
            aria-describedby={ok ? undefined : "np-why"}
          >
            Continue
          </button>,
          ok ? null : "Choose at least one repository or account to continue.",
        )}
      </>
    );
  } else if (step === 2) {
    const ok = total > 0;
    body = (
      <>
        <StepHead title="Where it runs">
          Each machine you pick gets one runner. What a machine is missing is installed by its
          review.
        </StepHead>
        <div>
          <H3>Which machines</H3>
          {view.machines.length === 0 ? (
            <p className="text-[13.5px] text-tt-ink-2">
              No machines yet.{" "}
              <Link to="/machines/add" className="font-bold text-tt-ink underline">
                Add one
              </Link>{" "}
              first.
            </p>
          ) : (
            <div
              role="group"
              aria-label="Machines"
              className="overflow-hidden rounded-[10px] border border-tt-rule"
            >
              {view.machines.map((m) => (
                <MachineChoice
                  key={m.id}
                  m={m}
                  view={view}
                  on={(slots[m.id] ?? 0) > 0}
                  onToggle={(on) => setSlot(m.id, on ? Math.max(1, slots[m.id] ?? 0) : 0)}
                  tools={poolTools(draft, kinds, m.os)}
                />
              ))}
            </div>
          )}
        </div>
        {foot(
          <TtButton onClick={() => goTo(1)}>Back</TtButton>,
          <button
            type="submit"
            className={ttButton.primary}
            disabled={!ok}
            aria-describedby={ok ? undefined : "np-why"}
          >
            Continue
          </button>,
          ok ? null : "Pick at least one machine Runyard can reach to continue.",
        )}
      </>
    );
  } else if (step === 3) {
    body = (
      <>
        <StepHead title={pool ? "Check and save" : "Check and create"}>
          {pool ? "Saving" : "Creating the pool"} changes nothing on a machine. Each machine's
          review comes next.
        </StepHead>
        <div className="border-t border-tt-rule">
          <Line label="Serves" onChange={() => goTo(1)} what="what it serves">
            {scopes.length
              ? scopes.map((s) => s.target).join(", ")
              : "Nothing yet: pick a repository or account"}
          </Line>
          <Line label="Labels" onChange={() => goTo(1)} what="labels">
            {labelList.length ? (
              <span className="font-board text-[13px]">{labelList.join(", ")}</span>
            ) : (
              "None besides Runyard's own"
            )}
            {suggestedLabels.length > 0 && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-tt-ink-3">
                {chosen.length === 1 ? "This machine has" : "Every chosen machine has"}:
                {suggestedLabels.map((l) => (
                  <button
                    key={l}
                    type="button"
                    className={`${ttButton.secondary} px-2 py-1 font-board text-[12px]`}
                    onClick={() => setLabels(labelList.length ? `${labels.trim()}, ${l}` : l)}
                  >
                    + {l}
                  </button>
                ))}
              </p>
            )}
          </Line>
          <Line label="Runs on" onChange={() => goTo(2)} what="machines">
            {chosen.map((m) => m.name).join(", ") || "No machines yet"}
          </Line>
          <Line label="Runners">
            <Opts label="How runners run">
              {MODES.map(([value, title, text]) => (
                <Opt
                  key={value}
                  on={poolMode === value}
                  onClick={() => setPoolMode(value)}
                  title={title}
                  detail={text}
                />
              ))}
            </Opts>
            <NpNote className="mb-1">
              {onDemand
                ? "The most one-job runners each machine runs at once."
                : "How many runners each machine gets. Most machines need one."}
            </NpNote>
            {chosen.map((m) => {
              const n = slots[m.id] ?? 0;
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-2.5 py-[5px]"
                  role="group"
                  aria-label={`Runners on ${m.name}`}
                >
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <TtButton
                    className="size-8 !p-0"
                    onClick={() => setSlot(m.id, n - 1)}
                    disabled={n <= 1}
                    aria-label={`One fewer on ${m.name}`}
                  >
                    −
                  </TtButton>
                  <output
                    aria-live="polite"
                    className="min-w-[22px] text-center font-board text-[14px] font-bold"
                  >
                    {n}
                  </output>
                  <TtButton
                    className="size-8 !p-0"
                    onClick={() => setSlot(m.id, n + 1)}
                    disabled={n >= 16}
                    aria-label={`One more on ${m.name}`}
                  >
                    +
                  </TtButton>
                </div>
              );
            })}
          </Line>
          <Line label="Tools">
            {(Object.keys(TOOL_PROFILES) as ToolProfile[]).map((p) => {
              const on = profiles.includes(p);
              return (
                <label key={p} className="flex cursor-pointer items-start gap-2.5 py-1.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 flex-none accent-tt-ink"
                    checked={on}
                    onChange={() => {
                      setToolsTouched(true);
                      setToolProfiles(on ? profiles.filter((x) => x !== p) : [...profiles, p]);
                    }}
                  />
                  <span>
                    <b className="block text-[13.5px]">{TOOL_PROFILES[p].title}</b>
                    <small className="block text-[12.5px] text-tt-ink-2">
                      {TOOL_PROFILES[p].detail}
                    </small>
                  </span>
                </label>
              );
            })}
            {required.map((r) => (
              <NpNote key={r.tool}>
                Always included: <b className="font-bold text-tt-ink">{r.title}</b>, {r.why}.
              </NpNote>
            ))}
          </Line>
          {!onDemand && (
            <Line label="After each job">
              <Opts label="After each job">
                {CLEANUPS.map(([value, title, detail]) => (
                  <Opt
                    key={value}
                    on={cleanup === value}
                    onClick={() => setCleanup(value)}
                    title={title}
                    detail={detail}
                  />
                ))}
              </Opts>
              <NpNote>
                Persistent runners keep their workspace and Docker data between jobs, which keeps
                builds warm but lets one job affect the next. GitHub runners on Linux and macOS;
                changing it restarts each runner while it's idle.
              </NpNote>
            </Line>
          )}
          {servesForgejo && (
            <Line label="Forgejo jobs">
              <Opts label="Forgejo jobs run">
                <Opt
                  on={mode === "host"}
                  onClick={() => setMode("host")}
                  title="On the machine"
                  detail="As the SSH user."
                />
                <Opt
                  on={mode === "docker"}
                  onClick={() => setMode("docker")}
                  title="In Docker containers"
                  detail="Each job in a fresh container."
                />
              </Opts>
              {mode === "docker" && (
                <div className="mt-2.5">
                  <Field
                    id="np-image"
                    label="Default image"
                    value={image}
                    onChange={setImage}
                    placeholder="node:22-bookworm"
                    hint="For jobs whose runs-on doesn't name one."
                    required
                  />
                </div>
              )}
            </Line>
          )}
          <Line label="Name">
            <Field
              id="np-name"
              label="Name"
              hideLabel
              value={effectiveName}
              onChange={(v) => {
                setNameTouched(true);
                setName(v);
              }}
              placeholder="linux-builders"
              invalid={Boolean(nameError)}
              hint={
                <>
                  Part of each runner's name, and a{" "}
                  <span className="font-board">runyard-pool-{effectiveName || "…"}</span> label.
                </>
              }
              required
            />
            {nameError && (
              <div className="mt-1.5">
                <ErrLine>{nameError}</ErrLine>
              </div>
            )}
          </Line>
        </div>
        <div className="rounded-lg bg-tt-paper px-3 py-2.5 text-[12.5px] text-tt-ink-2">
          <b className="font-bold text-tt-ink">
            {onDemand ? "Runner software" : "Runners it registers"}
          </b>
          {onDemand ? (
            preview.templates.length ? (
              preview.templates.map((t) => (
                <div key={t.key}>
                  <b className="font-bold text-tt-ink">
                    {view.machines.find((m) => m.id === t.machineId)?.name}
                  </b>{" "}
                  keeps {t.runnerKind === "forgejo" ? "forgejo-runner" : "GitHub's runner"} at{" "}
                  <span className="font-board text-tt-ink">{t.path}</span>
                </div>
              ))
            ) : (
              <div>No machine here can run on-demand runners.</div>
            )
          ) : (
            <ul>
              {preview.runners.slice(0, PREVIEW_ROWS).map((d) => (
                <li key={d.key} className="break-words">
                  <span className="font-board text-tt-ink">{d.name}</span> → {d.scope.target} on{" "}
                  {view.machines.find((m) => m.id === d.machineId)?.name}
                </li>
              ))}
              {preview.runners.length > PREVIEW_ROWS && (
                <li>and {preview.runners.length - PREVIEW_ROWS} more</li>
              )}
              {preview.runners.length === 0 && <li>None yet.</li>}
            </ul>
          )}
        </div>
        {offPlatform && (
          <NpNote className="!mt-0">
            On-demand runners run on Linux and macOS for now; other machines are skipped.
          </NpNote>
        )}
        {unknownOs.length > 0 && (
          <NpNote className="!mt-0">
            Machines whose OS hasn't been read yet get runners once Runyard reaches them.
          </NpNote>
        )}
        {forgejoOffLinux && (
          <NpNote className="!mt-0">
            forgejo-runner is published for Linux only, so Forgejo runners on other machines won't
            install.
          </NpNote>
        )}
        {(publicScopes.length > 0 || servesGitHubRepo) && (
          <NpNote className="!mt-0">
            {publicScopes.length > 0
              ? "Public repositories wait in each review until you allow them on the pool's page: any runner there runs whatever a pull request brings."
              : "If a GitHub repository here is public, its runners wait in each review until you allow it on the pool's page: any runner there runs whatever a pull request brings."}
          </NpNote>
        )}
        {save.error && <ErrorText error={save.error} />}
        {foot(
          <>
            <TtButton onClick={() => goTo(2)} disabled={save.isPending}>
              Back
            </TtButton>
            <TtButton onClick={cancel} disabled={save.isPending}>
              Cancel
            </TtButton>
          </>,
          <button
            type="submit"
            className={ttButton.primary}
            disabled={save.isPending || Boolean(nameError) || total === 0}
            aria-describedby={nameError ? "np-why" : undefined}
          >
            {save.isPending ? "Saving…" : pool ? "Save and review" : "Create and review"}
          </button>,
          nameError ? `Fix the name to ${pool ? "save" : "create"} the pool.` : null,
        )}
      </>
    );
  } else if (saved) {
    const machines = saved.machineIds
      .map((id) => view.machines.find((m) => m.id === id))
      .filter((m): m is MachineView => m !== undefined);
    const allDone = machines.length > 0 && machines.every((m) => settled.has(m.id));
    const savedPool = view.pools.pools.find((p) => p.id === saved.id);
    body = (
      <>
        <StepHead title={allDone ? `${saved.name} is running` : "Review and run"}>
          {allDone
            ? "Every machine's changes are applied. Its runners show on the Board as they come online."
            : `${pool ? "Saved" : "Created"} ${saved.name}. Nothing changes on a machine until you run its review here or on its page. Busy runners finish their jobs and are left alone.`}
        </StepHead>
        {machines.map((m) => (
          <div key={m.id} className="[&>section]:mt-0">
            <MachineChanges
              m={m}
              admin
              anchor={null}
              autoPrepare
              onSettled={() => setSettled((s) => (s.has(m.id) ? s : new Set(s).add(m.id)))}
              title={
                <span className="flex items-center gap-2.5">
                  {machineSign(view, m)}
                  <Link
                    to="/machines/$id"
                    params={{ id: m.id }}
                    className="text-[14px] font-bold hover:underline"
                  >
                    {m.name}
                  </Link>
                  {settled.has(m.id) && <Chip tone="ok">Done</Chip>}
                </span>
              }
            />
          </div>
        ))}
        {allDone && savedPool && (
          <Panel title="Use it in a workflow">
            <WorkflowSnippet pool={savedPool} />
          </Panel>
        )}
        {foot(
          allDone ? null : <TtButton onClick={() => finish(saved.id)}>Review later</TtButton>,
          <TtButton variant={allDone ? "primary" : "secondary"} onClick={() => finish(saved.id)}>
            Open the pool
          </TtButton>,
        )}
      </>
    );
  }

  return (
    <div>
      {routeLine}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-[18px]">
        {step < 4 ? (
          <form onSubmit={submit} aria-live="polite" className={bodyBox}>
            {body}
          </form>
        ) : (
          // The reviews have forms of their own, so this step isn't one.
          <section aria-live="polite" className={bodyBox}>
            {body}
          </section>
        )}
        <Summary
          name={saved?.name ?? effectiveName}
          labels={labelList}
          serves={scopes.map((s) => s.target).join(", ")}
          runsOn={chosen.map((m) => (onDemand ? m.name : `${m.name} ×${slots[m.id]}`)).join(", ")}
          runners={
            onDemand
              ? `On demand · One per queued job${total ? `, up to ${total} at once` : ""}`
              : preview.runners.length && chosen.length
                ? `Persistent · ${preview.runners.length} runner${preview.runners.length === 1 ? "" : "s"}`
                : ""
          }
          runnersNone={onDemand ? "On demand" : "Persistent"}
          tools={listOf([
            ...profiles.map((p) => TOOL_PROFILES[p].title),
            ...required.map((r) => r.title),
          ])}
          cleanup={onDemand ? null : CLEANUPS.find(([v]) => v === cleanup)![1]}
          forgejo={
            servesForgejo ? (
              mode === "docker" ? (
                <>
                  In Docker · <span className="font-board">{image || "no image"}</span>
                </>
              ) : (
                "On the machine"
              )
            ) : null
          }
          todo={
            saved
              ? [
                  [
                    true,
                    `${pool ? "Saved" : "Created"}. ${saved.machineIds.filter((id) => settled.has(id)).length} of ${saved.machineIds.length} reviews run`,
                  ],
                ]
              : [
                  [scopes.length > 0, "A repository or account to serve"],
                  [total > 0, "A machine to run on"],
                  [!nameError, "A valid name"],
                ]
          }
        />
      </div>
    </div>
  );
}

/** Whether a scope reaches a public repository, as last read from Forgejo, and in what words. */
function publicNote(view: YardView, scope: Scope): string | null {
  const conn = view.forgejo.connections.find((c) => c.forgeId === scope.forgeId);
  if (!conn) return null;
  if (scope.kind === "repo") {
    const t = scope.target.toLowerCase();
    return conn.scopes.some((s) => s.publicRepos?.some((r) => r.toLowerCase() === t))
      ? "Public: its runners aren't registered until you allow it on the pool's page"
      : null;
  }
  const observed = conn.scopes.find(
    (s) => s.kind === scope.kind && s.target.toLowerCase() === scope.target.toLowerCase(),
  );
  const n = observed?.publicRepos?.length ?? 0;
  return n
    ? `Owns ${n === 1 ? "a public repository" : `${n} public repositories`}: its runners aren't registered until you allow it on the pool's page`
    : null;
}

/** A repository or account to serve, with whether an account already covers it or it's public. */
function ScopeRow({
  option: { scope, label, forge, account },
  view,
  scopes,
  onToggle,
}: {
  option: ScopeOption;
  view: YardView;
  scopes: Scope[];
  onToggle: () => void;
}) {
  const covered = account !== undefined && scopes.some((s) => sameScope(s, account));
  const pub = publicNote(view, scope);
  return (
    <label
      className={`flex items-center gap-3 border-t border-tt-rule py-2.5 pr-3.5 first:border-t-0 ${
        account ? "pl-[38px]" : "pl-3.5"
      } ${covered ? "text-tt-ink-2" : "cursor-pointer hover:bg-tt-hover"}`}
    >
      <input
        type="checkbox"
        className="size-4 flex-none accent-tt-ink"
        checked={covered || scopes.some((s) => sameScope(s, scope))}
        disabled={covered}
        onChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="font-board text-[13px] break-words">{label}</span>
        {covered ? (
          <small className="block text-[12.5px] text-tt-ink-2">
            Served through {account.target}
          </small>
        ) : (
          pub && <small className="block text-[12.5px] text-tt-ink-2">{pub}</small>
        )}
      </span>
      {pub && <Chip tone="warn">public</Chip>}
      <span className="rounded-[4px] border border-tt-rule-2 px-1.5 py-1 text-[10.5px] leading-none font-bold tracking-[.06em] text-tt-ink-2 uppercase">
        {forge === "github" ? "GitHub" : "Forgejo"}
      </span>
    </label>
  );
}

/** A machine to pick, with what its review would do there, or why it can't be picked yet. */
function MachineChoice({
  m,
  view,
  on,
  onToggle,
  tools,
}: {
  m: MachineView;
  view: YardView;
  on: boolean;
  onToggle: (on: boolean) => void;
  tools: ToolId[];
}) {
  const ok = reachable(m) && m.os !== null;
  const install = m.os && m.readiness ? toolInstallPlan(m.os, m.readiness, tools) : null;
  // Only what every runner needs; label checks belong to the machine's other pools.
  const problems = readinessProblems(m.readiness).filter(
    (p) => p.tier === "required" && !p.id.startsWith("tool-"),
  );
  const system = osLine(m) ?? "OS not read yet";
  return (
    <label
      className={`flex items-center gap-3 border-t border-tt-rule px-3.5 py-2.5 first:border-t-0 ${
        ok ? "cursor-pointer hover:bg-tt-hover" : "text-tt-ink-2"
      }`}
    >
      <input
        type="checkbox"
        className="size-4 flex-none accent-tt-ink"
        checked={on}
        disabled={!ok && !on}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={ok ? undefined : `${m.name}, not reachable`}
      />
      {machineSign(view, m)}
      <span className="min-w-0 flex-1">
        <b className="block font-bold">{m.name}</b>
        <small className="block text-[12.5px] text-tt-ink-2">
          {system} ·{" "}
          {!ok ? (
            <>
              Runyard can't reach it yet.{" "}
              <Link
                to="/machines/$id"
                params={{ id: m.id }}
                className="font-bold text-tt-ink underline"
              >
                Finish its setup
              </Link>
            </>
          ) : !m.readiness ? (
            "Not checked yet; its review checks it first."
          ) : install && (install.install.length || install.blocked.length) ? (
            <>
              {install.install.length > 0 &&
                `Runyard will install ${toolList(install.install, m.os)}.`}
              {install.blocked.map((b) => (
                <span key={b.reason} className="block text-tt-warn-ink">
                  Needs {toolList(b.tools, m.os)} by hand: {b.reason}
                </span>
              ))}
            </>
          ) : (
            "Has everything it needs."
          )}
          {ok &&
            problems.map((p) => (
              <span key={p.id} className="block text-tt-warn-ink">
                {p.title}: {p.value}
              </span>
            ))}
        </small>
      </span>
      <span className="max-sm:hidden">{machineChip(m)}</span>
    </label>
  );
}

/** The dark summary beside the form: the pool as it's built, and what it still needs. */
function Summary({
  name,
  labels,
  serves,
  runsOn,
  runners,
  runnersNone,
  tools,
  cleanup,
  forgejo,
  todo,
}: {
  name: string;
  labels: string[];
  serves: string;
  runsOn: string;
  runners: string;
  runnersNone: string;
  tools: string;
  cleanup: string | null;
  forgejo: ReactNode;
  todo: [boolean, string][];
}) {
  const shown = name || "pool";
  const row = (k: string, v: ReactNode, none: string) => (
    <>
      <dt className="text-[#9aa0a9]">{k}</dt>
      <dd className={`m-0 break-words ${v ? "text-tt-flap" : "text-[#9aa0a9]"}`}>{v || none}</dd>
    </>
  );
  return (
    <aside
      aria-label="This pool so far"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-tt-board-edge bg-tt-board px-[18px] pt-[18px] pb-4 text-tt-flap lg:sticky lg:top-4"
    >
      <div>
        <div className="text-[10.5px] leading-none font-bold tracking-[.12em] text-tt-signal uppercase">
          This pool
        </div>
        <div
          className={`mt-1.5 font-board text-[24px] leading-[1.1] font-bold break-all ${name ? "" : "text-[#9aa0a9]"}`}
        >
          {shown}
        </div>
      </div>
      <div className="rounded-md bg-tt-cell px-3 py-2.5 font-board text-[12.5px] leading-normal break-words">
        runs-on: [
        {labels.length ? (
          labels.map((l, i) => (
            <span key={`${l}-${i}`}>
              {i > 0 && ", "}
              <em className="text-tt-loco not-italic">{l}</em>
            </span>
          ))
        ) : (
          <em className="text-tt-loco not-italic">runyard-pool-{shown}</em>
        )}
        ]
        <small className="mt-1 block font-ui text-[11.5px] text-[#9aa0a9]">
          {labels.length
            ? `Or runyard-pool-${shown}, for jobs that must land here. GitHub adds self-hosted, the OS and architecture.`
            : "Add labels your workflows already ask for, or use this one."}
        </small>
      </div>
      <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-2.5 gap-y-[7px] text-[12.5px]">
        {row("Serves", serves, "Nothing yet")}
        {row("Runs on", runsOn, "No machine yet")}
        {row("Runners", runners, runnersNone)}
        {row("Tools", tools, "None")}
        {cleanup && row("After each job", cleanup, "")}
        {forgejo && row("Forgejo jobs", forgejo, "")}
      </dl>
      <div className="grid gap-[5px] border-t border-dashed border-[#343841] pt-2.5 text-[12.5px]">
        {todo.map(([ok, what]) => (
          <span key={what} className="flex items-center gap-2 text-[#c7cbd2]">
            <span className={ok ? "text-[#6fe39b]" : "text-tt-signal"}>
              <Icon name={ok ? "check" : "alert"} size={14} />
            </span>
            {what}
          </span>
        ))}
      </div>
    </aside>
  );
}

function StepHead({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-[24px] leading-[1.1] font-extrabold [font-stretch:80%]">{title}</h2>
      <p className="mt-1 max-w-[62ch] text-tt-ink-2">{children}</p>
    </div>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-[13px] font-extrabold tracking-[.06em] uppercase">{children}</h3>;
}

/** A labeled text field in the design's style: mono input, a hint under it. */
function Field({
  id,
  label,
  hideLabel,
  value,
  onChange,
  placeholder,
  hint,
  invalid,
  required,
}: {
  id: string;
  label: string;
  hideLabel?: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  invalid?: boolean;
  required?: boolean;
}) {
  return (
    <div className="grid max-w-[520px] gap-1.5">
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-[12px] font-bold text-tt-ink-2"}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="w-full rounded-lg border-[1.5px] border-tt-rule-2 bg-tt-card px-3 py-2.5 font-board text-[14px] font-medium text-tt-ink outline-none placeholder:text-tt-ink-3 focus:border-tt-ink aria-invalid:border-tt-bad"
      />
      {hint && (
        <small id={`${id}-hint`} className="text-[12.5px] text-tt-ink-3">
          {hint}
        </small>
      )}
    </div>
  );
}

/** A line of the check: its label, what's set or its controls, and Change for earlier steps. */
function Line({
  label,
  onChange,
  what,
  children,
}: {
  label: string;
  onChange?: () => void;
  /** What Change changes, for screen readers. */
  what?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 border-b border-tt-rule py-3.5 lg:grid-cols-[130px_minmax(0,1fr)_auto]">
      <span className="pt-0.5 text-[13px] font-bold">{label}</span>
      <div className="col-span-full row-start-2 min-w-0 break-words lg:col-span-1 lg:col-start-2 lg:row-start-1">
        {children}
      </div>
      {onChange ? (
        <button
          type="button"
          onClick={onChange}
          className="py-0.5 text-[12.5px] font-bold text-tt-ink-2 underline hover:text-tt-ink lg:col-start-3"
          aria-label={what ? `Change ${what}` : undefined}
        >
          Change
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

function Opts({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2"
    >
      {children}
    </div>
  );
}

/** One of a few choices, as the design's option card. */
function Opt({
  on,
  onClick,
  title,
  detail,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="flex w-full flex-col items-start rounded-[10px] border-[1.5px] border-tt-rule-2 bg-tt-card px-3 py-2.5 text-left hover:border-tt-ink-3 aria-pressed:border-tt-ink aria-pressed:shadow-[inset_0_0_0_1px_var(--color-tt-ink)]"
    >
      <b className="block text-[13.5px] font-bold">{title}</b>
      <small className="block text-[12px] text-tt-ink-2">{detail}</small>
    </button>
  );
}
