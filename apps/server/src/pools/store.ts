import type { Pool, Registration, Scope } from "@runyard/core";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import {
  poolMachines,
  pools,
  poolScopes,
  publicRepoOverrides,
  registrations,
} from "../db/schema.ts";

export type PoolInput = {
  name: string;
  labels: string[];
  machines: { machineId: string; slots: number }[];
  scopes: { forgeId: string; kind: "org" | "repo"; target: string }[];
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
    if (exists)
      tx.update(pools)
        .set({ name: input.name, labels: JSON.stringify(input.labels) })
        .where(eq(pools.id, id))
        .run();
    else
      tx.insert(pools)
        .values({
          id,
          name: input.name,
          labels: JSON.stringify(input.labels),
          createdAt: new Date(),
        })
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
    }));
}

export function recordRegistration(db: Db, r: Registration) {
  if (r.scope.kind !== "org" && r.scope.kind !== "repo")
    throw new Error(`Unsupported scope ${r.scope.kind}.`);
  const row = {
    machineId: r.machineId,
    runnerName: r.runnerName,
    forgeId: r.scope.forgeId,
    scopeKind: r.scope.kind,
    scopeTarget: r.scope.target,
    path: r.path,
    serviceMode: r.serviceMode,
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
