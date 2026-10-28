import type { Migration, RunnerAssignment, Scope } from "@runyard/core";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { runnerAssignments, runnerMigrations } from "../db/schema.ts";

export function listAssignments(db: Db): RunnerAssignment[] {
  return db
    .select()
    .from(runnerAssignments)
    .all()
    .map((r) => ({
      scope: { forgeId: r.forgeId, kind: r.scopeKind, target: r.scopeTarget },
      runnerName: r.runnerName,
      machineId: r.machineId,
    }));
}

const where = (scope: Scope, runnerName: string) =>
  and(
    eq(runnerAssignments.forgeId, scope.forgeId),
    eq(runnerAssignments.scopeKind, scope.kind as "user" | "org" | "repo"),
    eq(runnerAssignments.scopeTarget, scope.target.toLowerCase()),
    eq(runnerAssignments.runnerName, runnerName.toLowerCase()),
  );

const migrationWhere = (scope: Scope, runnerName: string) =>
  and(
    eq(runnerMigrations.forgeId, scope.forgeId),
    eq(runnerMigrations.scopeKind, scope.kind as "user" | "org" | "repo"),
    eq(runnerMigrations.scopeTarget, scope.target.toLowerCase()),
    eq(runnerMigrations.runnerName, runnerName.toLowerCase()),
  );

/** Places a runner on a machine, or (with null) takes it off again. A move into a pool goes with it. */
export function assignRunner(
  db: Db,
  scope: Scope,
  runnerName: string,
  machineId: string | null,
  by: string,
) {
  db.transaction((tx) => {
    tx.delete(runnerAssignments).where(where(scope, runnerName)).run();
    tx.delete(runnerMigrations).where(migrationWhere(scope, runnerName)).run();
    if (machineId === null) return;
    tx.insert(runnerAssignments)
      .values({
        forgeId: scope.forgeId,
        scopeKind: scope.kind as "user" | "org" | "repo",
        scopeTarget: scope.target.toLowerCase(),
        runnerName: runnerName.toLowerCase(),
        machineId,
        assignedBy: by,
        assignedAt: new Date(),
      })
      .run();
  });
}

export function listMigrations(db: Db): Migration[] {
  return db
    .select()
    .from(runnerMigrations)
    .all()
    .map((r) => ({
      scope: { forgeId: r.forgeId, kind: r.scopeKind, target: r.scopeTarget },
      runnerName: r.runnerName,
      machineId: r.machineId,
      poolId: r.poolId,
      path: r.path,
    }));
}

/** Starts moving an assigned runner into a pool, replacing any earlier choice of pool. */
export function startMigration(db: Db, m: Migration, by: string) {
  db.transaction((tx) => {
    tx.delete(runnerMigrations).where(migrationWhere(m.scope, m.runnerName)).run();
    tx.insert(runnerMigrations)
      .values({
        forgeId: m.scope.forgeId,
        scopeKind: m.scope.kind as "user" | "org" | "repo",
        scopeTarget: m.scope.target.toLowerCase(),
        runnerName: m.runnerName.toLowerCase(),
        machineId: m.machineId,
        poolId: m.poolId,
        path: m.path,
        requestedBy: by,
        requestedAt: new Date(),
      })
      .run();
  });
}

/** Cancels a move, or closes one that's finished; the runner stays assigned to its machine. */
export function cancelMigration(db: Db, scope: Scope, runnerName: string) {
  db.delete(runnerMigrations).where(migrationWhere(scope, runnerName)).run();
}

/** After Runyard retires the runner: it's gone from the forge, so its move and assignment go too. */
export function finishMigration(db: Db, scope: Scope, runnerName: string) {
  assignRunner(db, scope, runnerName, null, "runyard");
}
