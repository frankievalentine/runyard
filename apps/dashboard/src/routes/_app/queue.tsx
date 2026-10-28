import { createFileRoute, Link } from "@tanstack/react-router";
import { Icon } from "../../components/icons.tsx";
import { emptyQueueText, forgesConnected, QueueList } from "../../components/runners.tsx";
import { Card, PageHeader } from "../../components/ui.tsx";
import { useFleet } from "../../lib/fleet.ts";
import { timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";

export const Route = createFileRoute("/_app/queue")({
  component: Queue,
});

/** fleet's QueueDetail. */
function Queue() {
  const view = useFleet();
  const now = useNow();
  const q = view.queue;
  const connected = forgesConnected(view);
  return (
    <div>
      <PageHeader
        icon={<Icon name="queue" size={18} />}
        title="Queued jobs"
        subtitle={
          q.at
            ? `Self-hosted jobs waiting for a runner · checked ${timeAgo(q.at, now)}`
            : "Jobs waiting for a self-hosted runner across scanned repositories."
        }
      />
      <div className="mt-8">
        {q.jobs.length ? (
          <QueueList view={view} />
        ) : (
          <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <span className="flex size-10 items-center justify-center rounded-lg border border-line bg-sunken text-ink-2">
              <Icon name="inbox" size={20} />
            </span>
            <div className="space-y-1">
              <p className="text-[14px] font-medium">{emptyQueueText(view)}</p>
              <p className="max-w-sm text-[13px] leading-relaxed text-ink-2">
                {!connected ? (
                  <>
                    Create Runyard's GitHub App in{" "}
                    <Link to="/settings/github" className="text-accent hover:underline">
                      Settings ▸ GitHub
                    </Link>{" "}
                    or connect an account in{" "}
                    <Link to="/settings/forgejo" className="text-accent hover:underline">
                      Settings ▸ Forgejo
                    </Link>{" "}
                    to see queued and running jobs.
                  </>
                ) : q.complete ? (
                  "The scanned repositories have no jobs waiting for a self-hosted runner."
                ) : (
                  "Waiting for a complete job scan."
                )}
              </p>
            </div>
          </Card>
        )}
      </div>
      <div className="mt-4 space-y-1.5 text-[12px] text-ink-2">
        {!q.complete && connected && (
          <p className="text-warn">
            This list may be incomplete: job data is missing or stale, or an installation has more
            repositories than Runyard scans (the 30 most recently pushed).
          </p>
        )}
        <p>
          "Matching" means the runner has every label the job asks for. Runner-group access rules
          can still keep a job off a runner; GitHub's API doesn't expose that per job. Forgejo lists
          only jobs waiting for a runner, not which runner took one.
        </p>
      </div>
    </div>
  );
}
