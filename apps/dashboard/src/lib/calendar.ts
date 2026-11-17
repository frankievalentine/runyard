import type { HourCount } from "@runyard/core";
import { useQuery } from "@tanstack/react-query";
import { api, call } from "../api.ts";

export type CalendarResponse = {
  weeks: number;
  hours: HourCount[];
  earliest: number | null;
  now: number;
};

/** Finished jobs per hour for the last `weeks` weeks. Under the "jobs" key, so new jobs refresh it. */
export function useCalendar(weeks: number) {
  return useQuery({
    queryKey: ["jobs", "calendar", weeks],
    queryFn: async () =>
      (await call(api.jobs.calendar.$get({ query: { weeks: String(weeks) } }))) as CalendarResponse,
    refetchInterval: 5 * 60_000,
  });
}

/** Whether any job has finished on a runner Runyard sees, as far back as it keeps. */
export function useJobsSeen(): boolean {
  const { data } = useCalendar(53);
  return Boolean(data && (data.earliest !== null || data.hours.length > 0));
}
