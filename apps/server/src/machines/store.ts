import type { EventKind, MachineConfig, MachineState, OsFamily, SshTransport } from "@runyard/core";
import { and, count, desc, eq, lt } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { ignoredPeers, machineEvents, machines, machineStates } from "../db/schema.ts";

export const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_EVENTS = 5_000;

export type MachineInput = {
  name: string;
  description?: string;
  sshTarget: string;
  transport: SshTransport;
  expectedOs?: OsFamily | null;
  tailscaleNodeId?: string | null;
  runyardKeyOnly?: boolean;
};

export type MachineEvent = {
  id: number;
  machineId: string;
  machineName: string;
  kind: EventKind;
  detail: string;
  at: number;
};

function toConfig(row: typeof machines.$inferSelect): MachineConfig {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sshTarget: row.sshTarget,
    transport: row.transport,
    expectedOs: row.expectedOs,
    tailscaleNodeId: row.tailscaleNodeId,
    runyardKeyOnly: row.runyardKeyOnly,
  };
}

export function listMachines(db: Db): MachineConfig[] {
  return db.select().from(machines).all().map(toConfig);
}

export function getMachine(db: Db, id: string): MachineConfig | undefined {
  const row = db.select().from(machines).where(eq(machines.id, id)).get();
  return row ? toConfig(row) : undefined;
}

export function machineForNode(db: Db, nodeId: string): MachineConfig | undefined {
  const row = db.select().from(machines).where(eq(machines.tailscaleNodeId, nodeId)).get();
  return row ? toConfig(row) : undefined;
}

export function createMachine(db: Db, input: MachineInput): MachineConfig {
  const row = {
    id: `m_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    name: input.name,
    description: input.description ?? "",
    sshTarget: input.sshTarget,
    transport: input.transport,
    expectedOs: input.expectedOs ?? null,
    tailscaleNodeId: input.tailscaleNodeId ?? null,
    // New machines are set up with Runyard's key, so they sign in with it alone.
    runyardKeyOnly: input.runyardKeyOnly ?? true,
    createdAt: new Date(),
  };
  db.insert(machines).values(row).run();
  return toConfig(row);
}

export function updateMachine(
  db: Db,
  id: string,
  patch: Partial<
    Pick<
      MachineInput,
      "name" | "description" | "sshTarget" | "transport" | "expectedOs" | "runyardKeyOnly"
    >
  >,
) {
  db.update(machines).set(patch).where(eq(machines.id, id)).run();
}

/** Removes the machine with its baselines and history. */
export function deleteMachine(db: Db, id: string) {
  db.delete(machines).where(eq(machines.id, id)).run();
}

export function ignoredNodeIds(db: Db): Set<string> {
  return new Set(
    db
      .select({ nodeId: ignoredPeers.nodeId })
      .from(ignoredPeers)
      .all()
      .map((r) => r.nodeId),
  );
}

export function ignorePeer(db: Db, nodeId: string, name: string) {
  db.insert(ignoredPeers)
    .values({ nodeId, name, ignoredAt: new Date() })
    .onConflictDoNothing()
    .run();
}

export function unignorePeer(db: Db, nodeId: string) {
  db.delete(ignoredPeers).where(eq(ignoredPeers.nodeId, nodeId)).run();
}

export function loadStates(db: Db): Map<string, { target: string; state: MachineState }> {
  return new Map(
    db
      .select()
      .from(machineStates)
      .all()
      .map((r) => [r.machineId, { target: r.target, state: JSON.parse(r.state) as MachineState }]),
  );
}

export function saveState(db: Db, machineId: string, target: string, state: MachineState) {
  const values = { target, state: JSON.stringify(state), updatedAt: new Date() };
  db.insert(machineStates)
    .values({ machineId, ...values })
    .onConflictDoUpdate({ target: machineStates.machineId, set: values })
    .run();
}

export function appendEvents(db: Db, events: Omit<MachineEvent, "id">[]) {
  if (events.length === 0) return;
  db.insert(machineEvents)
    .values(events.map((e) => ({ ...e, at: new Date(e.at) })))
    .run();
  const total = db.select({ n: count() }).from(machineEvents).get()?.n ?? 0;
  if (total > MAX_EVENTS) {
    const cutoff = db
      .select({ id: machineEvents.id })
      .from(machineEvents)
      .orderBy(desc(machineEvents.id))
      .limit(1)
      .offset(MAX_EVENTS - 1)
      .get();
    if (cutoff) db.delete(machineEvents).where(lt(machineEvents.id, cutoff.id)).run();
  }
}

/** Newest first. `before` is an exclusive event-ID cursor for paging. */
export function listEvents(
  db: Db,
  options: { machineId?: string; before?: number; limit: number },
): MachineEvent[] {
  const conditions = [
    options.machineId ? eq(machineEvents.machineId, options.machineId) : undefined,
    options.before ? lt(machineEvents.id, options.before) : undefined,
  ];
  return db
    .select()
    .from(machineEvents)
    .where(and(...conditions))
    .orderBy(desc(machineEvents.id))
    .limit(options.limit)
    .all()
    .map((e) => ({ ...e, kind: e.kind as EventKind, at: e.at.getTime() }));
}

export function pruneEvents(db: Db, now = Date.now()) {
  db.delete(machineEvents)
    .where(lt(machineEvents.at, new Date(now - EVENT_RETENTION_MS)))
    .run();
}
