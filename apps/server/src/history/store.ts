import {
  countByHour,
  JOB_HOURS_RETENTION_MS,
  JOB_RETENTION_MS,
  mergeJob,
  type HourCount,
  type JobConclusion,
  type JobObservation,
  type JobRecord,
  type JobSource,
} from "@runyard/core";
import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { jobHours, jobs } from "../db/schema.ts";

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

/**
 * Merges what a source saw about a job into its record, creating it if new.
 * `changed` says whether that told Runyard anything new.
 */
export function recordJob(
  db: Db,
  o: JobObservation,
  now = Date.now(),
): JobRecord & { changed: boolean } {
  const existing = find(db, o);
  const before = existing ? toRecord(existing) : undefined;
  const merged = mergeJob(before, o, crypto.randomUUID());
  const same = (a: JobRecord, b: JobRecord) =>
    (Object.keys(b) as (keyof JobRecord)[]).every(
      (k) => JSON.stringify(a[k]) === JSON.stringify(b[k]),
    );
  if (before && same(before, merged)) return { ...merged, changed: false };

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
  return { ...merged, changed: true };
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

/**
 * Deletes jobs untouched for 30 days, first adding them to the hourly counts so the traffic calendar
 * keeps them, and drops hourly counts older than 53 weeks. One transaction, so no job is counted
 * twice or lost between the two.
 */
export function pruneJobs(db: Db, now = Date.now()) {
  const old = lt(jobs.updatedAt, new Date(now - JOB_RETENTION_MS));
  db.transaction((tx) => {
    const leaving = tx.select().from(jobs).where(old).all().map(toRecord);
    for (const h of countByHour(leaving, now)) {
      tx.insert(jobHours)
        .values(h)
        .onConflictDoUpdate({
          target: jobHours.hour,
          set: {
            jobs: sql`${jobHours.jobs} + ${h.jobs}`,
            failed: sql`${jobHours.failed} + ${h.failed}`,
            cancelled: sql`${jobHours.cancelled} + ${h.cancelled}`,
          },
        })
        .run();
    }
    tx.delete(jobs).where(old).run();
    tx.delete(jobHours)
      .where(lt(jobHours.hour, now - JOB_HOURS_RETENTION_MS))
      .run();
  });
}

/**
 * Finished jobs per hour since a time, for the traffic calendar: the hourly counts of pruned jobs
 * plus the jobs still on record, counted live. Also the earliest hour Runyard has anything for.
 */
export function jobHoursSince(
  db: Db,
  since: number,
  now = Date.now(),
): { stored: HourCount[]; live: HourCount[]; earliest: number | null } {
  const stored = db
    .select()
    .from(jobHours)
    .where(gte(jobHours.hour, since))
    .orderBy(jobHours.hour)
    .all();
  const recent = db
    .select()
    .from(jobs)
    .where(gte(jobs.finishedAt, new Date(since)))
    .all()
    .map(toRecord);
  const firstStored = db
    .select({ hour: sql<number | null>`min(${jobHours.hour})` })
    .from(jobHours)
    .get()?.hour;
  const firstJob = db
    .select({ at: sql<number | null>`min(${jobs.finishedAt})` })
    .from(jobs)
    .get()?.at;
  const firsts = [firstStored, firstJob].filter((t): t is number => typeof t === "number");
  return {
    stored,
    live: countByHour(recent, now),
    earliest: firsts.length ? Math.min(...firsts) : null,
  };
}
