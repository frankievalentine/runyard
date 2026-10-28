import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { BoatVm } from "@runyard/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { Button, TextField } from "../../components/form.tsx";
import { Icon } from "../../components/icons.tsx";
import { Elapsed } from "../../components/runners.tsx";
import {
  Card,
  EmptyLine,
  ErrorText,
  PageHeader,
  Pill,
  Section,
  Stat,
  StatStrip,
} from "../../components/ui.tsx";
import { fleetQuery, useFleet } from "../../lib/fleet.ts";
import { formatDollars, timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { healthQuery, sessionQuery } from "../../lib/queries.ts";

export const Route = createFileRoute("/_app/settings/boat")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.user?.role !== "admin") throw redirect({ to: "/" });
  },
  component: BoatSettings,
});

function BoatSettings() {
  const { boat } = useFleet();
  const now = useNow();
  return (
    <div>
      <PageHeader
        icon={<Icon name="external" size={16} />}
        title="boat"
        subtitle="Optional. With a read-only API key, Runyard shows boat's VMs, what each costs so far, and your plan's limits. It never starts, stops or changes a VM."
        actions={boat && <Disconnect />}
      />
      {!boat ? (
        <Section title="Connect boat">
          <Connect />
        </Section>
      ) : (
        <>
          {boat.error && <ErrorText className="mt-4" error={boat.error} />}
          <div className="mt-8">
            <StatStrip cols={3}>
              <Stat
                label="VMs running"
                value={boat.limits ? `${boat.limits.activeSandboxes}` : "?"}
                tone={boat.limits?.atConcurrencyLimit ? "warn" : undefined}
                sub={
                  boat.limits
                    ? `of ${boat.limits.maxActiveSandboxes} on plan ${boat.limits.plan}`
                    : "limits not read"
                }
              />
              <Stat
                label="Starts this minute"
                value={
                  boat.limits?.startsThisMinute
                    ? `${boat.limits.startsThisMinute.used}`
                    : "Unlimited"
                }
                tone={boat.limits?.atStartLimit ? "warn" : undefined}
                sub={
                  boat.limits?.startsThisMinute ? `of ${boat.limits.startsThisMinute.limit}` : ""
                }
              />
              <Stat
                label="Read"
                value={boat.at ? timeAgo(boat.at, now) : "Not yet"}
                tone={boat.stale ? "muted" : "ok"}
                hollow={boat.stale}
                sub={boat.stale ? "stale" : "every 20 seconds"}
              />
            </StatStrip>
          </div>
          <Section title="Left running" count={boat.leftover.length}>
            <p className="mb-3 max-w-2xl text-[12.5px] text-ink-2">
              VMs billing outside a running CI job: ones you started yourself, and CI VMs whose job
              GitHub hasn't reported running for 15 minutes. Stop them with <code>boat stop</code>{" "}
              or in boat's dashboard.
            </p>
            <VmList vms={boat.leftover} empty="Nothing is running outside CI." />
          </Section>
          <Section title="All running VMs" count={boat.running.length}>
            <VmList vms={boat.running} empty="No boat VMs are running." />
          </Section>
          <p className="mt-4 text-[12px] text-ink-3">
            Costs are this UTC month at list price, as boat reports them, and don't include plan
            discounts or trial credit.
          </p>
        </>
      )}
    </div>
  );
}

function VmList({ vms, empty }: { vms: BoatVm[]; empty: string }) {
  return (
    <Card className="overflow-hidden">
      {vms.length === 0 ? (
        <EmptyLine>{empty}</EmptyLine>
      ) : (
        <ul className="divide-y divide-line">
          {vms.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[12.5px]">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono font-medium">{v.name}</div>
                <div className="text-ink-2">
                  {v.id} · {v.type}
                  {v.size && ` (${v.size})`}
                  {v.jobId !== null && ` · job ${v.jobId}`}
                </div>
              </div>
              <span className="text-ink-2 tabular">
                up <Elapsed since={v.createdAt} />
              </span>
              <Pill tone="muted">
                {v.dollars === null ? "cost unknown" : `${formatDollars(v.dollars)} so far`}
              </Pill>
            </li>
          ))}
        </ul>
      )}
    </Card>
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
      await queryClient.invalidateQueries({ queryKey: fleetQuery.queryKey });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    connect.mutate();
  };
  return (
    <Card className="max-w-xl px-4 py-4">
      <form onSubmit={submit} className="flex flex-col gap-4 text-[13px]">
        <p className="text-ink-2">
          Create a key that can only read, so Runyard can't start or change anything:{" "}
          <code className="text-ink">boat api-key create</code> with the{" "}
          <b className="font-medium text-ink">sandbox.read</b> and{" "}
          <b className="font-medium text-ink">account.read</b> actions. Runyard stores it encrypted.
        </p>
        <TextField
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
          <Button type="submit" variant="primary" disabled={connect.isPending || demo}>
            Connect
          </Button>
        </div>
        {demo && (
          <p className="text-[12px] text-ink-3">
            Not available with demo data: this would contact boat.
          </p>
        )}
      </form>
    </Card>
  );
}

function Disconnect() {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => call(api.boat.connection.$delete()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: fleetQuery.queryKey }),
  });
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger render={<Button small variant="danger" />}>
        Disconnect
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-black/30" />
        <AlertDialog.Popup className="panel fixed top-1/2 left-1/2 w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 p-5">
          <AlertDialog.Title className="text-[15px] font-semibold">
            Disconnect boat?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-[13px] text-ink-2">
            Runyard forgets the API key. boat jobs still show from GitHub's data, without costs.
            Revoke the key in boat if it's no longer needed.
          </AlertDialog.Description>
          {remove.error && <ErrorText className="mt-2" error={remove.error} />}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close render={<Button />}>Cancel</AlertDialog.Close>
            <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Disconnect
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
