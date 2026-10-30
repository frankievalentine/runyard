import { countJobs, isLost, type JobCounts } from "@runyard/core";
import { Hono } from "hono";
import { requireUser, type AppEnv } from "../auth/identity.ts";
import type { Db } from "../db/index.ts";
import { ForgejoError } from "../forgejo/client.ts";
import { GithubError } from "../github/client.ts";
import type { JobHistory } from "../history/recorder.ts";
import { getJob, listJobs } from "../history/store.ts";

const DAY_MS = 24 * 60 * 60_000;
/** Rows a list returns; the counts cover every job in the period. */
const LIST_LIMIT = 100;

/** Run history: jobs per machine, pool or runner, the overview's counts, and job logs. */
export function historyRoutes({ db, history }: { db: Db; history: JobHistory }) {
  return new Hono<AppEnv>()
    .get("/jobs", requireUser(), (c) => {
      const now = Date.now();
      const days = Math.min(30, Math.max(1, Number(c.req.query("days") ?? 7) || 7));
      const all = listJobs(db, {
        machineId: c.req.query("machine") || undefined,
        poolId: c.req.query("pool") || undefined,
        runnerName: c.req.query("runner") || undefined,
        since: now - days * DAY_MS,
        limit: 2000,
      });
      const failures = c.req.query("failures") === "1";
      const shown = failures
        ? all.filter(
            (j) =>
              isLost(j, now) || !["success", "cancelled", "skipped", null].includes(j.conclusion),
          )
        : all;
      return c.json({ days, counts: countJobs(all, now), jobs: shown.slice(0, LIST_LIMIT), now });
    })
    .get("/jobs/summary", requireUser(), (c) => {
      const now = Date.now();
      const week = listJobs(db, { since: now - 7 * DAY_MS, limit: 10_000 });
      const machines: Record<string, JobCounts> = {};
      const byMachine = new Map<string, typeof week>();
      for (const j of week)
        if (j.machineId) byMachine.set(j.machineId, [...(byMachine.get(j.machineId) ?? []), j]);
      for (const [id, jobs] of byMachine) machines[id] = countJobs(jobs, now);
      const recentFailures = week.filter(
        (j) =>
          (j.finishedAt ?? 0) > now - DAY_MS &&
          (isLost(j, now) || !["success", "cancelled", "skipped", null].includes(j.conclusion)),
      ).length;
      return c.json({ machines, recentFailures });
    })
    .get("/jobs/:id/log", requireUser(), async (c) => {
      const job = getJob(db, c.req.param("id"));
      if (!job) return c.json({ error: "No such job." }, 404);
      try {
        return c.json({ log: await history.log(job) });
      } catch (error) {
        const status =
          (error instanceof GithubError || error instanceof ForgejoError) && error.status === 404
            ? 404
            : 502;
        const message =
          error instanceof ForgejoError
            ? error.message
            : status === 404
              ? "GitHub no longer has this job's log (it keeps them 90 days by default)."
              : error instanceof Error
                ? error.message
                : String(error);

        return c.json({ error: message }, status);
      }
    });
}
