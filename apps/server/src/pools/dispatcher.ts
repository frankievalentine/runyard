import {
  advanceDispatches,
  planDispatches,
  type Dispatch,
  type DispatchPlan,
  type FleetView,
  type ForgeKind,
  type MachineConfig,
} from "@runyard/core";
import type { CommandRunner } from "../command.ts";
import type { Db } from "../db/index.ts";
import type { ForgejoMonitor } from "../forgejo/monitor.ts";
import type { GithubMonitor } from "../github/monitor.ts";
import { scriptCommand, type SshPrograms } from "../machines/ssh.ts";
import { appendEvents, getMachine } from "../machines/store.ts";
import type { PoolEngine } from "./engine.ts";
import { deleteRunner, jitConfig } from "./github.ts";
import { forgejoLabels } from "./engine.ts";
import { operationScript, parseSweep } from "./scripts.ts";
import {
  deleteDispatch,
  listDispatches,
  listPools,
  listTemplates,
  pruneDispatches,
  saveDispatch,
} from "./store.ts";

const TICK_MS = 15_000;
const SSH_TIMEOUT_MS = 90_000;

type Deps = {
  db: Db;
  run: CommandRunner;
  programs: SshPrograms;
  engine: PoolEngine;
  github: GithubMonitor;
  forgejo?: ForgejoMonitor;
  /** The current fleet view: queue, runners and machines. */
  view: () => FleetView;
  now?: () => number;
  onChange?: () => void;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Starts one-job runners for on-demand pools. Each round sweeps machines with
 * runners out, advances dispatches from the forges' runner lists, then starts
 * runners for queued jobs the pools can serve. Every start mints a single-use
 * registration at that moment and holds the machine like a reviewed change.
 */
export class Dispatcher {
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking: Promise<void> | undefined;
  private readonly now: () => number;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? Date.now;
  }

  start() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** One round; overlapping calls share it. */
  tick(): Promise<void> {
    this.ticking ??= this.round().finally(() => {
      this.ticking = undefined;
    });
    return this.ticking;
  }

  private async round() {
    const { db } = this.deps;
    const before = listDispatches(db);
    const active = before.filter((d) => d.state === "starting" || d.state === "running");
    // Sweeps tell which runner processes have exited, seen by the forge or not.
    const exited = new Set<string>();
    for (const machineId of new Set(active.map((d) => d.machineId))) {
      const machine = getMachine(db, machineId);
      if (!machine) continue;
      const out = await this.deps.engine.withMachine(machineId, () =>
        this.ssh(machine, operationScript("jit-sweep", false, {})),
      );
      if (out === null) continue;
      try {
        for (const name of parseSweep(out).exited) exited.add(name);
      } catch {
        // An incomplete sweep says nothing; the next round tries again.
      }
    }
    const view = this.deps.view();
    for (const d of advanceDispatches(active, view.runners, exited, this.now())) {
      const was = active.find((a) => a.id === d.id)!;
      if (d.state === was.state) continue;
      if (d.state === "failed") await this.abandon(d);
      saveDispatch(db, d);
      if (d.state === "done" || d.state === "failed") {
        this.event(
          d.machineId,
          d.state === "done" ? "runnerFinished" : "runnerFailed",
          `${d.runnerName}${d.detail ? `: ${d.detail}` : "."}`,
        );
      }
    }

    const pools = listPools(db);
    const plans = planDispatches({
      queue: view.queue.jobs,
      runners: view.runners,
      pools,
      templates: view.pools.templates,
      installed: listTemplates(db),
      machines: view.machines,
      dispatches: listDispatches(db),
      busyMachines: new Set(
        view.machines.filter((m) => this.deps.engine.isBusy(m.id)).map((m) => m.id),
      ),
      forgeKinds: this.forgeKinds(),
      now: this.now(),
    });
    for (const plan of plans) await this.startOne(plan);
    pruneDispatches(db);
    if (plans.length || before.length !== listDispatches(db).length) this.deps.onChange?.();
  }

  private async startOne(plan: DispatchPlan) {
    const { db } = this.deps;
    const machine = getMachine(db, plan.machineId);
    if (!machine) return;
    const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
    const name = `${machine.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 24)}-${plan.pool.name}-${suffix}`.replace(/-+/g, "-");
    const jobDir = `${plan.template.path.slice(0, plan.template.path.lastIndexOf("/"))}/jobs/${name}`;
    const dispatch: Dispatch = {
      id: `d_${suffix}${crypto.randomUUID().slice(0, 4)}`,
      poolId: plan.pool.id,
      machineId: plan.machineId,
      runnerName: name,
      runnerKind: plan.template.runnerKind,
      scope: plan.scope,
      jobId: plan.job.id,
      runnerId: null,
      state: "starting",
      startedAt: this.now(),
      endedAt: null,
      detail: null,
    };
    // Recorded first: a job is dispatched at most once, even if starting fails.
    saveDispatch(db, dispatch);
    const result = await this.deps.engine.withMachine(
      plan.machineId,
      async (): Promise<{ error: string | null }> => {
        try {
          const values = await this.register(plan, name, dispatch);
          await this.ssh(
            machine,
            operationScript("jit-start", false, {
              RF_TEMPLATE: plan.template.path,
              RF_JOB_DIR: jobDir,
              RF_NAME: name,
              RF_KIND: plan.template.runnerKind,
              ...values,
            }),
            [values.RF_JIT_CONFIG, values.RF_TOKEN],
          );
          return { error: null };
        } catch (error) {
          return { error: message(error) };
        }
      },
    );
    if (result === null) {
      // The machine became busy before the start: nothing was attempted, so the job may go again.
      deleteDispatch(db, dispatch.id);
      return;
    }
    if (result.error === null) {
      this.event(
        plan.machineId,
        "runnerStarted",
        `${name} for ${plan.job.repo}: ${plan.job.name}.`,
      );
      return;
    }
    const failed: Dispatch = {
      ...dispatch,
      state: "failed",
      endedAt: this.now(),
      detail: result.error,
    };
    await this.abandon(failed);
    saveDispatch(db, failed);
    this.event(plan.machineId, "runnerFailed", `${name}: ${result.error}`);
  }

  /** Mints the single-use registration and returns what the start script needs. */
  private async register(
    plan: DispatchPlan,
    name: string,
    dispatch: Dispatch,
  ): Promise<Record<string, string>> {
    if (plan.template.runnerKind === "forgejo") {
      const api = this.deps.forgejo?.apiFor(plan.scope);
      if (!api) throw new Error("The Forgejo connection isn't usable.");
      const reg = await api.register(plan.scope, name, true);
      dispatch.runnerId = reg.id;
      saveDispatch(this.deps.db, dispatch);
      return {
        RF_URL: api.baseUrl,
        RF_RUNNER_ID: String(reg.id),
        RF_UUID: reg.uuid,
        RF_TOKEN: reg.token,
        RF_LABELS: forgejoLabels(
          plan.template.labels,
          plan.template.forgejoMode ?? { kind: "host" },
        ),
      };
    }
    const http = this.deps.github.clientFor(plan.scope);
    if (!http) throw new Error("Runyard's GitHub App can't reach this scope.");
    const labels = [
      ...new Set([
        "self-hosted",
        ...plan.job.labels.filter((l) => !plan.template.labels.includes(l)),
        ...plan.template.labels,
      ]),
    ];
    const jit = await jitConfig(http, plan.scope, name, labels);
    dispatch.runnerId = jit.runnerId;
    saveDispatch(this.deps.db, dispatch);
    return { RF_JIT_CONFIG: jit.config };
  }

  /** Deletes a failed dispatch's registration on the forge, if it was made. */
  private async abandon(d: Dispatch) {
    if (d.runnerId === null) return;
    try {
      if (d.runnerKind === "forgejo")
        await this.deps.forgejo?.apiFor(d.scope)?.deleteRunner(d.scope, d.runnerId);
      else {
        const http = this.deps.github.clientFor(d.scope);
        if (http) await deleteRunner(http, d.scope, d.runnerId);
      }
    } catch {
      // Already gone, or unreachable; the forge drops unused single-use runners itself.
    }
  }

  private async ssh(
    machine: MachineConfig,
    script: string,
    secrets: (string | undefined)[] = [],
  ): Promise<string> {
    const { argv, stdin } = scriptCommand(this.deps.programs, machine, false, script);
    const res = await this.deps.run(argv, { stdin, timeoutMs: SSH_TIMEOUT_MS });
    let output = `${res.stdout}${res.stderr}`.trim();
    for (const s of secrets) if (s) output = output.split(s).join("[redacted]");
    if (res.code !== 0)
      throw new Error(output.split("\n").at(-1) || `ssh failed (exit ${res.code})`);
    return res.stdout;
  }

  private event(
    machineId: string,
    kind: "runnerStarted" | "runnerFinished" | "runnerFailed",
    detail: string,
  ) {
    const machine = getMachine(this.deps.db, machineId);
    appendEvents(this.deps.db, [
      { machineId, machineName: machine?.name ?? machineId, kind, detail, at: this.now() },
    ]);
  }

  private forgeKinds(): Map<string, ForgeKind> {
    return new Map<string, ForgeKind>([
      ...this.deps.github.observations().map((a): [string, ForgeKind] => [a.forgeId, "github"]),
      ...(this.deps.forgejo?.observations() ?? []).map((c): [string, ForgeKind] => [
        c.forgeId,
        "forgejo",
      ]),
    ]);
  }
}
