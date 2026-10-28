import {
  MAINTENANCE_MS,
  deriveFleet,
  findPeer,
  newMachineState,
  observe,
  observed,
  osFromTailnet,
  parseReport,
  type EventKind,
  type FleetView,
  type MachineConfig,
  type MachineObservation,
  type MachineState,
  type OsFamily,
  type TailnetObservation,
} from "@runyard/core";
import type { CommandRunner } from "../command.ts";
import type { Db } from "../db/index.ts";
import type { TailscaleCli } from "../tailscale.ts";
import { inspect, type SshPrograms } from "./ssh.ts";
import {
  appendEvents,
  ignoredNodeIds,
  listMachines,
  loadStates,
  pruneEvents,
  saveState,
  type MachineEvent,
} from "./store.ts";

export const TAILNET_INTERVAL_MS = 15_000;
/** The pause between SSH rounds, counted from when a round finishes. */
export const SSH_INTERVAL_MS = 60_000;
export const SSH_CONCURRENCY = 4;
export const TICK_MS = 5_000;

type Deps = {
  db: Db;
  run: CommandRunner;
  programs: SshPrograms;
  tailscale: TailscaleCli;
  now?: () => number;
  log?: (message: string) => void;
};

/**
 * Collects observations (tailnet every 15 seconds, SSH rounds a minute apart
 * with at most four sessions), evaluates monitoring transitions every five
 * seconds into the event journal, and publishes the derived fleet view.
 */
export class MachineMonitor {
  private readonly now: () => number;
  private observations = new Map<string, MachineObservation>();
  private tailnet: TailnetObservation = { at: null, snapshot: null, error: null };
  private states: Map<string, { target: string; state: MachineState }>;
  private checking = new Map<string, Promise<void>>();
  private listeners = new Set<(view: FleetView) => void>();
  private current: FleetView;
  private published = "";
  private timers: ReturnType<typeof setInterval>[] = [];
  private wake: (() => void) | undefined;
  private stopped = false;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? Date.now;
    this.states = loadStates(deps.db);
    this.current = this.derive();
  }

  /** The latest fleet view. */
  get view(): FleetView {
    return this.current;
  }

  /** Called with every changed view; returns an unsubscribe function. */
  subscribe(listener: (view: FleetView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start() {
    void this.pollTailnet().then(() => this.tick());
    void this.sshLoop();
    this.timers.push(
      setInterval(() => void this.pollTailnet(), TAILNET_INTERVAL_MS),
      setInterval(() => this.tick(), TICK_MS),
      setInterval(() => pruneEvents(this.deps.db, this.now()), 60 * 60_000),
    );
    for (const timer of this.timers) timer.unref();
  }

  stop() {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.wake?.();
  }

  async pollTailnet() {
    const status = await this.deps.tailscale.status();
    if (status instanceof Error) this.tailnet = { ...this.tailnet, error: status.message };
    else this.tailnet = { at: this.now(), snapshot: status, error: null };
  }

  /**
   * Inspects the given machines (all by default) over SSH. Machines already
   * being checked share that check; offline tailnet peers are skipped.
   */
  async checkMachines(ids?: readonly string[]) {
    const peers = this.tailnet.snapshot?.peers ?? [];
    const queue = listMachines(this.deps.db).filter((m) => {
      if (ids && !ids.includes(m.id)) return false;
      return findPeer(m, peers)?.online !== false;
    });
    const worker = async () => {
      for (let machine = queue.shift(); machine; machine = queue.shift())
        await this.checkOne(machine);
    };
    await Promise.all(Array.from({ length: Math.min(SSH_CONCURRENCY, queue.length) }, worker));
    this.tick();
  }

  /** Reads the tailnet and checks one machine, or every machine, right away. */
  async checkNow(machineId?: string) {
    await this.pollTailnet();
    await this.checkMachines(machineId ? [machineId] : undefined);
  }

  /** Starts or ends a one-hour pause of a machine's alerts. */
  setMaintenance(machineId: string, on: boolean) {
    const until = on ? this.now() + MAINTENANCE_MS : null;
    const machine = listMachines(this.deps.db).find((m) => m.id === machineId);
    if (!machine) return;
    const entry = this.stateFor(machine, []);
    entry.state.maintenanceUntil = until;
    appendEvents(this.deps.db, [
      this.event(
        machine,
        until ? "maintenanceStarted" : "maintenanceEnded",
        until
          ? "Alerts are paused for one hour."
          : "The maintenance pause was ended early. Alerts are active again.",
      ),
    ]);
    saveState(this.deps.db, machine.id, entry.target, entry.state);
    this.tick();
  }

  /** Re-reads configuration after machines are added, changed or removed. */
  configChanged(removedId?: string) {
    if (removedId) {
      this.observations.delete(removedId);
      this.states.delete(removedId);
    }
    this.tick();
  }

  /** Evaluates transitions, records events and publishes the view if it changed. */
  tick() {
    const now = this.now();
    const view = this.derive(now);
    const networkAt = this.tailnet.error === null ? this.tailnet.at : null;
    const events: Omit<MachineEvent, "id">[] = [];
    const configs = new Map(listMachines(this.deps.db).map((m) => [m.id, m]));
    for (const machine of view.machines) {
      const config = configs.get(machine.id);
      if (!config) continue;
      const entry = this.stateFor(config, events);
      const before = JSON.stringify(entry.state);
      for (const c of observe(entry.state, observed(machine), networkAt, now)) {
        events.push(this.event(config, c.kind, c.detail, now));
      }
      if (JSON.stringify(entry.state) !== before)
        saveState(this.deps.db, config.id, entry.target, entry.state);
    }
    appendEvents(this.deps.db, events);
    this.current = this.derive(now);
    this.publish();
  }

  private derive(now = this.now()): FleetView {
    return deriveFleet({
      machines: listMachines(this.deps.db),
      observations: this.observations,
      tailnet: this.tailnet,
      ignoredNodeIds: ignoredNodeIds(this.deps.db),
      states: new Map([...this.states].map(([id, s]) => [id, s.state])),
      now,
    });
  }

  private publish() {
    // generatedAt alone isn't a change; clients age timestamps themselves.
    const json = JSON.stringify({ ...this.current, generatedAt: 0 });
    if (json === this.published) return;
    this.published = json;
    for (const listener of this.listeners) listener(this.current);
  }

  /** The machine's baselines, started fresh (with an event) on first sight or a new SSH target. */
  private stateFor(machine: MachineConfig, events: Omit<MachineEvent, "id">[]) {
    const existing = this.states.get(machine.id);
    if (existing && existing.target === machine.sshTarget) return existing;
    const entry = { target: machine.sshTarget, state: newMachineState(machine.name) };
    this.states.set(machine.id, entry);
    events.push(
      existing
        ? this.event(
            machine,
            "targetChanged",
            `The SSH target changed to ${machine.sshTarget}. Alert baselines restarted.`,
          )
        : this.event(machine, "monitoringStarted", "Runyard started monitoring this machine."),
    );
    return entry;
  }

  private event(machine: MachineConfig, kind: EventKind, detail: string, at = this.now()) {
    return { machineId: machine.id, machineName: machine.name, kind, detail, at };
  }

  private checkOne(machine: MachineConfig): Promise<void> {
    const pending = this.checking.get(machine.id);
    if (pending) return pending;
    const check = this.inspect(machine).finally(() => this.checking.delete(machine.id));
    this.checking.set(machine.id, check);
    return check;
  }

  private async inspect(machine: MachineConfig) {
    const previous = this.observations.get(machine.id) ?? { report: null, error: null };
    const os = this.expectedOs(machine, previous);
    try {
      const output = await inspect(this.deps.run, this.deps.programs, machine, os);
      const report = parseReport(output, machine.expectedOs ?? os ?? "other");
      this.observations.set(machine.id, {
        report: { at: this.now(), value: report },
        error: previous.error,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.observations.set(machine.id, {
        report: previous.report,
        error: { at: this.now(), value: message },
      });
    }
  }

  /** The OS to talk to: configured, else what Tailscale reports, else what the machine reported last. */
  private expectedOs(machine: MachineConfig, previous: MachineObservation): OsFamily | null {
    if (machine.expectedOs) return machine.expectedOs;
    const peer = findPeer(machine, this.tailnet.snapshot?.peers ?? []);
    const fromTailnet = peer ? osFromTailnet(peer.os) : null;
    if (fromTailnet && fromTailnet !== "other") return fromTailnet;
    return previous.report?.value.os ?? null;
  }

  private async sshLoop() {
    while (!this.stopped) {
      await this.checkMachines();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SSH_INTERVAL_MS);
        timer.unref();
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }
}
