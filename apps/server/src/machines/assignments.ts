import type { RunnerAssignment, Scope } from "@runyard/core";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { runnerAssignments } from "../db/schema.ts";

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

/** Places a runner on a machine, or (with null) takes it off again. */
export function assignRunner(
  db: Db,
  scope: Scope,
  runnerName: string,
  machineId: string | null,
  by: string,
) {
  db.transaction((tx) => {
    tx.delete(runnerAssignments).where(where(scope, runnerName)).run();
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
