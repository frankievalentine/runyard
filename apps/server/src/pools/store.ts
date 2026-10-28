import type {
  Dispatch,
  ForgejoMode,
  Pool,
  PoolMode,
  Registration,
  Scope,
  TemplateRecord,
  ToolProfile,
} from "@runyard/core";
import { TOOL_PROFILES } from "@runyard/core";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import {
  dispatches,
  poolMachines,
  pools,
  runnerTemplates,
  poolScopes,
  publicRepoOverrides,
  registrations,
} from "../db/schema.ts";

export type PoolInput = {
  name: string;
  labels: string[];
  machines: { machineId: string; slots: number }[];
  scopes: { forgeId: string; kind: "user" | "org" | "repo"; target: string }[];
  forgejoMode: ForgejoMode;
  mode: PoolMode;
  toolProfiles: ToolProfile[];
};

export function listPools(db: Db): Pool[] {
  const machines = db.select().from(poolMachines).all();
  const scopes = db.select().from(poolScopes).all();
  return db
    .select()
    .from(pools)
    .orderBy(pools.name)
    .all()
    .map((p) => ({
      id: p.id,
      name: p.name,
      labels: JSON.parse(p.labels) as string[],
      forgejoMode:
        p.forgejoMode === "docker" && p.forgejoImage
          ? { kind: "docker", image: p.forgejoImage }
          : { kind: "host" },
      mode: p.mode,
      paused: p.paused,
      toolProfiles: (JSON.parse(p.toolProfiles) as string[]).filter(
        (t): t is ToolProfile => t in TOOL_PROFILES,
      ),
      machines: machines
        .filter((m) => m.poolId === p.id)
        .map(({ machineId, slots }) => ({ machineId, slots })),
      scopes: scopes
        .filter((s) => s.poolId === p.id)
        .map(({ forgeId, kind, target }) => ({ forgeId, kind, target })),
    }));
}

/** Creates or replaces a pool's definition in one transaction. */
export function savePool(
  db: Db,
  input: PoolInput,
  id = `p_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
): string {
  db.transaction((tx) => {
    const exists = tx.select({ id: pools.id }).from(pools).where(eq(pools.id, id)).get();
    const row = {
      name: input.name,
      labels: JSON.stringify(input.labels),
      forgejoMode: input.forgejoMode.kind,
      forgejoImage: input.forgejoMode.kind === "docker" ? input.forgejoMode.image : null,
      mode: input.mode,
      toolProfiles: JSON.stringify(input.toolProfiles),
    };
    if (exists) tx.update(pools).set(row).where(eq(pools.id, id)).run();
    else
      tx.insert(pools)
        .values({ id, ...row, createdAt: new Date() })
        .run();
    tx.delete(poolMachines).where(eq(poolMachines.poolId, id)).run();
    tx.delete(poolScopes).where(eq(poolScopes.poolId, id)).run();
    if (input.machines.length)
      tx.insert(poolMachines)
        .values(input.machines.map((m) => ({ poolId: id, ...m })))
        .run();
    if (input.scopes.length)
      tx.insert(poolScopes)
        .values(input.scopes.map((s) => ({ poolId: id, ...s })))
        .run();
  });
  return id;
}

/** Deletes the definition. Its runners stay registered until a plan removes them. */
export function deletePool(db: Db, id: string) {
  db.delete(pools).where(eq(pools.id, id)).run();
}

export function listRegistrations(db: Db): Registration[] {
  return db
    .select()
    .from(registrations)
    .all()
    .map((r) => ({
      key: r.key,
      machineId: r.machineId,
      runnerName: r.runnerName,
      scope: { forgeId: r.forgeId, kind: r.scopeKind, target: r.scopeTarget },
      path: r.path,
      serviceMode: r.serviceMode,
      runnerKind: r.runnerKind,
    }));
}

export function recordRegistration(db: Db, r: Registration) {
  if (r.scope.kind === "instance") throw new Error(`Unsupported scope ${r.scope.kind}.`);
  const row = {
    machineId: r.machineId,
    runnerName: r.runnerName,
    forgeId: r.scope.forgeId,
    scopeKind: r.scope.kind,
    scopeTarget: r.scope.target,
    path: r.path,
    serviceMode: r.serviceMode,
    runnerKind: r.runnerKind,
  };
  db.insert(registrations)
    .values({ key: r.key, ...row, createdAt: new Date() })
    .onConflictDoUpdate({ target: registrations.key, set: row })
    .run();
}

export function forgetRegistration(db: Db, machineId: string, scope: Scope, runnerName: string) {
  db.delete(registrations)
    .where(
      and(
        eq(registrations.machineId, machineId),
        eq(registrations.forgeId, scope.forgeId),
        eq(registrations.scopeTarget, scope.target),
        eq(registrations.runnerName, runnerName),
      ),
    )
    .run();
}

export function publicOverrides(db: Db): Set<string> {
  return new Set(
    db
      .select()
      .from(publicRepoOverrides)
      .all()
      .map((o) => `${o.forgeId}:${o.repo.toLowerCase()}`),
  );
}

export function allowPublicRepo(db: Db, forgeId: string, repo: string, by: string) {
  db.insert(publicRepoOverrides)
    .values({ forgeId, repo: repo.toLowerCase(), confirmedBy: by, confirmedAt: new Date() })
    .run();
}

export function revokePublicRepo(db: Db, forgeId: string, repo: string) {
  db.delete(publicRepoOverrides)
    .where(
      and(
        eq(publicRepoOverrides.forgeId, forgeId),
        eq(publicRepoOverrides.repo, repo.toLowerCase()),
      ),
    )
    .run();
}

/** Pauses or resumes an on-demand pool's dispatch. */
export function setPoolPaused(db: Db, id: string, paused: boolean) {
  db.update(pools).set({ paused }).where(eq(pools.id, id)).run();
}

type ScopeKind = "user" | "org" | "repo";

export function listTemplates(db: Db): TemplateRecord[] {
  return db
    .select()
    .from(runnerTemplates)
    .all()
    .map((t) => ({
      key: t.key,
      machineId: t.machineId,
      poolId: t.poolId,
      poolName: t.poolName,
      scope: { forgeId: t.forgeId, kind: t.scopeKind, target: t.scopeTarget },
      runnerKind: t.runnerKind,
      path: t.path,
      serviceMode: t.serviceMode,
    }));
}

export function recordTemplate(db: Db, t: TemplateRecord) {
  const row = {
    machineId: t.machineId,
    poolId: t.poolId,
    poolName: t.poolName,
    forgeId: t.scope.forgeId,
    scopeKind: t.scope.kind as ScopeKind,
    scopeTarget: t.scope.target,
    runnerKind: t.runnerKind,
    path: t.path,
    serviceMode: t.serviceMode,
  };
  db.insert(runnerTemplates)
    .values({ key: t.key, ...row, createdAt: new Date() })
    .onConflictDoUpdate({ target: runnerTemplates.key, set: row })
    .run();
}

export function forgetTemplate(db: Db, machineId: string, path: string) {
  db.delete(runnerTemplates)
    .where(and(eq(runnerTemplates.machineId, machineId), eq(runnerTemplates.path, path)))
    .run();
}

/** How many finished dispatches are kept, newest first. */
const DISPATCH_HISTORY = 500;

export function listDispatches(db: Db, limit = DISPATCH_HISTORY): Dispatch[] {
  return db
    .select()
    .from(dispatches)
    .orderBy(desc(dispatches.startedAt))
    .limit(limit)
    .all()
    .map((d) => ({
      id: d.id,
      poolId: d.poolId,
      machineId: d.machineId,
      runnerName: d.runnerName,
      runnerKind: d.runnerKind,
      scope: { forgeId: d.forgeId, kind: d.scopeKind, target: d.scopeTarget },
      jobId: d.jobId,
      runnerId: d.runnerId,
      state: d.state,
      startedAt: d.startedAt.getTime(),
      endedAt: d.endedAt?.getTime() ?? null,
      detail: d.detail,
    }));
}

export function saveDispatch(db: Db, d: Dispatch) {
  const row = {
    poolId: d.poolId,
    machineId: d.machineId,
    runnerName: d.runnerName,
    runnerKind: d.runnerKind,
    forgeId: d.scope.forgeId,
    scopeKind: d.scope.kind as ScopeKind,
    scopeTarget: d.scope.target,
    jobId: d.jobId,
    runnerId: d.runnerId,
    state: d.state,
    startedAt: new Date(d.startedAt),
    endedAt: d.endedAt === null ? null : new Date(d.endedAt),
    detail: d.detail,
  };
  db.insert(dispatches)
    .values({ id: d.id, ...row })
    .onConflictDoUpdate({ target: dispatches.id, set: row })
    .run();
}

/** Drops finished dispatches beyond the newest DISPATCH_HISTORY. */
export function pruneDispatches(db: Db) {
  const keep = listDispatches(db).at(-1);
  if (!keep) return;
  db.delete(dispatches)
    .where(
      and(
        lt(dispatches.startedAt, new Date(keep.startedAt)),
        inArray(dispatches.state, ["done", "failed"]),
      ),
    )
    .run();
}

export function deleteDispatch(db: Db, id: string) {
  db.delete(dispatches).where(eq(dispatches.id, id)).run();
}
