import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { api, call } from "../../api.ts";
import { Button } from "../../components/form.tsx";
import { Icon } from "../../components/icons.tsx";
import { Card, ErrorText, PageHeader, Section, StatusDot } from "../../components/ui.tsx";
import { useFleet } from "../../lib/fleet.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { machineToReview, setupSteps, type SetupStep } from "../../lib/setup.ts";

export const Route = createFileRoute("/_app/getting-started")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.user?.role !== "admin") throw redirect({ to: "/" });
  },
  component: GettingStarted,
});

const checksQuery = {
  queryKey: ["setup-checks"],
  queryFn: () => call(api.setup.checks.$get()),
};

const link = "font-medium text-accent hover:underline";

function GettingStarted() {
  const view = useFleet();
  const steps = setupSteps(view);
  const done = steps.filter((s) => s.done).length;
  const review = machineToReview(view);
  const actions: Record<SetupStep["id"], ReactNode> = {
    forge: (
      <>
        <Link to="/settings/github" className={link}>
          Set up GitHub
        </Link>
        <span className="text-ink-3">or</span>
        <Link to="/settings/forgejo" className={link}>
          connect Forgejo
        </Link>
      </>
    ),
    machine: (
      <Link to="/machines/add" className={link}>
        Add machines
      </Link>
    ),
    pool: (
      <Link to="/pools/new" className={link}>
        New pool
      </Link>
    ),
    runners: review ? (
      <Link to="/machines/$id" params={{ id: review }} hash="changes" className={link}>
        Review changes on {view.machines.find((m) => m.id === review)?.name ?? "the machine"}
      </Link>
    ) : null,
  };
  return (
    <div>
      <PageHeader
        icon={<Icon name="check" size={16} />}
        title="Getting started"
        subtitle={`${done} of ${steps.length} steps done. This page reads what's already set up; nothing here changes anything.`}
      />
      <Section title="This machine">
        <Checks />
      </Section>
      <Section title="Steps">
        <Card className="overflow-hidden">
          <ol className="divide-y divide-line">
            {steps.map((s, i) => (
              <li key={s.id} className="flex items-start gap-3 px-4 py-3 text-[13px]">
                <span
                  className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${s.done ? "bg-ok text-white" : "border border-line text-ink-2"}`}
                >
                  {s.done ? <Icon name="check" size={11} /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`font-medium ${s.done ? "text-ink-2" : ""}`}>{s.title}</div>
                  <div className="text-[12.5px] text-ink-2">{s.detail}</div>
                  {!s.done && actions[s.id] && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px]">
                      {actions[s.id]}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </Section>
    </div>
  );
}

const TONE = { ok: "ok", warn: "warn", bad: "bad", off: "muted" } as const;

function Checks() {
  const checks = useQuery(checksQuery);
  if (checks.isPending)
    return <Card className="px-4 py-3 text-[12.5px] text-ink-2">Checking…</Card>;
  if (checks.error) return <ErrorText error={checks.error} />;
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line">
        {checks.data.map((c) => (
          <li key={c.id} className="flex items-start gap-3 px-4 py-3 text-[12.5px]">
            <span className="mt-1.5">
              <StatusDot tone={TONE[c.state]} hollow={c.state === "off"} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{c.title}</div>
              <div className="break-words text-ink-2">{c.detail}</div>
              {c.fix && <div className="mt-1 text-ink">{c.fix}</div>}
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-line px-4 py-2">
        <Button small onClick={() => void checks.refetch()} disabled={checks.isFetching}>
          Check again
        </Button>
      </div>
    </Card>
  );
}
