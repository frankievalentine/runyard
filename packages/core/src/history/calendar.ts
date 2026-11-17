import { jobResult, type JobRecord } from "./jobs.ts";

/*
 * The traffic calendar: finished jobs counted per hour (so days come out right in any time zone),
 * grouped into the viewer's days and laid out as weeks of seven, like a contribution graph. No I/O.
 */

export const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** How long hourly counts are kept: 53 weeks, so a full year always fits. */
export const JOB_HOURS_RETENTION_MS = 53 * 7 * DAY_MS;

/** Finished jobs in one hour, which starts at `hour` (UTC milliseconds). */
export type HourCount = { hour: number; jobs: number; failed: number; cancelled: number };

/** One day's totals for the calendar. */
export type DayCount = { jobs: number; failed: number; cancelled: number };

export function hourOf(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

/**
 * Finished jobs counted by the hour they finished, oldest first. Failed includes jobs whose runner
 * was lost mid-job; running jobs and jobs without a finish time aren't counted.
 */
export function countByHour(jobs: readonly JobRecord[], now: number): HourCount[] {
  const hours = new Map<number, HourCount>();
  for (const j of jobs) {
    if (j.finishedAt === null) continue;
    const result = jobResult(j, now);
    if (result === "running") continue;
    const hour = hourOf(j.finishedAt);
    const c = hours.get(hour) ?? { hour, jobs: 0, failed: 0, cancelled: 0 };
    c.jobs++;
    if (result === "failed" || result === "lost") c.failed++;
    if (result === "cancelled") c.cancelled++;
    hours.set(hour, c);
  }
  return [...hours.values()].sort((a, b) => a.hour - b.hour);
}

/** Adds hourly counts from several sources (rolled-up and live), oldest first. */
export function mergeHours(...lists: readonly (readonly HourCount[])[]): HourCount[] {
  const hours = new Map<number, HourCount>();
  for (const list of lists) {
    for (const h of list) {
      const c = hours.get(h.hour) ?? { hour: h.hour, jobs: 0, failed: 0, cancelled: 0 };
      c.jobs += h.jobs;
      c.failed += h.failed;
      c.cancelled += h.cancelled;
      hours.set(h.hour, c);
    }
  }
  return [...hours.values()].sort((a, b) => a.hour - b.hour);
}

/** Hourly counts grouped into days; `dayKey` names an hour's day in the viewer's time zone. */
export function countByDay(
  hours: readonly HourCount[],
  dayKey: (ms: number) => string,
): Map<string, DayCount> {
  const days = new Map<string, DayCount>();
  for (const h of hours) {
    const key = dayKey(h.hour);
    const d = days.get(key) ?? { jobs: 0, failed: 0, cancelled: 0 };
    d.jobs += h.jobs;
    d.failed += h.failed;
    d.cancelled += h.cancelled;
    days.set(key, d);
  }
  return days;
}

/** A calendar date as `YYYY-MM-DD`. */
export type DateKey = string;

function dateKey(y: number, m: number, d: number): DateKey {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * The calendar's weeks, oldest first, each Sunday to Saturday, ending with the week holding
 * `today`. Days after today are null. Works on the date alone, so no time zone can shift it.
 */
export function calendarWeeks(
  today: { year: number; month: number; day: number },
  weeks: number,
): (DateKey | null)[][] {
  const t = Date.UTC(today.year, today.month - 1, today.day);
  const weekday = new Date(t).getUTCDay();
  const start = t - (weekday + 7 * (weeks - 1)) * DAY_MS;
  const out: (DateKey | null)[][] = [];
  for (let w = 0; w < weeks; w++) {
    const week: (DateKey | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const at = start + (w * 7 + d) * DAY_MS;
      const date = new Date(at);
      week.push(
        at > t ? null : dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()),
      );
    }
    out.push(week);
  }
  return out;
}

/**
 * Thresholds for the calendar's four shades above empty: the quartiles of the busy days, so the
 * shading follows this yard's own traffic. Returns the lowest count of each shade, ascending.
 */
export function shadeThresholds(counts: readonly number[]): [number, number, number, number] {
  const busy = counts.filter((n) => n > 0).sort((a, b) => a - b);
  if (!busy.length) return [1, 1, 1, 1];
  const at = (q: number) => busy[Math.min(busy.length - 1, Math.floor(q * busy.length))]!;
  return [1, Math.max(1, at(0.25)), Math.max(1, at(0.5)), Math.max(1, at(0.75))];
}

/** A day's shade: 0 for no jobs, 1 to 4 by the thresholds. */
export function shadeOf(n: number, thresholds: readonly [number, number, number, number]): number {
  if (n <= 0) return 0;
  let shade = 1;
  for (let i = 1; i < 4; i++) if (n >= thresholds[i]!) shade = i + 1;
  return shade;
}
