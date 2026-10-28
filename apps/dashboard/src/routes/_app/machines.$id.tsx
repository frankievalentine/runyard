import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import type {
  DiagnosticGroup,
  FleetView,
  MachineView,
  OsFamily,
  SshTransport,
} from "@runyard/core";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { Button, TextField } from "../../components/form.tsx";
import { ActiveAlerts, EventList } from "../../components/machines.tsx";
import { MachineFields } from "../../components/MachineFields.tsx";
import {
  Callout,
  Card,
  EmptyLine,
  ErrorText,
  Meter,
  Pill,
  Section,
  Stat,
  StatStrip,
  StatusDot,
} from "../../components/ui.tsx";
import { fleetQuery, useFleet } from "../../lib/fleet.ts";
import {
  formatBytes,
  formatClock,
  formatPercent,
  formatUptime,
  timeAgo,
} from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { diagnosticTone, osLabel, type Tone } from "../../lib/status.ts";

export const Route = createFileRoute("/_app/machines/$id")({
  component: Machine,
});

function Machine() {
  const { id } = Route.useParams();
  const fleet = useFleet();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const m = fleet.machines.find((x) => x.id === id);
  if (!m) {
    return (
      <Card>
        <EmptyLine>
          This machine isn't in Runyard any more.{" "}
          <Link to="/" className="text-accent hover:underline">
            Back to the overview
          </Link>
        </EmptyLine>
      </Card>
    );
  }
  const admin = session.user?.role === "admin";
  return (
    <>
      <Header m={m} admin={admin} />
      {(m.connection.state === "error" || m.connection.state === "stale") && (
        <Callout
          tone={m.connection.state === "error" ? "bad" : "warn"}
          title="The last SSH check failed"
        >
          {m.connection.state === "error" ? m.connection.detail : m.connection.reason}
        </Callout>
      )}
      <div className="mt-6">
        <Glance m={m} />
      </div>
      <Health m={m} />
      <Monitoring m={m} admin={admin} />
      <Diagnostics m={m} />
      <Section title="History">
        <EventList machineId={m.id} />
      </Section>
    </>
  );
}

function Header({ m, admin }: { m: MachineView; admin: boolean }) {
  const queryClient = useQueryClient();
  const check = useMutation({
    mutationFn: async () =>
      (await call(api.machines[":id"].check.$post({ param: { id: m.id } }))) as FleetView,
    onSuccess: (view) => queryClient.setQueryData(fleetQuery.queryKey, view),
  });
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[20px] font-semibold tracking-tight">{m.name}</h1>
        {m.os && <Pill tone="muted">{osLabel[m.os]}</Pill>}
        <div className="ml-auto flex gap-2">
          <Button small onClick={() => check.mutate()} disabled={check.isPending}>
            {check.isPending ? "Checking…" : "Check now"}
          </Button>
          {admin && <EditMachine m={m} />}
          {admin && <RemoveMachine m={m} />}
        </div>
      </div>
      {m.description && <p className="mt-1 text-[13px] text-ink-2">{m.description}</p>}
      <p className="mt-1 text-[12px] text-ink-2">
        <span className="font-mono select-text">{m.sshTarget}</span> ·{" "}
        {m.transport === "tailscale" ? "Tailscale SSH" : "OpenSSH"}
      </p>
      {check.error && <ErrorText className="mt-2" error={check.error} />}
    </>
  );
}

type Fact = { tone: Tone; value: string; sub: string; hollow?: boolean };

/** Tailnet reachability, the last SSH read and uptime. Ported from fleet's MachineGlance. */
function Glance({ m }: { m: MachineView }) {
  const now = useNow();
  const t = m.tailnet;
  const tailnet: Fact = !t
    ? { tone: "muted", value: "Not on the tailnet", sub: "reached by SSH target", hollow: true }
    : t.online
      ? {
          tone: "ok",
          value: "Online",
          sub: t.tailscaleSsh ? "Tailscale SSH on" : "SSH over the tailnet",
        }
      : {
          tone: "muted",
          value: "Offline",
          sub: t.lastSeen ? `last seen ${timeAgo(t.lastSeen, now)}` : "not seen recently",
        };
  const c = m.connection;
  const ssh: Fact =
    c.state === "connected"
      ? { tone: "ok", value: "Connected", sub: `read ${timeAgo(c.checkedAt, now)}` }
      : c.state === "stale"
        ? {
            tone: "warn",
            value: "Stale",
            sub: `last read ${timeAgo(c.checkedAt, now)}`,
            hollow: true,
          }
        : c.state === "error"
          ? { tone: "bad", value: "Couldn't connect", sub: "see the error above" }
          : c.state === "offline"
            ? { tone: "muted", value: "Offline", sub: "machine is offline", hollow: true }
            : {
                tone: "muted",
                value: "Checking…",
                sub: "read automatically every minute",
                hollow: true,
              };
  const h = m.health;
  return (
    <StatStrip cols={3}>
      <Stat label="Tailnet" {...tailnet} />
      <Stat label="SSH" {...ssh} />
      <Stat
        label="Uptime"
        value={h?.uptimeSecs != null ? formatUptime(h.uptimeSecs) : "—"}
        sub={h?.osVersion ?? "operating system unknown"}
        stale={h?.stale}
      />
    </StatStrip>
  );
}

function Health({ m }: { m: MachineView }) {
  const h = m.health;
  if (!h) return null;
  const memoryUsed =
    h.memoryTotalBytes != null && h.memoryAvailableBytes != null
      ? h.memoryTotalBytes - h.memoryAvailableBytes
      : null;
  return (
    <Section title="Health">
      <StatStrip cols={3}>
        <Stat
          label="CPU"
          value={h.cpuPercent != null ? formatPercent(h.cpuPercent) : "—"}
          stale={h.stale}
          sub={h.logicalCores ? `${h.logicalCores} cores` : undefined}
        >
          {h.cpuPercent != null && <Meter fraction={h.cpuPercent / 100} stale={h.stale} />}
        </Stat>
        <Stat
          label="Memory"
          value={memoryUsed != null ? formatBytes(memoryUsed) : "—"}
          stale={h.stale}
          sub={h.memoryTotalBytes != null ? `of ${formatBytes(h.memoryTotalBytes)}` : undefined}
        >
          {memoryUsed != null && h.memoryTotalBytes ? (
            <Meter fraction={memoryUsed / h.memoryTotalBytes} stale={h.stale} />
          ) : null}
        </Stat>
        <Stat
          label="Load"
          value={h.loadAverage ? h.loadAverage[0].toFixed(2) : "—"}
          stale={h.stale}
          sub={
            h.loadAverage
              ? `${h.loadAverage[1].toFixed(2)} · ${h.loadAverage[2].toFixed(2)} (5 and 15 min)`
              : "not reported"
          }
        />
      </StatStrip>
      {h.disks.length > 0 && (
        <Card className="mt-3 divide-y divide-line">
          {h.disks.map((d) => (
            <div key={d.mountPoint} className={`px-4 py-3 ${h.stale ? "opacity-60" : ""}`}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="truncate font-mono">{d.mountPoint}</span>
                <span className="shrink-0 text-ink-2 tabular">
                  {formatBytes(d.availableBytes)} free of {formatBytes(d.totalBytes)}
                </span>
              </div>
              <Meter fraction={1 - d.availableBytes / d.totalBytes} stale={h.stale} />
            </div>
          ))}
        </Card>
      )}
      {h.warnings.map((w) => (
        <p key={w} className="mt-2 text-[12px] text-ink-2">
          {w}
        </p>
      ))}
    </Section>
  );
}

function Monitoring({ m, admin }: { m: MachineView; admin: boolean }) {
  const now = useNow();
  const queryClient = useQueryClient();
  const pausedUntil = m.maintenanceUntil && m.maintenanceUntil > now ? m.maintenanceUntil : null;
  const maintenance = useMutation({
    mutationFn: () =>
      call(
        api.machines[":id"].maintenance.$post({ param: { id: m.id }, json: { on: !pausedUntil } }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: fleetQuery.queryKey }),
  });
  return (
    <Section title="Monitoring">
      <Card className="flex flex-wrap items-start gap-3 px-4 py-3">
        <p className="min-w-0 flex-1 basis-[260px] text-[12px] text-ink-2">
          {pausedUntil
            ? `Alerts are paused until ${formatClock(pausedUntil)}. History continues.`
            : "Alerts after 3 minutes offline on the tailnet, or disk space confirmed below 10%."}
        </p>
        {admin && (
          <Button small disabled={maintenance.isPending} onClick={() => maintenance.mutate()}>
            {pausedUntil ? "End maintenance" : "Maintenance for 1 hour"}
          </Button>
        )}
        {maintenance.error && <ErrorText className="w-full" error={maintenance.error} />}
      </Card>
      {m.alerts.length > 0 && (
        <div className="mt-3">
          <ActiveAlerts alerts={m.alerts} />
        </div>
      )}
    </Section>
  );
}

const GROUPS: [DiagnosticGroup, string][] = [
  ["network", "Tailscale & access"],
  ["power", "Power & availability"],
  ["system", "System"],
];

/** Ported from fleet's MachineDiagnostics. */
function Diagnostics({ m }: { m: MachineView }) {
  const now = useNow();
  const d = m.diagnostics;
  return (
    <Section title="Diagnostics">
      <p className={`mb-3 text-[12px] ${d?.stale ? "text-warn" : "text-ink-2"}`}>
        {d
          ? `${d.stale ? "Last successful read" : "Checked"} ${timeAgo(d.asOf, now)}. ${d.stale ? "These findings may have changed. " : ""}Read-only, over SSH, every minute.`
          : "Diagnostics appear after a successful SSH check."}
      </p>
      {d && (
        <div className="grid grid-cols-1 items-start gap-3 min-[1100px]:grid-cols-2">
          {GROUPS.map(([group, title]) => {
            const checks = d.checks.filter((c) => c.group === group);
            if (!checks.length) return null;
            return (
              <Card key={group} className="min-w-0 overflow-hidden">
                <div className="border-b border-line bg-sunken/40 px-4 py-2.5 text-[12px] font-medium">
                  {title}
                </div>
                <dl className="divide-y divide-line">
                  {checks.map((c) => {
                    const status = diagnosticTone[c.status];
                    return (
                      <div key={c.id} className={`px-4 py-3 ${d.stale ? "opacity-60" : ""}`}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <dt className="flex min-w-0 items-center gap-2 text-[12px] text-ink-2">
                            <StatusDot
                              tone={d.stale ? "muted" : status.tone}
                              hollow={c.status === "unknown" || d.stale}
                            />
                            <span className="break-words">{c.title}</span>
                          </dt>
                          <dd className="max-w-full text-[12px] font-medium break-words">
                            {c.value}
                          </dd>
                        </div>
                        <dd className="mt-1.5 text-[11.5px] leading-relaxed break-words text-ink-2 select-text">
                          {c.detail}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </Card>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function EditMachine({ m }: { m: MachineView }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(m.name);
  const [description, setDescription] = useState(m.description);
  const [sshTarget, setSshTarget] = useState(m.sshTarget);
  const [transport, setTransport] = useState<SshTransport>(m.transport);
  const [expectedOs, setExpectedOs] = useState<OsFamily | null>(m.os);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      call(
        api.machines[":id"].$patch({
          param: { id: m.id },
          json: { name, description, sshTarget, transport, expectedOs },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: fleetQuery.queryKey });
      setOpen(false);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={<Button small />}>Edit</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/30" />
        <Dialog.Popup className="panel fixed top-1/2 left-1/2 max-h-[90vh] w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-5">
          <Dialog.Title className="text-[15px] font-semibold">Edit {m.name}</Dialog.Title>
          <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <MachineFields
              sshTarget={sshTarget}
              setSshTarget={setSshTarget}
              transport={transport}
              setTransport={setTransport}
              expectedOs={expectedOs}
              setExpectedOs={setExpectedOs}
            />
            {save.error && <ErrorText error={save.error} />}
            <div className="flex justify-end gap-2">
              <Dialog.Close render={<Button />}>Cancel</Dialog.Close>
              <Button type="submit" variant="primary" disabled={save.isPending}>
                Save
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RemoveMachine({ m }: { m: MachineView }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => call(api.machines[":id"].$delete({ param: { id: m.id } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: fleetQuery.queryKey });
      void navigate({ to: "/" });
    },
  });
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger render={<Button variant="danger" small />}>Remove</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-black/30" />
        <AlertDialog.Popup className="panel fixed top-1/2 left-1/2 w-[min(92vw,380px)] -translate-x-1/2 -translate-y-1/2 p-5">
          <AlertDialog.Title className="text-[15px] font-semibold">
            Remove {m.name}?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-[13px] text-ink-2">
            Runyard stops checking it and deletes its history. Nothing on the machine changes.
          </AlertDialog.Description>
          {remove.error && <ErrorText className="mt-2" error={remove.error} />}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close render={<Button />}>Cancel</AlertDialog.Close>
            <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Remove
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
