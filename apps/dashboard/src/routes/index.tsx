import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Card, ErrorText, Pill, Section } from "../components/ui.tsx";
import { healthQuery } from "../lib/queries.ts";

export const Route = createFileRoute("/")({
  component: Overview,
});

function Overview() {
  const health = useQuery(healthQuery);
  return (
    <>
      <h1 className="text-[20px] font-semibold tracking-tight">Overview</h1>
      <Section title="Control service">
        <Card className="flex items-center gap-3 px-4 py-3">
          {health.isPending ? (
            <Pill tone="muted">Checking</Pill>
          ) : health.isError ? (
            <>
              <Pill tone="bad">Unreachable</Pill>
              <ErrorText error={health.error} />
            </>
          ) : (
            <>
              <Pill tone="ok">Online</Pill>
              <span className="font-mono text-[12px] text-ink-2 tabular">
                v{health.data.version}
              </span>
            </>
          )}
        </Card>
      </Section>
    </>
  );
}
