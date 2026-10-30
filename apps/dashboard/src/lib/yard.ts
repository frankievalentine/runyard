import type { YardView } from "@runyard/core";
import {
  keepPreviousData,
  queryOptions,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { api, call } from "../api.ts";
import { sessionQuery } from "./queries.ts";

/** The server pushes every change over SSE, so this is never refetched on a timer. */
export const yardQuery = queryOptions({
  queryKey: ["yard"],
  queryFn: async () => (await call(api.yard.$get())) as YardView,
  staleTime: Number.POSITIVE_INFINITY,
});

/** Keeps the yard view current from the server's event stream while mounted. */
export function useYardStream() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource("/api/stream");
    let jobsAt: number | undefined;
    source.addEventListener("yard", (event) => {
      const view = JSON.parse((event as MessageEvent<string>).data) as YardView;
      queryClient.setQueryData(yardQuery.queryKey, view);
      // A changed view may come with new events.
      void queryClient.invalidateQueries({ queryKey: ["events"] });
      // Run history changed: pages listing jobs read them again.
      if (view.jobsAt !== jobsAt) {
        if (jobsAt !== undefined) {
          void queryClient.invalidateQueries({ queryKey: ["jobs"] });
          void queryClient.invalidateQueries({ queryKey: ["jobs-summary"] });
        }
        jobsAt = view.jobsAt;
      }
    });

    // EventSource reconnects by itself; a failure may also mean the session ended, so re-check it.
    source.addEventListener(
      "error",
      () => void queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey }),
    );
    return () => source.close();
  }, [queryClient]);
}

export function useYard(): YardView {
  return useSuspenseQuery(yardQuery).data;
}

/** Events per history page. */
export const EVENTS_PAGE = 10;

/** One page of history, newest first, before an event ID. One extra event says whether there's an older page. */
export function eventsQuery(machineId?: string, before?: number) {
  return queryOptions({
    queryKey: ["events", machineId ?? "all", before ?? "latest"],
    queryFn: () =>
      call(
        api.events.$get({
          query: {
            limit: String(EVENTS_PAGE + 1),
            ...(machineId ? { machine: machineId } : {}),
            ...(before ? { before: String(before) } : {}),
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });
}
