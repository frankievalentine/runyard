import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "../../components/form.tsx";
import { Card, ErrorText, Pill, Section, StatusDot, SubHeader } from "../../components/ui.tsx";
import { useYard } from "../../lib/yard.ts";
import { plural } from "../../lib/format.ts";
import { checksQuery, sessionQuery } from "../../lib/queries.ts";

export const Route = createFileRoute("/_app/settings/connections")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.user?.role !== "admin") throw redirect({ to: "/settings/account" });
  },
  component: Connections,
});

const manage =
  "inline-flex h-[28px] items-center rounded-[6px] border border-line-strong bg-card shadow-[0_1px_1px_rgb(0_0_0/0.04)] px-2.5 text-[12.5px] font-medium hover:bg-hover";
/** While no forge is connected, connecting one is the page's main action. */
const primary =
  "inline-flex h-[28px] items-center rounded-[6px] bg-accent px-2.5 text-[12.5px] font-medium text-white hover:brightness-110";

function Connections() {
  const view = useYard();
  const apps = view.github.apps;
  const installs = apps.reduce((n, a) => n + a.installations.length, 0);
  const conns = view.forgejo.connections;
  const boat = view.boat;
  const noForge = apps.length === 0 && conns.length === 0;
  return (
    <>
      <SubHeader
        title="Connections"
        subtitle={
          noForge
            ? "Connect GitHub, Forgejo or both: one forge is enough to start. boat.dev is optional."
            : "The forges whose runners and jobs Runyard reads, and boat.dev for on-demand CI VMs."
        }
      />
      <div className="mt-4 grid grid-cols-1 gap-3 min-[900px]:grid-cols-3">
        <Service
          name="GitHub"
          state={
            apps.length === 0 ? "off" : apps.some((a) => a.error) ? "bad" : installs ? "ok" : "warn"
          }
          status={apps.length === 0 ? "Not set up" : installs ? "Connected" : "Not installed"}
          detail={
            apps.length === 0
              ? "Runyard's own GitHub App reads runners and jobs, for personal accounts and organizations."
              : `${apps.map((a) => a.owner).join(", ")} · ${plural(installs, "installation")}`
          }
          action={
            <Link to="/settings/github" className={noForge ? primary : manage}>
              {apps.length ? "Manage" : "Set up"}
            </Link>
          }
        />
        <Service
          name="Forgejo"
          state={conns.length === 0 ? "off" : conns.some((c) => c.error) ? "bad" : "ok"}
          status={
            conns.length === 0 ? "Not set up" : conns.some((c) => c.error) ? "Error" : "Connected"
          }
          detail={
            conns.length === 0
              ? "An access token for one user reads and registers runners on Forgejo 15 or later."
              : conns.map((c) => `${c.login} on ${new URL(c.baseUrl).host}`).join(", ")
          }
          action={
            <Link to="/settings/forgejo" className={noForge ? primary : manage}>
              {conns.length ? "Manage" : "Connect"}
            </Link>
          }
        />
        <Service
          name="boat.dev"
          state={!boat ? "off" : boat.error ? "bad" : "ok"}
          status={!boat ? "Optional" : boat.error ? "Error" : "Connected"}
          detail={
            !boat
              ? "A read-only key adds live cost, VM limits and VMs left running for runs-on: boat jobs."
              : boat.limits
                ? `Plan ${boat.limits.plan} · ${boat.limits.activeSandboxes} of ${boat.limits.maxActiveSandboxes} VMs running`
                : "Connected; limits not read yet."
          }
          action={
            <Link to="/boat" className={manage}>
              {boat ? "Open" : "Connect"}
            </Link>
          }
        />
      </div>
      <Section title="This machine">
        <Checks />
      </Section>
    </>
  );
}

const TONE = { ok: "ok", warn: "warn", bad: "bad", off: "muted" } as const;

function Service({
  name,
  state,
  status,
  detail,
  action,
}: {
  name: string;
  state: keyof typeof TONE;
  status: string;
  detail: string;
  action: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-2 px-4 py-3 text-[13px]">
      <div className="flex items-center gap-2">
        <span className="font-medium">{name}</span>
        <Pill tone={TONE[state]} hollow={state === "off"}>
          {status}
        </Pill>
      </div>
      <p className="flex-1 text-[12.5px] text-ink-2">{detail}</p>
      <div>{action}</div>
    </Card>
  );
}

/** The control machine's setup checks: ssh, Tailscale, the secret key, disk and the service. */
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
