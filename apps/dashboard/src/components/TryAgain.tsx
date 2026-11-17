import { jobAttempts, nextAttempt, type QueuedJobView, type YardView } from "@runyard/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, call } from "../api.ts";
import { sessionQuery } from "../lib/queries.ts";
import { ttRowButton } from "./tt.tsx";
import { ErrorText } from "./ui.tsx";

/** For a job Runyard stopped starting runners for: start counting its tries again. */
export function TryAgain({ job, view }: { job: QueuedJobView; view: YardView }) {
  const session = useQuery(sessionQuery);
  const kind = job.forge === "forgejo" ? "forgejo" : "actions";
  const next = nextAttempt(
    jobAttempts(view.pools.dispatches, kind, job.id),
    view.queue.at,
    Date.now(),
  );
  const retry = useMutation({
    mutationFn: () => call(api.dispatches.retry.$post({ json: { kind, jobId: job.id } })),
  });
  if (next.ok || next.why !== "exhausted" || session.data?.user?.role !== "admin") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={ttRowButton.secondary}
        onClick={() => retry.mutate()}
        disabled={retry.isPending || retry.isSuccess}
      >
        {retry.isPending ? "Starting…" : retry.isSuccess ? "Started" : "Try again"}
      </button>
      {retry.error && <ErrorText error={retry.error} />}
    </div>
  );
}
