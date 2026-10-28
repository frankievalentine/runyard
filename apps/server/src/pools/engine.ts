import {
  actionable,
  desiredRunners,
  planFingerprint,
  planMachine,
  scopeKey,
  type DesiredRunner,
  type MachineConfig,
  type MachineView,
  type OsFamily,
  type PlanInput,
  type PlanItem,
  type RemoteRunner,
  type Scope,
  type ScopePolicy,
} from "@runyard/core";
import type { CommandRunner } from "../command.ts";
import type { Db } from "../db/index.ts";
import type { GithubHttp } from "../github/client.ts";
import { orgRunners, repoRunners } from "../github/api.ts";
import type { GithubMonitor } from "../github/monitor.ts";
import { scriptCommand, type SshPrograms } from "../machines/ssh.ts";
import { getMachine } from "../machines/store.ts";
import {
  defaultGroupAllowsPublic,
  latestRunnerAsset,
  registrationToken,
  registrationUrl,
  removalToken,
  repoIsPrivate,
  runnerPlatform,
  setLabels,
} from "./github.ts";
import { operationScript, parseProbe, probeScript, type Operation } from "./scripts.ts";
import {
  forgetRegistration,
  listPools,
  listRegistrations,
  publicOverrides,
  recordRegistration,
} from "./store.ts";

export const REVIEW_MS = 15 * 60_000;
const PROBE_TIMEOUT_MS = 60_000;
/** Installing downloads the runner and may install system dependencies. */
const OPERATION_TIMEOUT_MS = 20 * 60_000;

export class EngineError extends Error {}

export type Review = {
  id: string;
  machineId: string;
  items: PlanItem[];
  fingerprint: string;
  createdAt: number;
  expiresAt: number;
  /** Linux needs root for dependencies and systemd; the form asks for the sudo password. */
  mayNeedSudo: boolean;
};

export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";
export type OperationView = {
  id: string;
  machineId: string;
  status: "running" | "succeeded" | "failed";
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  steps: {
    action: PlanItem["action"];
    runnerName: string;
    scope: string;
    status: StepStatus;
    output: string;
  }[];
};

type Deps = {
  db: Db;
  run: CommandRunner;
  programs: SshPrograms;
  github: GithubMonitor;
  /** The machine as the dashboard sees it: OS, architecture. */
  machineView: (id: string) => MachineView | undefined;
  now?: () => number;
  onChange?: () => void;
};

type Context = {
  machine: MachineConfig;
  os: OsFamily;
  windows: boolean;
  architecture: string | null;
  desired: DesiredRunner[];
  input: PlanInput;
  remote: Map<string, Map<string, RemoteRunner>>;
};

/**
 * fleet's desired-state engine for pools: review re-reads the machine and
 * GitHub, execute reads them again and refuses unless the plan is unchanged.
 * Reviews are single-use and expire; one operation runs per machine, one
 * runner at a time, stopping at the first failure.
 */
export class PoolEngine {
  private reviews = new Map<string, Review>();
  private operations = new Map<string, OperationView>();
  private running = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? Date.now;
  }

  operation(id: string): OperationView | undefined {
    return this.operations.get(id);
  }

  /** The latest operation for each machine, newest first. */
  recentOperations(): OperationView[] {
    return [...this.operations.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 50);
  }

  async review(machineId: string): Promise<Review> {
    const ctx = await this.read(machineId);
    const items = planMachine(ctx.input);
    const now = this.now();
    for (const [id, r] of this.reviews) if (r.expiresAt <= now) this.reviews.delete(id);
    const review: Review = {
      id: crypto.randomUUID(),
      machineId,
      items,
      fingerprint: planFingerprint(items),
      createdAt: now,
      expiresAt: now + REVIEW_MS,
      mayNeedSudo:
        ctx.os === "linux" && actionable(items).some((i) => i.action !== "reconcileLabels"),
    };
    this.reviews.set(review.id, review);
    return review;
  }

  /**
   * Re-reads everything and starts the reviewed changes if the plan is
   * unchanged. Returns the operation, which continues in the background.
   */
  async execute(reviewId: string, options: { sudoPassword?: string } = {}): Promise<OperationView> {
    const review = this.reviews.get(reviewId);
    this.reviews.delete(reviewId);
    if (!review || review.expiresAt <= this.now())
      throw new EngineError("That review expired or was already used. Review again.");
    if (this.running.has(review.machineId))
      throw new EngineError("A change is already running on this machine.");
    if (actionable(review.items).length === 0)
      throw new EngineError("The review has nothing Runyard can do.");
    this.running.add(review.machineId);
    let ctx: Context;
    try {
      ctx = await this.read(review.machineId);
      const items = planMachine(ctx.input);
      if (planFingerprint(items) !== review.fingerprint) {
        throw new EngineError(
          "The machine or GitHub changed since the review, so nothing was done. Review again.",
        );
      }
    } catch (error) {
      this.running.delete(review.machineId);
      throw error;
    }
    const steps = actionable(review.items);
    const op: OperationView = {
      id: crypto.randomUUID(),
      machineId: review.machineId,
      status: "running",
      startedAt: this.now(),
      finishedAt: null,
      error: null,
      steps: steps.map((s) => ({
        action: s.action,
        runnerName: s.runnerName,
        scope: s.scope.target,
        status: "pending",
        output: "",
      })),
    };
    this.operations.set(op.id, op);
    void this.carryOut(op, steps, ctx, options.sudoPassword).finally(() => {
      this.running.delete(review.machineId);
      this.deps.onChange?.();
    });
    return op;
  }

  private async carryOut(
    op: OperationView,
    steps: PlanItem[],
    ctx: Context,
    sudoPassword?: string,
  ) {
    for (const [i, item] of steps.entries()) {
      const step = op.steps[i]!;
      step.status = "running";
      this.deps.onChange?.();
      try {
        step.output = await this.apply(item, ctx, sudoPassword);
        step.status = "succeeded";
      } catch (error) {
        step.status = "failed";
        step.output = error instanceof Error ? error.message : String(error);
        op.status = "failed";
        op.error = `${item.runnerName}: ${step.output.split("\n").at(-1) ?? "failed"}`;
        for (const rest of op.steps.slice(i + 1)) rest.status = "skipped";
        break;
      }
    }
    if (op.status === "running") op.status = "succeeded";
    op.finishedAt = this.now();
    void this.deps.github.pollRunners();
  }

  private async apply(item: PlanItem, ctx: Context, sudoPassword?: string): Promise<string> {
    const http = this.client(item.scope);
    switch (item.action) {
      case "install": {
        const platform = runnerPlatform(ctx.os as "macos" | "linux" | "windows", ctx.architecture);
        if (!platform)
          throw new EngineError(
            "The machine's architecture isn't known yet; check it again first.",
          );
        const asset = await latestRunnerAsset(http, platform);
        const token = await registrationToken(http, item.scope);
        const output = await this.runScript(ctx, "install", {
          RF_ROOT: item.path,
          RF_NAME: item.runnerName,
          RF_URL: registrationUrl(this.deps.github.webBaseFor(item.scope.forgeId), item.scope),
          RF_LABELS: (item.labels ?? []).join(","),
          RF_TOKEN: token,
          RF_ASSET_URL: asset.url,
          RF_ASSET_NAME: asset.name,
          RF_CHECKSUM: asset.sha256 ?? undefined,
          RF_SERVICE_MODE: item.serviceMode,
          RF_SUDO_PASSWORD: sudoPassword,
        });
        const desired = ctx.desired.find((d) => d.path === item.path && d.name === item.runnerName);
        if (desired) {
          recordRegistration(this.deps.db, {
            key: desired.key,
            machineId: desired.machineId,
            runnerName: desired.name,
            scope: desired.scope,
            path: desired.path,
            serviceMode: desired.serviceMode,
          });
        }
        return output;
      }
      case "start":
        return this.runScript(ctx, "start", {
          RF_ROOT: item.path,
          RF_NAME: item.runnerName,
          RF_SERVICE_MODE: item.serviceMode,
          RF_SUDO_PASSWORD: sudoPassword,
        });
      case "reconcileLabels": {
        const remote = ctx.remote.get(scopeKey(item.scope))?.get(item.runnerName.toLowerCase());
        if (!remote) throw new EngineError("GitHub no longer lists this runner.");
        await setLabels(http, item.scope, remote.id, item.labels ?? []);
        return `Labels set to ${(item.labels ?? []).join(", ")}.`;
      }
      case "remove": {
        // Busy is checked again at the last moment: a job may have started since.
        const fresh = await this.remoteRunners(http, item.scope);
        if (fresh.get(item.runnerName.toLowerCase())?.busy)
          throw new EngineError("It started a job; not removed.");
        const token = await removalToken(http, item.scope);
        const output = await this.runScript(ctx, "remove", {
          RF_ROOT: item.path,
          RF_NAME: item.runnerName,
          RF_TOKEN: token,
          RF_SERVICE_MODE: item.serviceMode,
          RF_SUDO_PASSWORD: sudoPassword,
        });
        forgetRegistration(this.deps.db, item.machineId, item.scope, item.runnerName);
        return output;
      }
      default:
        throw new EngineError(`${item.action} needs a person.`);
    }
  }

  /** Runs one operation script over SSH, with secrets redacted from what it returns. */
  private async runScript(
    ctx: Context,
    op: Operation,
    values: Record<string, string | undefined>,
  ): Promise<string> {
    const script = operationScript(op, ctx.windows, values);
    const { argv, stdin } = scriptCommand(this.deps.programs, ctx.machine, ctx.windows, script);
    const res = await this.deps.run(argv, { stdin, timeoutMs: OPERATION_TIMEOUT_MS });
    const output = redact(`${res.stdout}${res.stderr}`.trim(), [
      values.RF_TOKEN,
      values.RF_SUDO_PASSWORD,
    ]);
    if (res.code !== 0)
      throw new EngineError(output || `The ${op} script failed (exit ${res.code}).`);
    return output;
  }

  /** Everything a plan needs, read fresh: the machine's runner directories, GitHub's runners and scope policies. */
  private async read(machineId: string): Promise<Context> {
    const machine = getMachine(this.deps.db, machineId);
    const view = this.deps.machineView(machineId);
    if (!machine || !view) throw new EngineError("No such machine.");
    if (!view.os || view.os === "other")
      throw new EngineError(
        "Runyard needs a successful check of this machine first, to know its operating system.",
      );
    const windows = view.os === "windows";
    const architecture =
      view.diagnostics?.checks.find((c) => c.id === "architecture")?.value ?? null;
    const desired = desiredRunners(
      listPools(this.deps.db),
      new Map([[machineId, { name: machine.name, os: view.os }]]),
    ).filter((d) => d.machineId === machineId);
    const registrations = listRegistrations(this.deps.db).filter((r) => r.machineId === machineId);

    const targets = [
      ...desired.map((d) => ({ path: d.path, serviceMode: d.serviceMode })),
      ...registrations
        .filter((r) => !desired.some((d) => d.path === r.path))
        .map((r) => ({ path: r.path, serviceMode: r.serviceMode })),
    ];
    let local = new Map();
    let machineError: string | null = null;
    if (targets.length) {
      try {
        const { argv, stdin } = scriptCommand(
          this.deps.programs,
          machine,
          windows,
          probeScript(windows, targets),
        );
        const res = await this.deps.run(argv, { stdin, timeoutMs: PROBE_TIMEOUT_MS });
        if (res.code !== 0)
          throw new EngineError(
            res.stderr.trim().split("\n").at(-1) || `ssh failed (exit ${res.code})`,
          );
        local = parseProbe(res.stdout, windows, targets);
      } catch (error) {
        machineError = error instanceof Error ? error.message : String(error);
      }
    }

    const scopes = new Map<string, Scope>();
    for (const s of [...desired.map((d) => d.scope), ...registrations.map((r) => r.scope)])
      scopes.set(scopeKey(s), s);
    const remote = new Map<string, Map<string, RemoteRunner>>();
    const githubErrors = new Map<string, string>();
    const policies = new Map<string, ScopePolicy>();
    const overrides = publicOverrides(this.deps.db);
    for (const [key, scope] of scopes) {
      try {
        const http = this.client(scope);
        remote.set(key, await this.remoteRunners(http, scope));
        policies.set(key, await this.policy(http, scope, overrides));
      } catch (error) {
        githubErrors.set(key, error instanceof Error ? error.message : String(error));
      }
    }
    return {
      machine,
      os: view.os,
      windows,
      architecture,
      desired,
      remote,
      input: {
        machineId,
        desired,
        registrations,
        local,
        github: remote,
        policies,
        machineError,
        githubErrors,
      },
    };
  }

  private client(scope: Scope): GithubHttp {
    const http = this.deps.github.clientFor(scope);
    if (!http)
      throw new EngineError(
        `Runyard's GitHub App isn't installed on ${scope.kind === "repo" ? scope.target.split("/")[0] : scope.target}.`,
      );
    return http;
  }

  private async remoteRunners(http: GithubHttp, scope: Scope): Promise<Map<string, RemoteRunner>> {
    const list =
      scope.kind === "org"
        ? await orgRunners(http, scope.target)
        : await repoRunners(http, scope.target);
    return new Map(
      list.map((r) => [
        r.name.toLowerCase(),
        { id: r.id, name: r.name, status: r.status, busy: r.busy, labels: r.labels },
      ]),
    );
  }

  private async policy(
    http: GithubHttp,
    scope: Scope,
    overrides: Set<string>,
  ): Promise<ScopePolicy> {
    if (scope.kind === "repo") {
      if (await repoIsPrivate(http, scope.target)) return { ok: true };
      if (overrides.has(`${scope.forgeId}:${scope.target.toLowerCase()}`)) return { ok: true };
      return {
        ok: false,
        reason: `${scope.target} is public: anyone who can open a pull request could run code on this machine. Allow it in the pool's settings once you've locked it down.`,
      };
    }
    if (await defaultGroupAllowsPublic(http, scope.target)) {
      return {
        ok: false,
        reason: `${scope.target}'s Default runner group allows public repositories. In GitHub: ${scope.target} ▸ Settings ▸ Actions ▸ Runner groups ▸ Default, turn off "Allow public repositories".`,
      };
    }
    return { ok: true };
  }
}

/** Never show a token or password, even if a script echoes it. */
export function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets)
    if (secret && secret.length >= 4) out = out.split(secret).join("•••");
  return out;
}
