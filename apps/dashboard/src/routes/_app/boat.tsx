import type { BoatVm } from "@runyard/core";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, call } from "../../api.ts";
import { Elapsed, QueueList, RunnerLine } from "../../components/runners.tsx";
import { ErrorText } from "../../components/ui.tsx";
import { Chip, PageHead, Panel, Row, ttButton } from "../../components/tt.tsx";
import { Note, RowText, SIcon, TtConfirm, TtField } from "../../components/settings/parts.tsx";
import { yardQuery, useYard } from "../../lib/yard.ts";
import { formatDollars, timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { healthQuery, sessionQuery } from "../../lib/queries.ts";

export const Route = createFileRoute("/_app/boat")({
  component: BoatPage,
});

/** Strips an older card's own edge when it sits inside a panel. */
const bare = "border-t border-tt-rule [&>*]:!rounded-none [&>*]:!border-0 [&>*]:!shadow-none";

/** boat.dev: its CI jobs from GitHub's data, and with a read-only key, VMs, cost and limits. */
function BoatPage() {
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const admin = session.user?.role === "admin";
  const now = useNow();
  const { boat } = view;
  const running = view.runners.filter((r) => r.onDemand === "boat.dev");
  const queued = view.queue.jobs.filter((j) => j.onDemand === "boat.dev");
  return (
    <div>
      <PageHead
        back={admin ? { to: "/settings/account", hash: "boat", label: "Settings" } : undefined}
        sign={<SIcon name="cloud" size={26} />}
        title="boat.dev"
        lede="Jobs with runs-on: boat run on a fresh boat.dev VM each. Runyard shows them from GitHub's data; a read-only key adds each VM's cost, your plan's limits, and VMs left running."
        actions={admin && boat && <Disconnect />}
      />
      {boat?.error && <ErrorText className="mb-4" error={boat.error} />}
      {boat && (
        <div className="mb-[18px] grid grid-cols-1 gap-3 sm:grid-cols-3 lg:gap-[18px]">
          <Stat
            label="VMs running"
            value={boat.limits ? `${boat.limits.activeSandboxes}` : "?"}
            warn={boat.limits?.atConcurrencyLimit}
            sub={
              boat.limits
                ? `of ${boat.limits.maxActiveSandboxes} on plan ${boat.limits.plan}`
                : "limits not read"
            }
          />
          <Stat
            label="Starts this minute"
            value={
              boat.limits?.startsThisMinute ? `${boat.limits.startsThisMinute.used}` : "Unlimited"
            }
            warn={boat.limits?.atStartLimit}
            sub={boat.limits?.startsThisMinute ? `of ${boat.limits.startsThisMinute.limit}` : ""}
          />
          <Stat
            label="Read"
            value={boat.at ? timeAgo(boat.at, now) : "Not yet"}
            sub={boat.stale ? "stale" : "every 20 seconds"}
          />
        </div>
      )}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2 lg:gap-[18px]">
        <Panel title="Running" meta={running.length || undefined}>
          {running.length === 0 ? (
            <Note>No boat.dev jobs are running.</Note>
          ) : (
            <div className={bare}>
              {running.map((r) => (
                <RunnerLine key={r.key} r={r} />
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Queued" meta={queued.length || undefined}>
          {queued.length === 0 ? (
            <Note>No boat.dev jobs are waiting.</Note>
          ) : (
            <div className={bare}>
              <QueueList view={view} jobs={queued} compact />
            </div>
          )}
        </Panel>
        {boat ? (
          <>
            <Panel title="Left running" meta={boat.leftover.length || undefined}>
              <Note>
                VMs billing outside a running CI job: ones you started yourself, and CI VMs whose
                job GitHub hasn't reported running for 15 minutes. Stop them with{" "}
                <code>boat stop</code> or in boat.dev's dashboard.
              </Note>
              <VmList vms={boat.leftover} empty="Nothing is running outside CI." warn />
            </Panel>
            <Panel title="All running VMs" meta={boat.running.length || undefined}>
              <VmList vms={boat.running} empty="No boat.dev VMs are running." />
            </Panel>
          </>
        ) : admin ? (
          <Connect />
        ) : (
          <Panel title="Costs and limits">
            <Note>An admin can connect boat.dev for costs and limits.</Note>
          </Panel>
        )}
      </div>
      {boat && (
        <p className="mt-4 text-[12px] text-tt-ink-3">
          Costs are this UTC month at list price, as boat.dev reports them, and don't include plan
          discounts or trial credit.
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: ReactNode;
  sub: ReactNode;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border border-tt-rule bg-tt-card px-4 py-3.5">
      <div className="text-[10.5px] leading-none font-bold tracking-[.1em] text-tt-ink-3 uppercase">
        {label}
      </div>
      <div
        className={`mt-2 text-[28px] leading-none font-extrabold [font-stretch:80%] ${warn ? "text-tt-warn-ink" : ""}`}
      >
        {value}
      </div>
      <div className="mt-1 text-[12px] text-tt-ink-3">{sub || "\u00a0"}</div>
    </div>
  );
}

function VmList({ vms, empty, warn }: { vms: BoatVm[]; empty: string; warn?: boolean }) {
  if (vms.length === 0) return <Note className="border-t border-tt-rule pt-3">{empty}</Note>;
  return (
    <>
      {vms.map((v) => (
        <Row key={v.id} className="flex-wrap">
          <SIcon name="cloud" />
          <RowText
            mono
            title={v.name}
            detail={
              <>
                {v.id} · {v.type}
                {v.size && ` (${v.size})`}
                {v.jobId !== null && ` · job ${v.jobId}`} · up <Elapsed since={v.createdAt} />
              </>
            }
          />
          <Chip tone={warn ? "warn" : "busy"}>
            {v.dollars === null ? "cost unknown" : `${formatDollars(v.dollars)} so far`}
          </Chip>
        </Row>
      ))}
    </>
  );
}

function Connect() {
  const demo = useQuery(healthQuery).data?.demo === true;
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const connect = useMutation({
    mutationFn: () => call(api.boat.connection.$post({ json: { token } })),
    onSuccess: async () => {
      setToken("");
      await queryClient.invalidateQueries({ queryKey: yardQuery.queryKey });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    connect.mutate();
  };
  return (
    <Panel title="Connect boat.dev">
      <form onSubmit={submit} className="flex flex-col gap-4 px-4 pb-4 text-[13px]">
        <p className="text-tt-ink-2">
          Create a key that can only read, so Runyard can't start or change anything:{" "}
          <code className="text-tt-ink">boat api-key create</code> with the{" "}
          <b className="font-semibold text-tt-ink">sandbox.read</b> and{" "}
          <b className="font-semibold text-tt-ink">account.read</b> actions. Runyard stores it
          encrypted.
        </p>
        <TtField
          label="API key"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="boat_…"
          required
        />
        {connect.error && <ErrorText error={connect.error} />}
        <div>
          <button type="submit" className={ttButton.primary} disabled={connect.isPending || demo}>
            Connect
          </button>
        </div>
        {demo && (
          <p className="text-[12px] text-tt-ink-3">
            Not available with demo data: this would contact boat.dev.
          </p>
        )}
      </form>
    </Panel>
  );
}

function Disconnect() {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => call(api.boat.connection.$delete()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });
  return (
    <TtConfirm
      trigger="Disconnect"
      title="Disconnect boat?"
      description="Runyard forgets the API key. boat.dev jobs still show from GitHub's data, without costs. Revoke the key in boat.dev if it's no longer needed."
      confirm="Disconnect"
      onConfirm={() => remove.mutate()}
      pending={remove.isPending}
      error={remove.error}
    />
  );
}
