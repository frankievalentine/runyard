import {
  JOB_RETENTION_MS,
  mergeJob,
  type JobConclusion,
  type JobObservation,
  type JobRecord,
  type JobSource,
} from "@runyard/core";
import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { jobs } from "../db/schema.ts";

type Row = typeof jobs.$inferSelect;

function toRecord(r: Row): JobRecord {
  return {
    id: r.id,
    forgeId: r.forgeId,
    repo: r.repo,
    jobId: r.jobId,
    runId: r.runId,
    runAttempt: r.runAttempt,
    name: r.name,
    workflow: r.workflow,
    runnerName: r.runnerName,
    machineId: r.machineId,
    poolId: r.poolId,
    startedAt: r.startedAt?.getTime() ?? null,
    finishedAt: r.finishedAt?.getTime() ?? null,
    conclusion: r.conclusion as JobConclusion | null,
    htmlUrl: r.htmlUrl,
    test: r.test,
    hook: r.hook,
    sources: JSON.parse(r.sources) as JobSource[],
  };
}

/**
 * The record an observation belongs to: the forge's job ID when known, else
 * the run, attempt and runner (all a runner's hooks know), adopting a record
 * that hasn't learned its job ID yet.
 */
function find(db: Db, o: JobObservation): Row | undefined {
  const sameRepo = and(eq(jobs.forgeId, o.forgeId), eq(jobs.repo, o.repo));
  if (o.jobId != null) {
    const byId = db
      .select()
      .from(jobs)
      .where(and(sameRepo, eq(jobs.jobId, o.jobId)))
      .get();
    if (byId) return byId;
  }
  if (!o.runnerName) return undefined;
  return db
    .select()
    .from(jobs)
    .where(
      and(
        sameRepo,
        eq(jobs.runId, o.runId),
        eq(jobs.runAttempt, o.runAttempt),
        sql`lower(${jobs.runnerName}) = ${o.runnerName.toLowerCase()}`,
        o.jobId != null ? or(isNull(jobs.jobId), eq(jobs.jobId, o.jobId)) : undefined,
      ),
    )
    .get();
}

/** Merges what a source saw about a job into its record, creating it if new. */
export function recordJob(db: Db, o: JobObservation, now = Date.now()): JobRecord {
  const existing = find(db, o);
  const merged = mergeJob(existing ? toRecord(existing) : undefined, o, crypto.randomUUID());
  const row = {
    forgeId: merged.forgeId,
    repo: merged.repo,
    jobId: merged.jobId,
    runId: merged.runId,
    runAttempt: merged.runAttempt,
    name: merged.name,
    workflow: merged.workflow,
    runnerName: merged.runnerName,
    machineId: merged.machineId,
    poolId: merged.poolId,
    startedAt: merged.startedAt === null ? null : new Date(merged.startedAt),
    finishedAt: merged.finishedAt === null ? null : new Date(merged.finishedAt),
    conclusion: merged.conclusion,
    htmlUrl: merged.htmlUrl,
    test: merged.test,
    hook: merged.hook,
    sources: JSON.stringify(merged.sources),
    updatedAt: new Date(now),
  };
  db.insert(jobs)
    .values({ id: merged.id, ...row })
    .onConflictDoUpdate({ target: jobs.id, set: row })
    .run();
  return merged;
}

export type JobFilter = {
  machineId?: string;
  poolId?: string;
  runnerName?: string;
  since: number;
  limit?: number;
};

/** Jobs started (or, unstarted, seen) since a time, newest first. */
export function listJobs(db: Db, f: JobFilter): JobRecord[] {
  return db
    .select()
    .from(jobs)
    .where(
      and(
        gte(sql`coalesce(${jobs.startedAt}, ${jobs.updatedAt})`, f.since),
        f.machineId ? eq(jobs.machineId, f.machineId) : undefined,
        f.poolId ? eq(jobs.poolId, f.poolId) : undefined,
        f.runnerName ? sql`lower(${jobs.runnerName}) = ${f.runnerName.toLowerCase()}` : undefined,
      ),
    )
    .orderBy(desc(sql`coalesce(${jobs.startedAt}, ${jobs.updatedAt})`))
    .limit(f.limit ?? 500)
    .all()
    .map(toRecord);
}

export function getJob(db: Db, id: string): JobRecord | undefined {
  const row = db.select().from(jobs).where(eq(jobs.id, id)).get();
  return row ? toRecord(row) : undefined;
}

/** Jobs whose result isn't known yet, oldest change first, for the result reads. */
export function jobsWithoutResult(db: Db, limit: number): JobRecord[] {
  return db
    .select()
    .from(jobs)
    .where(isNull(jobs.conclusion))
    .orderBy(jobs.updatedAt)
    .limit(limit)
    .all()
    .map(toRecord);
}

/** Jobs a hook saw start but not finish, which the forge finished in the last day. */
export function possiblyLostJobs(db: Db, now = Date.now()): JobRecord[] {
  return db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.hook, "started"),
        sql`${jobs.conclusion} is not null`,
        gte(jobs.finishedAt, new Date(now - 24 * 60 * 60_000)),
      ),
    )
    .all()
    .map(toRecord);
}

export function pruneJobs(db: Db, now = Date.now()) {
  db.delete(jobs)
    .where(lt(jobs.updatedAt, new Date(now - JOB_RETENTION_MS)))
    .run();
}
