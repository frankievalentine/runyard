import type { RunnerView } from "@runyard/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError, call } from "../api.ts";
import { timeAgo } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";
import { useYard } from "../lib/yard.ts";
import { CopyValue } from "./CopyValue.tsx";
import { Button } from "./form.tsx";
import { Card, ErrorText, Pill, Section } from "./ui.tsx";

type TestJob = {
  runnerName: string;
  scope: RunnerView["scope"];
  repo: string;
  startedAt: number;
  status: "dispatched" | "queued" | "in_progress" | "completed";
  conclusion: string | null;
  url: string | null;
};
type Tests = { workflow: { path: string; yaml: string }; jobs: TestJob[] };

const testsKey = ["runner-tests"];

/** The repositories a runner takes jobs from, as far as its installation lists them. */
function servedRepos(view: ReturnType<typeof useYard>, r: RunnerView): string[] {
  if (r.scope.kind === "repo") return [r.scope.target];
  const owner = r.scope.target.toLowerCase();
  const app = view.github.apps.find((a) => a.forgeId === r.scope.forgeId);
  return (app?.installations ?? [])
    .filter((i) => i.account.toLowerCase() === owner)
    .flatMap((i) => i.repos)
    .filter((repo) => repo.split("/")[0]!.toLowerCase() === owner);
}

/**
 * Runs a short workflow on exactly this runner, through its own label, and
 * shows how it went. The workflow lives in a repository the user picks.
 */
export function TestThisRunner({ r }: { r: RunnerView }) {
  const view = useYard();
  const now = useNow();
  const queryClient = useQueryClient();
  const repos = servedRepos(view, r);
  const [repo, setRepo] = useState(repos[0] ?? "");
  const [docker, setDocker] = useState(false);
  const tests = useQuery({
    queryKey: testsKey,
    queryFn: () => call(api["runner-tests"].$get()) as Promise<Tests>,
    // While a test is pending, follow it.
    refetchInterval: (q) =>
      (q.state.data as Tests | undefined)?.jobs.some((j) => j.status !== "completed")
        ? 5000
        : false,
  });
  const start = useMutation({
    mutationFn: () =>
      call(
        api["runner-tests"].$post({
          json: {
            scope: {
              forgeId: r.scope.forgeId,
              kind: r.scope.kind as "user" | "org" | "repo",
              target: r.scope.target,
            },
            runnerName: r.name,
            repo,
            docker,
          },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: testsKey }),
  });
  const latest = tests.data?.jobs.find(
    (j) => j.runnerName.toLowerCase() === r.name.toLowerCase() && j.scope.target === r.scope.target,
  );
  const needsWorkflow = start.error instanceof ApiError && start.error.code === "noWorkflow";

  return (
    <Section title="Test this runner">
      <Card className="flex flex-col gap-3 px-4 py-3 text-[13px]">
        <p className="text-[12.5px] text-ink-2">
          Runs a short check (tools, a compiled program, optionally a container) on exactly this
          runner, through its label{" "}
          <span className="font-mono">runyard-runner-{r.name.toLowerCase()}</span>, from a
          repository it serves.
        </p>
        {repos.length === 0 ? (
          <p className="text-[12.5px] text-ink-2">
            No repository it serves is listed for its GitHub App installation yet.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="input !w-auto"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
            >
              {repos.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-[12.5px]">
              <input
                type="checkbox"
                checked={docker}
                onChange={(e) => setDocker(e.target.checked)}
              />
              Also run a container
            </label>
            <Button
              small
              variant="primary"
              onClick={() => start.mutate()}
              disabled={start.isPending || !repo}
            >
              {start.isPending ? "Starting…" : "Run a test job"}
            </Button>
          </div>
        )}
        {latest && (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <Pill tone={resultTone(latest)}>{resultLabel(latest)}</Pill>
            <span className="text-ink-2">
              in {latest.repo}, started {timeAgo(latest.startedAt, now)}
            </span>
            {latest.url && (
              <a
                href={latest.url}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Open the run
              </a>
            )}
          </div>
        )}
        {start.error && <ErrorText error={start.error} />}
        {needsWorkflow && tests.data && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-ink-2">
              Add this file to {repo} at{" "}
              <span className="font-mono">{tests.data.workflow.path}</span> on its default branch,
              then run the test again. Runyard never writes to your repositories.
            </span>
            <pre className="max-h-72 overflow-auto rounded-md border border-line bg-bg px-2.5 py-2 font-mono text-[11.5px] leading-relaxed">
              {tests.data.workflow.yaml}
            </pre>
            <div>
              <CopyValue
                value={tests.data.workflow.yaml}
                label="Workflow file"
                className="text-[12.5px] font-medium text-accent"
              >
                Copy the file
              </CopyValue>
            </div>
          </div>
        )}
      </Card>
    </Section>
  );
}

function resultLabel(j: TestJob): string {
  if (j.status !== "completed")
    return j.status === "in_progress" ? "Running" : "Waiting for the runner";
  if (j.conclusion === "success") return "Passed";
  if (j.conclusion === "not_found") return "Run not found";
  return j.conclusion ? `Failed (${j.conclusion.replace(/_/g, " ")})` : "Finished";
}

function resultTone(j: TestJob) {
  if (j.status !== "completed") return "busy" as const;
  return j.conclusion === "success" ? ("ok" as const) : ("bad" as const);
}
