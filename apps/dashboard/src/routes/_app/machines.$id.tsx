import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Jobs } from "../../components/Jobs.tsx";
import type {
  DiagnosticGroup,
  HealthView,
  MachineView,
  OsFamily,
  SshTransport,
} from "@runyard/core";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { api, ApiError, call } from "../../api.ts";
import { RunnerReadiness } from "../../components/Readiness.tsx";
import { AccessPanel } from "../../components/AccessPanel.tsx";
import { CommandBox, CopyValue } from "../../components/CopyValue.tsx";
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
  GroupedCard,
  KeyValueLine,
  Meter,
  PageHeader,
  Pill,
  Section,
  Stat,
  StatStrip,
  StatusDot,
  type KeyValueRow,
  Separated,
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
  /** `review`: one prepared elsewhere (an agent's, through the MCP server), to open for running. */
  validateSearch: (search: Record<string, unknown>): { review?: string } =>
    typeof search.review === "string" ? { review: search.review } : {},
  component: KeyedMachine,
});

/** Each id gets the page fresh: moving between them never carries one's state to the next. */
function KeyedMachine() {
  return <Machine key={Route.useParams().id} />;
}

/** aarondfrancis/fleet's MachineDetail; runners, changes and runner checks join it with runner management. */
function Machine() {
  const { id } = Route.useParams();
  const { review: reviewId } = Route.useSearch();
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const [editing, setEditing] = useState(false);
  const m = view.machines.find((x) => x.id === id);
  const removed = useSyncExternalStore(removedMachines.subscribe, () => removedMachines.get(id));
  if (!m) {
    if (removed) return <Removed removed={removed} />;
    return (
      <Card>
        <EmptyLine>
          This machine isn't in Runyard anymore.{" "}
          <Link to="/" className="text-accent hover:underline">
            Go to overview
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
          <Pill tone={status.tone} hollow={status.hollow}>
            {status.label}
          </Pill>
        }
        subtitle={
          <Separated>
            {/* No icon: its reserved space made the gap before the dot wider than after. */}
            {[<CopyValue key="address" value={address} label="Address" showIcon={false} />, os]}
          </Separated>
        }
        actions={
          admin && (
            <div className="flex items-center gap-2">
              {!editing && (
                <Button small aria-label={`Edit ${m.name}`} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              <RemoveMachine m={m} />
            </div>
          )
        }
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
      <MachineChanges key={reviewId} m={m} admin={admin} reviewId={reviewId} />
      <Jobs filter={{ machine: m.id }} />
      <Monitoring m={m} admin={admin} />
      <RunnerReadiness m={m} />
      <Diagnostics m={m} />
      <Details m={m} />
      {m.health && m.health.warnings.length > 0 && (
        <Section title="SSH warnings" count={m.health.warnings.length}>
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
        value: "Not on tailnet",
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
      ? { tone: "ok", value: "Connected", sub: `checked ${timeAgo(c.checkedAt, now)}` }
      : c.state === "stale"
        ? {
            tone: "warn",
            value: "Stale",
            sub: `last checked ${timeAgo(c.checkedAt, now)}`,
            hollow: true,
          }
        : c.state === "error"
          ? {
              tone: "bad",
              value: "SSH failed",
              sub: (
                <CopyValue value={c.detail} label="SSH error" truncate>
                  {c.detail.split("\n")[0]}
                </CopyValue>
              ),
            }
          : c.state === "offline"
            ? { tone: "muted", value: "Offline", sub: "machine is offline", hollow: true }
            : {
                tone: "muted",
                value: "Checking…",
                sub: "checked every minute",
                hollow: true,
              };
  const warnings =
    m.diagnostics && !m.diagnostics.stale
      ? m.diagnostics.checks.filter((x) => x.status === "warn").length
      : 0;
  const diagnostics: Fact = !m.diagnostics
    ? { tone: "muted", value: "Not checked", sub: "after the first SSH check", hollow: true }
    : m.diagnostics.stale
      ? {
          tone: "muted",
          value: "Stale",
          sub: `checked ${timeAgo(m.diagnostics.asOf, now)}`,
          hollow: true,
        }
      : warnings
        ? { tone: "warn", value: diagnosticSummary(m), sub: "details below" }
        : { tone: "ok", value: "No warnings", sub: `checked ${timeAgo(m.diagnostics.asOf, now)}` };

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
        <Callout tone="warn" title={`Last checked ${timeAgo(c.checkedAt, now)}`}>
          {c.reason} Health above is out of date.
        </Callout>
      );
    case "offline":
      return (
        <Callout tone="warn" title="Offline on the tailnet">
          {c.lastSeen ? `Last seen ${timeAgo(c.lastSeen, now)}.` : "Not seen recently."} Health is
          from the last check.
        </Callout>
      );
    case "error":
      return (
        <Callout tone="bad" title="SSH failed">
          <SshDetail detail={c.detail} />
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
                : "Alerts when offline for 3 minutes or under 10% disk free."}
            </p>
            {maintenance.isError && <ErrorText error={maintenance.error} className="mt-2" />}
          </div>
          {admin && (
            <Button small disabled={maintenance.isPending} onClick={() => maintenance.mutate()}>
              {maintenance.isPending
                ? "Saving…"
                : pausedUntil
                  ? "End maintenance"
                  : "Pause alerts for 1 hour"}
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
  ["network", "Tailscale and access"],
  ["power", "Power and availability"],
  ["system", "System"],
];

/** Ported from aarondfrancis/fleet's MachineDiagnostics. */
function Diagnostics({ m }: { m: MachineView }) {
  const now = useNow();
  const d = m.diagnostics;
  return (
    <Section
      title="Diagnostics"
      action={<span className="text-[12px] text-ink-2">{diagnosticSummary(m)}</span>}
    >
      <p className={`mb-3 text-[12px] ${d?.stale ? "text-warn" : "text-ink-2"}`}>
        {d
          ? `${d.stale ? "Last checked" : "Checked"} ${timeAgo(d.asOf, now)}.${d.stale ? " May be out of date." : ""}`
          : "Appears after the first SSH check."}
      </p>
      {d && (
        <GroupedCard
          groups={GROUPS.map(([group, title]) => ({
            key: group,
            title,
            rows: d.checks
              .filter((c) => c.group === group)
              .map((c) => [
                c.id,
                <dl className={`h-full px-4 py-3 ${d.stale ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="flex min-w-0 items-center gap-2 text-[12px] text-ink-2">
                      {/* Plain facts (the account, the architecture, the disk) are just listed. */}
                      {c.status !== "info" && c.id !== "disk-space" && (
                        <StatusDot
                          tone={d.stale ? "muted" : diagnosticTone[c.status].tone}
                          hollow={c.status === "unknown" || d.stale}
                        />
                      )}
                      <span className="break-words">{c.title}</span>
                    </dt>
                    <dd className="min-w-0 text-right text-[12px] font-medium break-words">
                      {c.value}
                    </dd>
                  </div>
                  {(c.detail || (c.status === "warn" && !d.stale)) && (
                    <dd className="mt-1.5 max-w-[60ch] text-[11.5px] leading-relaxed break-words text-ink-2">
                      {c.status === "warn" && !d.stale && (
                        <span className="mr-2">
                          <Pill tone="warn">Warning</Pill>
                        </span>
                      )}
                      {c.detail}
                    </dd>
                  )}
                  {c.command && c.status !== "pass" && !d.stale && (
                    <dd>
                      <CommandBox command={c.command} className="mt-1.5 w-fit max-w-full" />
                    </dd>
                  )}
                </dl>,
              ]),
          }))}
        />
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
        : "Not on tailnet",
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
      <GroupedCard
        groups={[
          { key: "connection", title: "Connection", rows: connection },
          { key: "tailnet", title: "Tailnet", rows: tailnet },
        ].map((g) => ({
          ...g,
          rows: g.rows.map((row) => [row[0], <KeyValueLine row={row} />] as [string, ReactNode]),
        }))}
      />
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
  const [runyardKeyOnly, setRunyardKeyOnly] = useState(m.runyardKeyOnly);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      call(
        api.machines[":id"].$patch({
          param: { id: m.id },
          json: { name, description, sshTarget, transport, expectedOs, runyardKeyOnly },
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
          runyardKeyOnly={runyardKeyOnly}
          setRunyardKeyOnly={setRunyardKeyOnly}
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

type RemoveStep = "pools" | "runners" | "cleanUp" | "remove";
type Operation = { status: "running" | "succeeded" | "failed"; error: string | null };

/**
 * Removing a machine, from one confirmation: takes it out of its pools, runs the
 * review that removes its runners, cleans it up over SSH, then forgets it. Each
 * step is skipped once done, so trying again picks up where it stopped.
 */
function RemoveMachine({ m }: { m: MachineView }) {
  const view = useYard();
  const queryClient = useQueryClient();
  // What Runyard still has there, removed before the machine.
  const runners = view.pools.registrations.filter((r) => r.machineId === m.id);
  const left = [
    ...runners.map((r) => r.runnerName),
    ...view.pools.templateRecords
      .filter((t) => t.machineId === m.id)
      .map((t) => `${t.poolName} runner software`),
  ];
  const software = left.length - runners.length;
  const leftSummary = [
    runners.length && `${runners.length} runner${runners.length === 1 ? "" : "s"}`,
    software && "runner software",
  ]
    .filter(Boolean)
    .join(" and ");
  const pools = view.pools.pools.filter((p) => p.machines.some((x) => x.machineId === m.id));
  const connected = m.connection.state === "connected";
  const [open, setOpen] = useState(false);
  const [cleanUp, setCleanUp] = useState(connected);
  const [sudo, setSudo] = useState("");
  const [step, setStep] = useState<RemoveStep | null>(null);
  // The second look: what's about to happen, before anything does.
  const [confirming, setConfirming] = useState(false);
  // The steps as they stood at the click: the live view drops each as it's done.
  const [plan, setPlan] = useState<{ key: RemoveStep; label: string }[]>([]);
  // A one-job runner mid-job can't be removed; the machine waits for it.
  const busy = view.pools.dispatches
    .filter((d) => d.machineId === m.id && (d.state === "starting" || d.state === "running"))
    .map((d) => d.runnerName);
  const remove = useMutation({
    mutationFn: async (withCleanUp: boolean) => {
      if (pools.length) {
        setStep("pools");
        await call(api.machines[":id"].decommission.$post({ param: { id: m.id } }));
      }
      if (left.length) {
        setStep("runners");
        const review = (await call(
          api.machines[":id"].review.$post({ param: { id: m.id } }),
        )) as unknown as { id: string; items: unknown[] };
        if (review.items.length) {
          const started = (await call(
            api.reviews[":id"].execute.$post({
              param: { id: review.id },
              json: sudo ? { sudoPassword: sudo } : {},
            }),
          )) as unknown as { id: string };
          let op: Operation;
          do {
            await new Promise((r) => setTimeout(r, 1000));
            op = (await call(
              api.operations[":id"].$get({ param: { id: started.id } }),
            )) as unknown as Operation;
          } while (op.status === "running");
          if (op.status === "failed")
            throw new Error(`Runyard couldn't remove its runners: ${op.error ?? "a step failed"}`);
        }
        await queryClient.invalidateQueries({ queryKey: yardQuery.queryKey });
      }
      setStep(withCleanUp ? "cleanUp" : "remove");
      const res = await call(
        api.machines[":id"].$delete({
          param: { id: m.id },
          query: withCleanUp ? { cleanUp: "1" } : {},
        }),
      );
      // Recorded here rather than in onSuccess: the live view drops the machine, and this dialog
      // with it, as soon as the server removes it. The page then shows what happened.
      removedMachines.set(m.id, {
        name: m.name,
        os: m.os,
        cleanedUp: res.cleanedUp !== null,
        prepared: m.os === "linux" && m.sshTarget.startsWith("runyard@"),
      });
    },
    onSettled: () => setSudo(""),
  });
  const cleanUpFailed = remove.error instanceof ApiError && remove.error.code === "cleanUp";
  // Removing runners needs the machine; without it they'd stay registered.
  const blocked = (left.length > 0 && !connected) || busy.length > 0;
  const steps: { key: RemoveStep; label: string }[] = [
    ...(pools.length
      ? [{ key: "pools" as const, label: `Take it out of ${pools.map((p) => p.name).join(", ")}` }]
      : []),
    ...(left.length
      ? [
          {
            key: "runners" as const,
            label: left.length === 1 ? `Remove ${left[0]}` : `Remove ${leftSummary}`,
          },
        ]
      : []),
    ...(cleanUp && connected
      ? [{ key: "cleanUp" as const, label: "Delete Runyard's runner folder and key there" }]
      : []),
    { key: "remove", label: "Remove it from Runyard" },
  ];
  const at = step ? plan.findIndex((s) => s.key === step) : -1;
  const start = (withCleanUp: boolean) => {
    setConfirming(false);
    setPlan(steps.filter((s) => s.key !== "cleanUp" || withCleanUp));
    remove.mutate(withCleanUp);
  };
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !remove.isPending) {
          remove.reset();
          setConfirming(false);
          setStep(null);
          setCleanUp(connected);
        }
      }}
    >
      <AlertDialog.Trigger render={<Button small variant="danger" />}>Remove</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-black/30" />
        <AlertDialog.Popup className="panel fixed top-1/2 left-1/2 w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 p-5">
          <AlertDialog.Title className="text-[15px] font-semibold">
            {plan.length && (remove.isPending || remove.error)
              ? `Removing ${m.name}`
              : confirming
                ? `Are you sure you want to remove ${m.name}?`
                : `Remove ${m.name}`}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-[13px] text-ink-2">
            {plan.length && (remove.isPending || remove.error)
              ? remove.error
                ? "It stopped here. Nothing after this step ran."
                : plan.some((s) => s.key === "runners")
                  ? "This can take a minute while each runner is removed."
                  : "This takes a few seconds."
              : confirming
                ? "Runyard does these in order. It can't be undone."
                : left.length
                  ? `Runyard removes ${left.length === 1 ? "its runner" : "what it has there"} first, then deletes the machine's history and stops checking it.`
                  : "Runyard deletes its history and stops checking it."}
          </AlertDialog.Description>
          {left.length > 0 && !confirming && !remove.isPending && !remove.error && (
            <ul className="mt-2 flex flex-col gap-1 rounded-md border border-line bg-bg px-3 py-2 font-mono text-[12px]">
              {left.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
          {blocked && (
            <p className="mt-3 text-[12.5px] text-ink-2">
              {busy.length
                ? `${busy.join(", ")} ${busy.length === 1 ? "is" : "are"} running a job. Remove the machine once ${busy.length === 1 ? "it finishes" : "they finish"}.`
                : `${m.name} isn't connected, so Runyard can't remove ${left.length === 1 ? "its runner" : "them"}. Connect it, then remove it again.`}
            </p>
          )}
          {(confirming || remove.isPending || remove.error) && (
            <ol className="mt-3 flex flex-col gap-1.5 text-[12.5px]">
              {(confirming ? steps.filter((s) => s.key !== "cleanUp" || cleanUp) : plan).map(
                (s, i) => (
                  <li key={s.key} className="flex items-center gap-2">
                    <StatusDot
                      tone={i < at ? "ok" : i === at ? (remove.error ? "bad" : "busy") : "muted"}
                      hollow={i > at}
                    />
                    <span className={i > at && !confirming ? "text-ink-3" : undefined}>
                      {s.label}
                    </span>
                  </li>
                ),
              )}
            </ol>
          )}
          {!blocked && !left.length && !connected && !confirming && !remove.error && (
            <div className="mt-3 rounded-md border border-line bg-bg px-3 py-2.5 text-[12.5px]">
              <span className="font-medium">{m.name} won't be cleaned up</span>
              <p className="mt-0.5 text-[12px] text-ink-2">
                It isn't connected, so its runner folder and Runyard's key stay there.
              </p>
              <TeardownCommands os={m.os} />
            </div>
          )}
          {!blocked && connected && !confirming && !remove.isPending && !remove.error && (
            <label className="mt-3 flex items-start gap-2 text-[12.5px]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={cleanUp}
                onChange={(e) => setCleanUp(e.target.checked)}
              />
              <span>
                <span className="font-medium">Also clean up {m.name}</span>
                <span className="block text-[12px] text-ink-2">
                  Deletes Runyard's runner folder there, then Runyard's key, over SSH. Tools pools
                  installed stay.
                </span>
              </span>
            </label>
          )}
          {!blocked &&
            runners.length > 0 &&
            m.os === "linux" &&
            !confirming &&
            !remove.isPending && (
              <div className="mt-3">
                <TextField
                  label="Sudo password (if needed)"
                  type="password"
                  autoComplete="off"
                  value={sudo}
                  onChange={(e) => setSudo(e.target.value)}
                  description="Removing runner services needs root. Used once, never stored."
                />
              </div>
            )}
          {connected && !cleanUp && !confirming && !remove.error && <TeardownCommands os={m.os} />}
          {cleanUpFailed ? (
            <>
              <ErrorText
                className="mt-3"
                error={`Runyard couldn't clean up ${m.name}: ${remove.error?.message}`}
              />
              <TeardownCommands os={m.os} />
            </>
          ) : (
            remove.error && <ErrorText className="mt-3" error={remove.error} />
          )}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close render={<Button />}>Cancel</AlertDialog.Close>
            {cleanUpFailed ? (
              <>
                <Button onClick={() => start(true)}>Try again</Button>
                <Button variant="danger" onClick={() => start(false)}>
                  Remove without cleaning up
                </Button>
              </>
            ) : confirming ? (
              <>
                <Button onClick={() => setConfirming(false)}>Back</Button>
                <Button variant="danger" onClick={() => start(cleanUp && connected)}>
                  Yes, remove {m.name}
                </Button>
              </>
            ) : (
              <Button
                variant="danger"
                onClick={() => (remove.error ? start(cleanUp && connected) : setConfirming(true))}
                disabled={blocked || remove.isPending}
              >
                {remove.isPending ? "Removing…" : remove.error ? "Try again" : "Remove machine"}
              </Button>
            )}
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

type RemovedMachine = { name: string; os: OsFamily | null; cleanedUp: boolean; prepared: boolean };

/**
 * Machines removed in this tab, so the machine's page can say what the removal did. A store
 * the page subscribes to: the live view may drop the machine before the removal's answer lands.
 */
const removedMachines = (() => {
  const entries = new Map<string, RemovedMachine>();
  const listeners = new Set<() => void>();
  return {
    get: (id: string) => entries.get(id),
    set: (id: string, removed: RemovedMachine) => {
      entries.set(id, removed);
      for (const l of listeners) l();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();

/** Where a removed machine's page lands: what Runyard did there, and what's left to do by hand. */
function Removed({ removed }: { removed: RemovedMachine }) {
  return (
    <Card className="max-w-xl px-4 py-4">
      <h2 className="text-[15px] font-semibold">Removed {removed.name}</h2>
      <p className="mt-1.5 text-[13px] text-ink-2">
        {removed.cleanedUp
          ? removed.prepared
            ? "Runyard deleted its runner folder there and removed its key. The runyard account it signed in as is still there."
            : "Runyard deleted its runner folder there and removed its key. Nothing of Runyard's is left on it."
          : "Runyard stopped checking it. Nothing on the machine changed."}
      </p>
      {removed.cleanedUp ? (
        removed.prepared && <AccountCommand />
      ) : (
        <TeardownCommands os={removed.os} />
      )}
      <Link to="/" className="mt-4 inline-block text-[13px] text-accent hover:underline">
        Go to overview
      </Link>
    </Card>
  );
}

/** After a cleanup on a machine set up with --prepare: the root command that deletes the runyard account. */
function AccountCommand() {
  const origin = window.location.origin;
  const command = origin.startsWith("https://")
    ? `curl -fsSL ${origin}/api/machine-setup/teardown.sh | sudo sh -s -- --prepared`
    : "sudo loginctl disable-linger runyard; sudo pkill -u runyard; sudo userdel -r runyard && sudo rm -f /etc/sudoers.d/runyard";
  return (
    <div className="mt-3 flex flex-col gap-1 text-[12px]">
      <span className="font-medium">To delete the runyard account too, run on the machine:</span>
      <div className="rounded-md border border-line bg-bg px-2 py-1.5">
        <CopyValue
          value={command}
          label="Account removal command"
          className="font-mono text-[11.5px] break-all"
        />
      </div>
    </div>
  );
}

/**
 * The commands that remove what Runyard's setup left on a machine: its key,
 * ~/runyard-runners, and with --prepared the runyard account. For a machine
 * Runyard can't reach or didn't clean up itself. Served over HTTPS only.
 */
function TeardownCommands({ os }: { os: OsFamily | null }) {
  const origin = window.location.origin;
  if (!origin.startsWith("https://"))
    return (
      <p className="mt-3 text-[12px] text-ink-2">
        Open the dashboard over HTTPS to get the cleanup command.
      </p>
    );
  const commands =
    os === "windows"
      ? [["As the account Runyard used", `irm ${origin}/api/machine-setup/teardown.ps1 | iex`]]
      : [
          [
            "As the account Runyard used",
            `curl -fsSL ${origin}/api/machine-setup/teardown.sh | sh`,
          ],
          ...(os !== "macos"
            ? [
                [
                  "Fresh-machine setup, as root (also removes the runyard account)",
                  `curl -fsSL ${origin}/api/machine-setup/teardown.sh | sudo sh -s -- --prepared`,
                ],
              ]
            : []),
        ];
  return (
    <div className="mt-3 flex flex-col gap-2 text-[12px]">
      <span className="font-medium">To clean up, run on the machine:</span>

      {commands.map(([label, text]) => (
        <div key={label} className="flex flex-col gap-1">
          <span className="text-ink-2">{label}</span>
          <div className="rounded-md border border-line bg-bg px-2 py-1.5">
            <CopyValue
              value={text!}
              label="Teardown command"
              className="font-mono text-[11.5px] break-all"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Runyard's summary of an SSH failure, then ssh's own words in small type to copy. */
function SshDetail({ detail }: { detail: string }) {
  const [summary, ...raw] = detail.split("\n");
  return (
    <>
      {summary}
      {raw.length > 0 && (
        <CopyValue
          value={raw.join("\n")}
          label="ssh output"
          className="mt-1.5 block font-mono text-[11.5px] break-all text-ink-2"
        />
      )}
    </>
  );
}
