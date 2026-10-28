import { AlertDialog } from "@base-ui/react/alert-dialog";
import type {
  DiagnosticGroup,
  YardView,
  HealthView,
  MachineView,
  OsFamily,
  SshTransport,
} from "@runyard/core";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, call } from "../../api.ts";
import { AccessPanel } from "../../components/AccessPanel.tsx";
import { CopyValue } from "../../components/CopyValue.tsx";
import { Button, TextField } from "../../components/form.tsx";
import { Icon } from "../../components/icons.tsx";
import { MachineFields } from "../../components/MachineFields.tsx";
import { MachineChanges, MachineRunners } from "../../components/changes.tsx";
import { ActiveAlerts, EventTimeline } from "../../components/machines.tsx";
import {
  Callout,
  Card,
  EmptyLine,
  ErrorText,
  KeyValuePanel,
  Meter,
  PageHeader,
  Pill,
  Section,
  Stat,
  StatStrip,
  StatusDot,
  type KeyValueRow,
} from "../../components/ui.tsx";
import { yardQuery, useYard } from "../../lib/yard.ts";
import {
  formatBytes,
  formatClock,
  formatPercent,
  formatUptime,
  timeAgo,
} from "../../lib/format.ts";
import { diskUsedFraction, memoryUsedFraction, primaryDisk } from "../../lib/health.ts";
import { useNow } from "../../lib/now.ts";
import { sessionQuery } from "../../lib/queries.ts";
import {
  connectionStatus,
  diagnosticSummary,
  diagnosticTone,
  osLabel,
  osLine,
  type Tone,
} from "../../lib/status.ts";

export const Route = createFileRoute("/_app/machines/$id")({
  component: Machine,
});

/** aarondfrancis/fleet's MachineDetail; runners, changes and runner checks join it with runner management. */
function Machine() {
  const { id } = Route.useParams();
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const [editing, setEditing] = useState(false);
  const m = view.machines.find((x) => x.id === id);
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
  const status = connectionStatus(m.connection);
  const address = m.tailnet?.address ?? m.sshTarget;
  const os = osLine(m);

  return (
    <div>
      <PageHeader
        icon={<Icon name="machine" size={18} />}
        title={<CopyValue value={m.name} label="Machine name" showIcon={false} />}
        status={
          <>
            <Pill tone={status.tone} hollow={status.hollow}>
              {status.label}
            </Pill>
            {admin && !editing && (
              <Button
                small
                variant="ghost"
                aria-label={`Edit ${m.name}`}
                onClick={() => setEditing(true)}
              >
                Edit…
              </Button>
            )}
          </>
        }
        subtitle={
          <>
            <CopyValue value={address} label="Address" />
            {os && ` · ${os}`}
          </>
        }
        actions={admin && <RemoveMachine m={m} />}
      />
      {editing ? (
        <EditMachine m={m} close={() => setEditing(false)} />
      ) : (
        m.description && (
          <p className="mt-3 text-[12.5px] break-words whitespace-pre-wrap text-ink-2">
            {m.description}
          </p>
        )
      )}
      <div className="mt-8 space-y-3">
        <Glance m={m} />
        {m.health && <HealthMeters h={m.health} />}
      </div>
      {m.health === null && m.connection.state !== "connected" ? (
        <AccessPanel m={m} admin={admin} />
      ) : (
        <ConnectionNotice m={m} />
      )}
      <MachineRunners m={m} />
      <MachineChanges m={m} admin={admin} />
      <Monitoring m={m} admin={admin} />
      <Diagnostics m={m} />
      <Details m={m} />
      {m.health && m.health.warnings.length > 0 && (
        <Section title="SSH check notes" count={m.health.warnings.length}>
          <Card className="px-4 py-3 text-[12px] text-ink-2">
            {m.health.warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </Card>
        </Section>
      )}
      <EventTimeline machineId={m.id} />
    </div>
  );
}

type Fact = { tone: Tone; value: string; sub: ReactNode; hollow?: boolean };

/** Tailnet reachability, the last SSH read, and diagnostics. Ported from aarondfrancis/fleet's MachineGlance. */
function Glance({ m }: { m: MachineView }) {
  const now = useNow();
  const t = m.tailnet;
  const tailnet: Fact = !t
    ? {
        tone: "muted",
        value: "Not on the tailnet",
        sub: <CopyValue value={m.sshTarget} label="SSH target" truncate />,
        hollow: true,
      }
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
          ? {
              tone: "bad",
              value: "Couldn't connect",
              sub: <CopyValue value={c.detail} label="SSH error" truncate />,
            }
          : c.state === "offline"
            ? { tone: "muted", value: "Offline", sub: "machine is offline", hollow: true }
            : {
                tone: "muted",
                value: "Checking…",
                sub: "read automatically every minute",
                hollow: true,
              };
  const warnings =
    m.diagnostics && !m.diagnostics.stale
      ? m.diagnostics.checks.filter((x) => x.status === "warn").length
      : 0;
  const diagnostics: Fact = !m.diagnostics
    ? { tone: "muted", value: "Not checked", sub: "after the first SSH read", hollow: true }
    : m.diagnostics.stale
      ? {
          tone: "muted",
          value: "Stale",
          sub: `read ${timeAgo(m.diagnostics.asOf, now)}`,
          hollow: true,
        }
      : warnings
        ? { tone: "warn", value: diagnosticSummary(m), sub: "see Diagnostics below" }
        : { tone: "ok", value: "No warnings", sub: `read ${timeAgo(m.diagnostics.asOf, now)}` };
  return (
    <StatStrip cols={3}>
      <Stat label="Tailnet" {...tailnet} />
      <Stat label="SSH" {...ssh} />
      <Stat label="Diagnostics" {...diagnostics} />
    </StatStrip>
  );
}

/** Ported from aarondfrancis/fleet's HealthMeters. */
function HealthMeters({ h }: { h: HealthView }) {
  const now = useNow();
  const memory = memoryUsedFraction(h);
  const disk = primaryDisk(h);
  const asOf = h.stale && (
    <span className="shrink-0 text-[11px] text-warn">as of {timeAgo(h.asOf, now)}</span>
  );
  return (
    <StatStrip cols={3}>
      <Stat
        label="CPU"
        aside={asOf}
        stale={h.stale}
        value={h.cpuPercent == null ? "—" : formatPercent(h.cpuPercent)}
        sub={
          h.loadAverage
            ? `load ${h.loadAverage.map((l) => l.toFixed(1)).join(" ")}`
            : h.logicalCores == null
              ? "unavailable"
              : `${h.logicalCores} cores`
        }
      >
        <MeterSlot fraction={h.cpuPercent == null ? null : h.cpuPercent / 100} stale={h.stale} />
      </Stat>
      <Stat
        label="Memory"
        aside={asOf}
        stale={h.stale}
        value={memory == null ? "—" : formatPercent(memory * 100)}
        sub={`${formatBytes(h.memoryAvailableBytes)} free of ${formatBytes(h.memoryTotalBytes)}`}
      >
        <MeterSlot fraction={memory} stale={h.stale} />
      </Stat>
      <Stat
        label="Disk free"
        aside={asOf}
        stale={h.stale}
        value={disk ? formatBytes(disk.availableBytes) : "—"}
        sub={
          disk
            ? `of ${formatBytes(disk.totalBytes)}${h.disks.length > 1 ? ` · ${h.disks.length} disks` : ""}`
            : "not reported"
        }
      >
        <MeterSlot fraction={diskUsedFraction(disk)} stale={h.stale} />
      </Stat>
    </StatStrip>
  );
}

/** Keeps the cards aligned when one has no reading. */
function MeterSlot({ fraction, stale }: { fraction: number | null; stale: boolean }) {
  return fraction == null ? <div className="h-1" /> : <Meter fraction={fraction} stale={stale} />;
}

/** Ported from aarondfrancis/fleet. */
function ConnectionNotice({ m }: { m: MachineView }) {
  const now = useNow();
  const c = m.connection;
  switch (c.state) {
    case "stale":
      return (
        <Callout tone="warn" title={`Showing the last SSH read, from ${timeAgo(c.checkedAt, now)}`}>
          {c.reason} Health above is not current.
        </Callout>
      );
    case "offline":
      return (
        <Callout tone="warn" title="Offline on the tailnet">
          {c.lastSeen ? `Last seen ${timeAgo(c.lastSeen, now)}.` : "Not seen recently."} Health
          shows the last read.
        </Callout>
      );
    case "error":
      return (
        <Callout tone="bad" title="Couldn't read this machine over SSH">
          {c.detail}
        </Callout>
      );
    default:
      return null;
  }
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });
  return (
    <Section title="Monitoring">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 basis-[260px]">
            <p className="text-[12px] text-ink-2">
              {pausedUntil
                ? `Alerts are paused until ${formatClock(pausedUntil)}. History continues.`
                : "Alerts after 3 minutes offline or confirmed disk space below 10%. Maintenance pauses alerts for an hour."}
            </p>
            {maintenance.isError && <ErrorText error={maintenance.error} className="mt-2" />}
          </div>
          {admin && (
            <Button small disabled={maintenance.isPending} onClick={() => maintenance.mutate()}>
              {maintenance.isPending
                ? "Saving…"
                : pausedUntil
                  ? "End maintenance"
                  : "Maintenance for 1 hour"}
            </Button>
          )}
        </div>
        {m.alerts.length > 0 ? (
          <div className="border-t border-line">
            <ActiveAlerts alerts={m.alerts} />
          </div>
        ) : (
          <div className="border-t border-line">
            <EmptyLine>No active alerts.</EmptyLine>
          </div>
        )}
      </Card>
    </Section>
  );
}

const GROUPS: [DiagnosticGroup, string][] = [
  ["network", "Tailscale & access"],
  ["power", "Power & availability"],
  ["system", "System"],
];

/** Ported from aarondfrancis/fleet's MachineDiagnostics. */
function Diagnostics({ m }: { m: MachineView }) {
  const now = useNow();
  const d = m.diagnostics;
  return (
    <Section
      title="Machine diagnostics"
      action={<span className="text-[12px] text-ink-2">{diagnosticSummary(m)}</span>}
    >
      <p className={`mb-3 text-[12px] ${d?.stale ? "text-warn" : "text-ink-2"}`}>
        {d
          ? `${d.stale ? "Last successful read" : "Checked"} ${timeAgo(d.asOf, now)}. ${d.stale ? "These findings may have changed. " : ""}Read automatically over SSH; Check now refreshes them.`
          : "Diagnostics will appear after a successful SSH check."}
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
                        <dd className="mt-1.5 text-[11.5px] leading-relaxed break-words text-ink-2">
                          {c.status === "warn" && !d.stale && (
                            <span className="mr-2">
                              <Pill tone="warn">Warning</Pill>
                            </span>
                          )}
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

/** How Runyard reaches the machine, and what the tailnet knows about it. Ported from aarondfrancis/fleet's MachineFacts. */
function Details({ m }: { m: MachineView }) {
  const now = useNow();
  const t = m.tailnet;
  const connection: KeyValueRow[] = [
    ["SSH target", <span className="font-mono">{m.sshTarget}</span>, m.sshTarget],
    ["Connect with", m.transport === "tailscale" ? "Tailscale SSH" : "OpenSSH"],
    ["Operating system", m.os ? osLabel[m.os] : "Detect"],
  ];
  if (m.health?.uptimeSecs != null) connection.push(["Uptime", formatUptime(m.health.uptimeSecs)]);
  const disks = m.health?.disks ?? [];
  const tailnet: KeyValueRow[] = [
    [
      "Status",
      t
        ? t.online
          ? "Online"
          : `Offline${t.lastSeen ? `, last seen ${timeAgo(t.lastSeen, now)}` : ""}`
        : "Not found",
    ],
  ];
  if (t) {
    tailnet.push(
      ["Hostname", t.name, t.name],
      ["MagicDNS", t.address, t.address],
      [
        "Addresses",
        t.ips.length ? (
          <span className="flex flex-col items-start gap-1">
            {t.ips.map((ip) => (
              <CopyValue key={ip} value={ip} label="IP address" truncate />
            ))}
          </span>
        ) : (
          "—"
        ),
      ],
      [
        "Tailscale SSH",
        m.diagnostics?.checks.find((c) => c.id === "tailscale-ssh")?.value ??
          (t.tailscaleSsh ? "Advertised" : "Not advertised"),
      ],
    );
    if (t.tags.length) tailnet.push(["Tags", t.tags.join(", "), t.tags.join(", ")]);
  }
  return (
    <Section title="Details">
      <div className="grid grid-cols-1 gap-3 min-[1100px]:grid-cols-2">
        <KeyValuePanel title="Connection" rows={connection} />
        <KeyValuePanel title="Tailnet" rows={tailnet} />
      </div>
      {disks.length > 1 && (
        <Card className="mt-3 divide-y divide-line">
          {disks.map((d) => (
            <div key={d.mountPoint} className={`px-4 py-3 ${m.health?.stale ? "opacity-60" : ""}`}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="truncate font-mono">{d.mountPoint}</span>
                <span className="shrink-0 text-ink-2 tabular">
                  {formatBytes(d.availableBytes)} free of {formatBytes(d.totalBytes)}
                </span>
              </div>
              <Meter fraction={1 - d.availableBytes / d.totalBytes} stale={m.health?.stale} />
            </div>
          ))}
        </Card>
      )}
    </Section>
  );
}

/** aarondfrancis/fleet edits in place below the header. */
function EditMachine({ m, close }: { m: MachineView; close: () => void }) {
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
      await queryClient.invalidateQueries({ queryKey: yardQuery.queryKey });
      close();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Card className="mt-4 max-w-xl px-4 py-4">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
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
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            Save
          </Button>
          <Button onClick={close}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function RemoveMachine({ m }: { m: MachineView }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => call(api.machines[":id"].$delete({ param: { id: m.id } })),
    onSuccess: async () => {
      queryClient.setQueryData<YardView>(
        yardQuery.queryKey,
        (v) => v && { ...v, machines: v.machines.filter((x) => x.id !== m.id) },
      );
      await queryClient.invalidateQueries({ queryKey: yardQuery.queryKey });
      void navigate({ to: "/" });
    },
  });
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger render={<Button small variant="danger" />}>Remove</AlertDialog.Trigger>
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
