import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Jobs } from "../../components/Jobs.tsx";
import { readinessProblems } from "@runyard/core";
import type { DiagnosticGroup, MachineView, OsFamily, SshTransport } from "@runyard/core";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { api, ApiError, call } from "../../api.ts";
import { readinessNote, RunnerReadiness } from "../../components/Readiness.tsx";
import { AccessPanel } from "../../components/AccessPanel.tsx";
import { CopyValue } from "../../components/CopyValue.tsx";
import { Icon } from "../../components/icons.tsx";
import { MachineFields } from "../../components/MachineFields.tsx";
import { MachineChanges, MachineRunners } from "../../components/changes.tsx";
import { EventTimeline } from "../../components/machines.tsx";
import {
  CodeBlock,
  Det,
  Dot,
  Field,
  InlineCode,
  Input,
  Kv,
  Kvh,
  NoticeBar,
  noticeButton,
  Stat,
  Stats,
  TtError,
  WarnIcon,
  type DotTone,
} from "../../components/machine/parts.tsx";
import { Chip, Panel, Row, Sign, TtButton, ttButton, type ChipTone } from "../../components/tt.tsx";
import { yardQuery, useYard } from "../../lib/yard.ts";
import {
  formatBytes,
  formatClock,
  formatPercent,
  formatUptime,
  timeAgo,
} from "../../lib/format.ts";
import { memoryUsedFraction, primaryDisk } from "../../lib/health.ts";
import { useNow } from "../../lib/now.ts";
import { sessionQuery, sshKeyQuery } from "../../lib/queries.ts";
import { diagnosticSummary, diagnosticTone, osLabel, osLine, type Tone } from "../../lib/status.ts";

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

const dotOf: Record<Tone, DotTone> = {
  ok: "ok",
  warn: "warn",
  bad: "bad",
  busy: "warn",
  muted: "unknown",
  info: "unknown",
};

/**
 * aarondfrancis/fleet's MachineDetail, laid out as Timetable's machine page: the head with its
 * platform sign, a notice when something needs a look, six readings, then the panels in two
 * columns (one on a phone). Readiness, diagnostics, connection and history fold under Details.
 */
function Machine() {
  const { id } = Route.useParams();
  const { review: reviewId } = Route.useSearch();
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const [editing, setEditing] = useState(false);
  const [startReview, setStartReview] = useState(0);
  const problems = (() => {
    const found = view.machines.find((x) => x.id === id);
    return found ? readinessProblems(found.readiness).length : 0;
  })();
  // Readiness opens by itself when the machine isn't ready for its pools' jobs.
  const [readinessOpen, setReadinessOpen] = useState(problems > 0);
  const removed = useSyncExternalStore(removedMachines.subscribe, () => removedMachines.get(id));
  // The live view drops the machine as soon as the server forgets it. While the remove dialog
  // is still showing its last step finish, the page keeps the machine as it last saw it.
  const last = useRef<MachineView | undefined>(undefined);
  const live = view.machines.find((x) => x.id === id);
  if (live) last.current = live;
  const m = live ?? (removed && !removed.done ? last.current : undefined);
  if (!m) {
    if (removed?.done) return <Removed removed={removed} />;
    return (
      <Panel className="mx-auto mt-[12vh] max-w-md">
        <p className="px-4 py-4 text-tt-ink-2">
          This machine isn't in Runyard anymore.{" "}
          <Link to="/" className="font-semibold text-tt-ink underline">
            Go to the Board
          </Link>
        </p>
      </Panel>
    );
  }
  const admin = session.user?.role === "admin";
  const unreached = m.health === null && m.connection.state !== "connected";
  const index = view.machines.indexOf(m) + 1;
  const showReadiness = () => {
    setReadinessOpen(true);
    requestAnimationFrame(() =>
      document.getElementById("readiness")?.scrollIntoView({ behavior: "smooth" }),
    );
  };
  const reviewChanges = () => {
    setStartReview((n) => n + 1);
    document.getElementById("changes")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="font-ui">
      <MachineHead
        m={m}
        index={index}
        actions={
          admin && (
            <>
              <TtButton variant="primary" onClick={reviewChanges}>
                Review changes
              </TtButton>
              {!editing && (
                <TtButton aria-label={`Edit ${m.name}`} onClick={() => setEditing(true)}>
                  Edit
                </TtButton>
              )}
              <RemoveMachine m={m} />
            </>
          )
        }
      />
      {editing && <EditMachine m={m} close={() => setEditing(false)} />}
      <Banner m={m} unreached={unreached} problems={problems} showReadiness={showReadiness} />
      <Readings m={m} />
      {/* Two stacks on a wide screen; on a phone one, in the design's order. */}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start lg:gap-[18px]">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-[18px]">
          {unreached && (
            <div className="max-lg:order-1">
              <AccessPanel m={m} admin={admin} />
            </div>
          )}
          <div className="max-lg:order-2">
            <MachineRunners m={m} />
          </div>
          {/* Jobs is shared with the runner pages; it brings its own heading. */}
          <div className="min-w-0 max-lg:order-4 [&>section]:mt-0">
            <Jobs filter={{ machine: m.id }} />
          </div>
        </div>
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-[18px]">
          <div className="max-lg:order-3">
            <MachineChanges
              key={reviewId}
              m={m}
              admin={admin}
              reviewId={reviewId}
              startReview={startReview}
            />
          </div>
          <div className="max-lg:order-5">
            <Monitoring m={m} admin={admin} />
          </div>
          <div className="max-lg:order-6">
            <Panel title="Details" meta="Folded until you need them">
              <Det
                id="readiness"
                summary="Runner readiness"
                note={readinessNote(m)}
                open={readinessOpen}
                onToggle={setReadinessOpen}
              >
                <RunnerReadiness m={m} />
              </Det>
              <Det summary="Diagnostics" note={diagnosticSummary(m)}>
                <Diagnostics m={m} />
              </Det>
              <Det
                summary="Connection"
                note={m.transport === "tailscale" ? "Tailscale SSH" : "OpenSSH"}
              >
                <Connection m={m} />
              </Det>
              <Det summary="History">
                {/* The timeline is shared with the Machines page; it brings its own heading. */}
                <div className="px-4 [&>section]:mt-0 [&>section>div:first-child>h2]:hidden">
                  <EventTimeline machineId={m.id} />
                </div>
              </Det>
              {m.health && m.health.warnings.length > 0 && (
                <Det summary="SSH warnings" note={m.health.warnings.length}>
                  {m.health.warnings.map((w) => (
                    <p key={w} className="px-4 py-1 text-[12.5px] break-words text-tt-ink-2">
                      {w}
                    </p>
                  ))}
                </Det>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The head: back to all machines, the platform sign, the name and its state, what it is. */
function MachineHead({ m, index, actions }: { m: MachineView; index: number; actions: ReactNode }) {
  const c = m.connection.state;
  const chip: [ChipTone, string] =
    c === "connected"
      ? ["ok", "Connected"]
      : c === "error"
        ? ["error", "SSH failed"]
        : c === "offline"
          ? ["neutral", "Offline"]
          : c === "stale"
            ? ["warn", "Stale"]
            : ["plain", "Checking…"];
  const os = osLine(m);
  return (
    <header className="mb-3 lg:mb-[18px]">
      <Link
        to="/machines"
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-tt-ink-2 hover:text-tt-ink"
      >
        <span aria-hidden>‹</span> All machines
      </Link>
      <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap lg:gap-[18px]">
        <Sign n={index} large tone={c === "error" ? "error" : c === "offline" ? "dim" : "normal"} />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[30px] leading-none font-extrabold [font-stretch:76%] lg:text-[38px]">
            <CopyValue value={m.name} label="Machine name" showIcon={false} />
            <Chip tone={chip[0]}>{chip[1]}</Chip>
          </h1>
          <p className="mt-1.5 text-tt-ink-2">
            {[
              m.description && (
                <span key="d" className="break-words">
                  {m.description}
                </span>
              ),
              os && <span key="os">{os}</span>,
              <CopyValue
                key="t"
                value={m.tailnet?.address ?? m.sshTarget}
                label="Address"
                showIcon={false}
                className="font-board text-[13px]"
              />,
            ]
              .filter(Boolean)
              .map((part, i) => (
                <span key={i}>
                  {i > 0 && <span className="text-tt-ink-3"> · </span>}
                  {part}
                </span>
              ))}
          </p>
        </div>
        {actions && (
          <div className="flex w-full flex-wrap gap-2 max-lg:[&>*]:flex-1 lg:ml-auto lg:w-auto lg:justify-end">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * The notice under the head: red when SSH fails or the machine is offline, yellow when its
 * readings are old, an alert is active, or it isn't ready for its pools' jobs. Ported from
 * aarondfrancis/fleet's ConnectionNotice.
 */
function Banner({
  m,
  unreached,
  problems,
  showReadiness,
}: {
  m: MachineView;
  unreached: boolean;
  problems: number;
  showReadiness: () => void;
}) {
  const now = useNow();
  const queryClient = useQueryClient();
  const check = useMutation({
    mutationFn: () => call(api.machines[":id"].check.$post({ param: { id: m.id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });
  const checkAgain = (
    <button
      type="button"
      className={noticeButton}
      onClick={() => check.mutate()}
      disabled={check.isPending}
    >
      {check.isPending ? "Checking…" : "Check again"}
    </button>
  );
  const c = m.connection;
  const alert = m.alerts.find((a) => !a.stale);
  const error = check.error && <TtError error={check.error} className="mt-1 text-current" />;
  if (c.state === "error")
    return (
      <NoticeBar
        tone="error"
        action={
          unreached ? (
            <button
              type="button"
              className={noticeButton}
              onClick={() =>
                document.getElementById("setup")?.scrollIntoView({ behavior: "smooth" })
              }
            >
              Show the fix
            </button>
          ) : (
            checkAgain
          )
        }
      >
        <SshDetail detail={c.detail} />
        {error}
      </NoticeBar>
    );
  if (c.state === "offline")
    return (
      <NoticeBar tone="error" action={checkAgain}>
        Offline on the tailnet.{" "}
        {c.lastSeen ? `Last seen ${timeAgo(c.lastSeen, now)}.` : "Not seen recently."}
        {m.health ? " Health is from the last check." : ""}
        {error}
      </NoticeBar>
    );
  if (c.state === "stale")
    return (
      <NoticeBar action={checkAgain}>
        Last checked {timeAgo(c.checkedAt, now)}. {c.reason} Health is out of date.
        {error}
      </NoticeBar>
    );
  if (alert)
    return (
      <NoticeBar>
        {alert.kind === "offline" ? "Offline" : "Low disk space"}
        {alert.muted ? " (alerts paused)" : ""}:{" "}
        <span className="font-medium">{alert.detail.split("\n")[0]}</span>
      </NoticeBar>
    );
  if (problems)
    return (
      <NoticeBar
        action={
          <button type="button" className={noticeButton} onClick={showReadiness}>
            Show the fix
          </button>
        }
      >
        {problems === 1 ? "One thing" : `${problems} things`} to fix before its pools' jobs can run
        here.
      </NoticeBar>
    );
  return null;
}

/** Six readings across: the tailnet, SSH, then health from the last SSH read. Ported from aarondfrancis/fleet's MachineGlance and HealthMeters. */
function Readings({ m }: { m: MachineView }) {
  const now = useNow();
  const t = m.tailnet;
  const c = m.connection;
  const h = m.health;
  const memory = memoryUsedFraction(h);
  const disk = primaryDisk(h);
  const free = disk ? disk.availableBytes / Math.max(1, disk.totalBytes) : null;
  const stale = h?.stale ?? false;
  const connectWith = m.transport === "tailscale" ? "Tailscale SSH" : "OpenSSH";
  return (
    <Stats>
      <Stat
        label="Tailnet"
        value={!t ? "Off" : t.online ? "Online" : "Offline"}
        sub={
          !t
            ? "Not on tailnet"
            : t.online
              ? t.address
              : t.lastSeen
                ? `last seen ${timeAgo(t.lastSeen, now)}`
                : "not seen recently"
        }
      />
      <Stat
        label="SSH"
        value={
          c.state === "connected"
            ? "Connected"
            : c.state === "stale"
              ? "Stale"
              : c.state === "error"
                ? "Failing"
                : c.state === "offline"
                  ? "Offline"
                  : "Checking…"
        }
        sub={
          c.state === "connected"
            ? `${connectWith} · ${timeAgo(c.checkedAt, now)}`
            : c.state === "stale"
              ? `last checked ${timeAgo(c.checkedAt, now)}`
              : connectWith
        }
      />
      <Stat
        label="CPU"
        stale={stale}
        value={h?.cpuPercent == null ? "—" : formatPercent(h.cpuPercent)}
        bar={h?.cpuPercent == null ? null : h.cpuPercent / 100}
        sub={
          !h
            ? "not reachable"
            : h.loadAverage
              ? `load ${h.loadAverage.map((l) => l.toFixed(1)).join(" ")}`
              : h.logicalCores == null
                ? "unavailable"
                : `${h.logicalCores} cores`
        }
      />
      <Stat
        label="Memory"
        stale={stale}
        value={memory == null ? "—" : formatPercent(memory * 100)}
        bar={memory}
        sub={
          h
            ? `${formatBytes(h.memoryAvailableBytes)} free of ${formatBytes(h.memoryTotalBytes)}`
            : "not reachable"
        }
      />
      <Stat
        label="Disk free"
        stale={stale}
        value={free == null ? "—" : formatPercent(free * 100)}
        bar={free}
        warn={free != null && free < 0.1}
        sub={
          disk
            ? `${formatBytes(disk.availableBytes)} of ${formatBytes(disk.totalBytes)}${h && h.disks.length > 1 ? ` · ${h.disks.length} disks` : ""}`
            : h
              ? "not reported"
              : "not reachable"
        }
      />
      <Stat
        label="Uptime"
        stale={stale}
        value={h?.uptimeSecs == null ? "—" : formatUptime(h.uptimeSecs)}
        sub={
          !h
            ? "not reachable"
            : stale
              ? `as of ${timeAgo(h.asOf, now)}`
              : h.uptimeSecs == null
                ? "not reported"
                : "since last restart"
        }
      />
    </Stats>
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });
  return (
    <Panel
      title="Monitoring"
      action={
        admin && (
          <TtButton disabled={maintenance.isPending} onClick={() => maintenance.mutate()}>
            {maintenance.isPending
              ? "Saving…"
              : pausedUntil
                ? "End maintenance"
                : "Pause alerts 1 hour"}
          </TtButton>
        )
      }
    >
      <p className="px-4 pb-3.5 text-tt-ink-2">
        {pausedUntil
          ? `Alerts are paused until ${formatClock(pausedUntil)}. History continues.`
          : "Alerts when offline for 3 minutes or under 10% disk free."}
      </p>
      <TtError className="px-4 pb-3" error={maintenance.error} />
      {m.alerts.length === 0 && (
        <Row>
          <Dot tone="ok" />
          <span className="text-tt-ink-2">No active alerts.</span>
        </Row>
      )}
      {m.alerts.map((a) => (
        <Row key={a.id} className="items-start">
          <span
            className={`grid size-[22px] flex-none place-items-center rounded ${
              a.kind === "offline" ? "bg-tt-bad text-white" : "bg-tt-signal text-tt-on-signal"
            } ${a.stale ? "opacity-50" : ""}`}
          >
            <WarnIcon size={13} />
          </span>
          <span className="min-w-0 flex-1">
            <b className="flex flex-wrap items-center gap-2 font-bold">
              {a.kind === "offline" ? "Offline" : "Low disk space"}
              {a.muted && <Chip tone="plain">Maintenance</Chip>}
              {a.stale && <Chip tone="plain">Stale</Chip>}
            </b>
            <small className="block text-[12px] break-words whitespace-pre-line text-tt-ink-3">
              {a.detail}
            </small>
          </span>
          <span
            className="shrink-0 text-[12px] text-tt-ink-3 tabular-nums"
            title={new Date(a.since).toLocaleString()}
          >
            since {timeAgo(a.since, now)}
          </span>
        </Row>
      ))}
    </Panel>
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
    <>
      <p
        className={`px-4 pt-1 text-[12.5px] ${d?.stale ? "font-semibold text-tt-warn-ink" : "text-tt-ink-3"}`}
      >
        {d
          ? `${d.stale ? "Last checked" : "Checked"} ${timeAgo(d.asOf, now)}.${d.stale ? " May be out of date." : ""}`
          : "Appears after the first SSH check."}
      </p>
      {d &&
        GROUPS.map(([group, title]) => {
          const checks = d.checks.filter((c) => c.group === group);
          if (!checks.length) return null;
          return (
            <div key={group}>
              <Kvh>{title}</Kvh>
              {checks.map((c) => {
                // Plain facts (the account, the architecture, the disk) are just listed.
                const plain = c.status === "info" || c.id === "disk-space";
                const warn = c.status === "warn" && !d.stale;
                return (
                  <Kv
                    key={c.id}
                    dim={d.stale}
                    dot={
                      plain ? undefined : d.stale ? "unknown" : dotOf[diagnosticTone[c.status].tone]
                    }
                    label={c.title}
                    value={c.value}
                  >
                    {(c.detail || warn || (c.command && c.status !== "pass" && !d.stale)) && (
                      <>
                        {(c.detail || warn) && (
                          <span className="max-w-[60ch] leading-relaxed">
                            {warn && (
                              <span className="mr-2">
                                <Chip tone="warn">Warning</Chip>
                              </span>
                            )}
                            {c.detail}
                          </span>
                        )}
                        {c.command && c.status !== "pass" && !d.stale && (
                          <InlineCode text={c.command} />
                        )}
                      </>
                    )}
                  </Kv>
                );
              })}
            </div>
          );
        })}
    </>
  );
}

/** How Runyard reaches the machine, and what the tailnet knows about it. Ported from aarondfrancis/fleet's MachineFacts. */
function Connection({ m }: { m: MachineView }) {
  const now = useNow();
  const t = m.tailnet;
  const disks = m.health?.disks ?? [];
  const copy = (value: string, label: string, mono = false) => (
    <CopyValue value={value} label={label} className={mono ? "font-board text-[12.5px]" : ""} />
  );
  return (
    <>
      <Kv label="SSH target" value={copy(m.sshTarget, "SSH target", true)} />
      <Kv label="Connect with" value={m.transport === "tailscale" ? "Tailscale SSH" : "OpenSSH"} />
      <Kv label="Operating system" value={m.os ? osLabel[m.os] : "Detect"} />
      {m.health?.uptimeSecs != null && (
        <Kv label="Uptime" value={formatUptime(m.health.uptimeSecs)} />
      )}
      <Kvh>Tailnet</Kvh>
      <Kv
        label="Status"
        value={
          t
            ? t.online
              ? "Online"
              : `Offline${t.lastSeen ? `, last seen ${timeAgo(t.lastSeen, now)}` : ""}`
            : "Not on tailnet"
        }
      />
      {t && (
        <>
          <Kv label="Hostname" value={copy(t.name, "Hostname")} />
          <Kv label="MagicDNS" value={copy(t.address, "MagicDNS", true)} />
          <Kv
            label="Addresses"
            value={
              t.ips.length ? (
                <span className="flex flex-col items-end gap-1">
                  {t.ips.map((ip) => (
                    <CopyValue
                      key={ip}
                      value={ip}
                      label="IP address"
                      className="font-board text-[12.5px]"
                    />
                  ))}
                </span>
              ) : (
                "—"
              )
            }
          />
          <Kv
            label="Tailscale SSH"
            value={
              m.diagnostics?.checks.find((c) => c.id === "tailscale-ssh")?.value ??
              (t.tailscaleSsh ? "Advertised" : "Not advertised")
            }
          />
          {t.tags.length > 0 && <Kv label="Tags" value={copy(t.tags.join(" "), "Tags", true)} />}
        </>
      )}
      {disks.length > 1 && (
        <>
          <Kvh>Disks</Kvh>
          {disks.map((d) => {
            const free = d.availableBytes / Math.max(1, d.totalBytes);
            return (
              <div
                key={d.mountPoint}
                className={`px-4 py-2 ${m.health?.stale ? "opacity-60" : ""}`}
              >
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="truncate font-board">{d.mountPoint}</span>
                  <span className="shrink-0 text-tt-ink-3 tabular-nums">
                    {formatBytes(d.availableBytes)} free of {formatBytes(d.totalBytes)}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-sm bg-tt-rule">
                  <i
                    className={`block h-full ${free < 0.1 ? "bg-[#e3a800]" : "bg-tt-ink"}`}
                    style={{ width: `${(1 - free) * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
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
    <Panel title={`Edit ${m.name}`} className="mb-4 max-w-3xl">
      <form onSubmit={submit} className="grid gap-x-3.5 gap-y-3 px-4 pb-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
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
        <TtError className="sm:col-span-2" error={save.error} />
        <div className="flex gap-2 sm:col-span-2">
          <TtButton type="submit" variant="primary" disabled={save.isPending}>
            Save
          </TtButton>
          <TtButton onClick={close}>Cancel</TtButton>
        </div>
      </form>
    </Panel>
  );
}

type RemoveStep = "pools" | "runners" | "cleanUp" | "remove" | "done";
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
      const removal: RemovedMachine = {
        name: m.name,
        os: m.os,
        pools: pools.map((p) => p.name),
        runners: left.length ? (left.length === 1 ? left[0]! : leftSummary) : null,
        cleanedUp: false,
        prepared: m.os === "linux" && m.sshTarget.startsWith("runyard@"),
        done: false,
      };
      // Recorded before the call: the live view drops the machine as soon as the server removes
      // it, and the page holds it on screen while this entry isn't done.
      removedMachines.set(m.id, removal);
      let res;
      try {
        res = await call(
          api.machines[":id"].$delete({
            param: { id: m.id },
            query: withCleanUp ? { cleanUp: "1" } : {},
          }),
        );
      } catch (error) {
        removedMachines.forget(m.id);
        throw error;
      }
      // Every step shows done for a moment, then the page says what the removal did.
      setStep("done");
      await new Promise((r) => setTimeout(r, 900));
      removedMachines.set(m.id, { ...removal, cleanedUp: res.cleanedUp !== null, done: true });
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
  const at = step === "done" ? plan.length : step ? plan.findIndex((s) => s.key === step) : -1;
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
      <AlertDialog.Trigger className={ttButton.danger}>Remove</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-black/30" />
        <AlertDialog.Popup className="sheet-dialog fixed top-1/2 left-1/2 w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-tt-rule bg-tt-card p-5 font-ui text-tt-ink shadow-[0_24px_50px_-20px_rgba(0,0,0,.45)]">
          <AlertDialog.Title className="text-[22px] leading-tight font-extrabold [font-stretch:80%]">
            {step === "done"
              ? `Removed ${m.name}`
              : plan.length && (remove.isPending || remove.error)
                ? `Removing ${m.name}`
                : confirming
                  ? `Are you sure you want to remove ${m.name}?`
                  : `Remove ${m.name}`}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-[13.5px] text-tt-ink-2">
            {step === "done"
              ? "Every step is done."
              : plan.length && (remove.isPending || remove.error)
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
            <ul className="mt-3 flex flex-col gap-1 rounded-lg border border-tt-rule bg-tt-paper px-3 py-2 font-board text-[12px]">
              {left.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
          {blocked && (
            <p className="mt-3 rounded-lg bg-tt-warn-bg px-3 py-2 text-[12.5px] font-semibold text-tt-warn-ink">
              {busy.length
                ? `${busy.join(", ")} ${busy.length === 1 ? "is" : "are"} running a job. Remove the machine once ${busy.length === 1 ? "it finishes" : "they finish"}.`
                : `${m.name} isn't connected, so Runyard can't remove ${left.length === 1 ? "its runner" : "them"}. Connect it, then remove it again.`}
            </p>
          )}
          {(confirming || remove.isPending || remove.error) && (
            <ol className="mt-3 flex flex-col gap-1.5 text-[13px]">
              {(confirming ? steps.filter((s) => s.key !== "cleanUp" || cleanUp) : plan).map(
                (s, i) => (
                  <li key={s.key} className="flex items-center gap-2">
                    <Dot
                      tone={i < at ? "ok" : i === at ? (remove.error ? "bad" : "warn") : "unknown"}
                    />
                    <span className={i > at && !confirming ? "text-tt-ink-3" : undefined}>
                      {s.label}
                    </span>
                  </li>
                ),
              )}
            </ol>
          )}
          {!blocked && !left.length && !connected && !confirming && !remove.error && (
            <div className="mt-3 rounded-lg border border-tt-rule bg-tt-paper px-3 py-2.5 text-[12.5px]">
              <span className="font-bold">{m.name} won't be cleaned up</span>
              <p className="mt-0.5 text-[12px] text-tt-ink-2">
                It isn't connected, so its runner folder and Runyard's key stay there.
              </p>
              <TeardownCommands os={m.os} />
            </div>
          )}
          {!blocked && connected && !confirming && !remove.isPending && !remove.error && (
            <label className="mt-3 flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                className="mt-[3px] accent-tt-ink"
                checked={cleanUp}
                onChange={(e) => setCleanUp(e.target.checked)}
              />
              <span>
                <span className="font-bold">Also clean up {m.name}</span>
                <span className="block text-[12px] text-tt-ink-2">
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
                <Field
                  label="Sudo password (if needed)"
                  hint="Removing runner services needs root. Used once, never stored."
                >
                  <Input
                    type="password"
                    autoComplete="off"
                    value={sudo}
                    onChange={(e) => setSudo(e.target.value)}
                  />
                </Field>
              </div>
            )}
          {connected && !cleanUp && !confirming && !remove.error && <TeardownCommands os={m.os} />}
          {cleanUpFailed ? (
            <>
              <TtError
                className="mt-3"
                error={`Runyard couldn't clean up ${m.name}: ${remove.error?.message}`}
              />
              <TeardownCommands os={m.os} />
            </>
          ) : (
            remove.error && <TtError className="mt-3" error={remove.error} />
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <AlertDialog.Close className={ttButton.secondary}>Cancel</AlertDialog.Close>
            {cleanUpFailed ? (
              <>
                <TtButton onClick={() => start(true)}>Try again</TtButton>
                <TtButton variant="danger" onClick={() => start(false)}>
                  Remove without cleaning up
                </TtButton>
              </>
            ) : confirming ? (
              <>
                <TtButton onClick={() => setConfirming(false)}>Back</TtButton>
                <button
                  type="button"
                  className={`${ttButton.primary} !border-tt-bad !bg-tt-bad !text-white`}
                  onClick={() => start(cleanUp && connected)}
                >
                  Yes, remove {m.name}
                </button>
              </>
            ) : (
              <TtButton
                variant="danger"
                onClick={() => (remove.error ? start(cleanUp && connected) : setConfirming(true))}
                disabled={blocked || remove.isPending}
              >
                {remove.isPending ? "Removing…" : remove.error ? "Try again" : "Remove machine"}
              </TtButton>
            )}
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

type RemovedMachine = {
  name: string;
  os: OsFamily | null;
  /** The pools it was taken out of. */
  pools: string[];
  /** What Runyard removed there first ("lab-1", "2 runners and runner software"), if anything. */
  runners: string | null;
  cleanedUp: boolean;
  prepared: boolean;
  /** False while the remove dialog is still finishing. */
  done: boolean;
};

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
    forget: (id: string) => {
      entries.delete(id);
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
  const navigate = useNavigate();
  const leftToDo = !removed.cleanedUp || removed.prepared;
  const did = [
    removed.pools.length > 0 && `Took it out of ${removed.pools.join(", ")}`,
    removed.runners && `Removed ${removed.runners}`,
    removed.cleanedUp && "Deleted its runner folder and Runyard's key there",
    "Deleted its history and stopped checking it",
  ].filter((x): x is string => typeof x === "string");
  return (
    <div className="mx-auto mt-[12vh] max-w-md font-ui">
      <Panel className="px-6 py-6">
        <div className="flex flex-col items-center text-center">
          <span
            className={`flex size-10 items-center justify-center rounded-full ${leftToDo ? "bg-tt-warn-bg text-tt-warn-ink" : "bg-tt-ok-bg text-tt-ok-ink"}`}
          >
            <Icon name="check" size={16} />
          </span>
          <h2 className="mt-3 text-[26px] leading-none font-extrabold [font-stretch:78%]">
            Removed {removed.name}
          </h2>
          <p className="mt-2 text-[13.5px] text-tt-ink-2">
            {!removed.cleanedUp
              ? "Runyard's runner folder and SSH key may still be on the machine."
              : removed.prepared
                ? "Only the runyard account it signed in as is left on the machine."
                : "Nothing of Runyard's is left on the machine."}
          </p>
        </div>
        <ul className="mt-4 flex flex-col gap-1.5 rounded-lg border border-tt-rule bg-tt-paper px-3 py-2.5 text-[13px]">
          {did.map((line) => (
            <li key={line} className="flex items-center gap-2">
              <Dot tone="ok" />
              {line}
            </li>
          ))}
        </ul>
        {removed.cleanedUp ? (
          removed.prepared && <AccountCommand />
        ) : (
          <TeardownCommands os={removed.os} />
        )}
        <div className="mt-5 flex justify-center">
          <TtButton variant="primary" onClick={() => void navigate({ to: "/" })}>
            Go to the Board
          </TtButton>
        </div>
      </Panel>
    </div>
  );
}

/** Deletes the runyard account by hand, where the dashboard can't serve the teardown script. */
const ACCOUNT_REMOVAL =
  "sudo loginctl disable-linger runyard; sudo loginctl terminate-user runyard; sleep 2; sudo pkill -KILL -u runyard; sleep 1; sudo userdel -r runyard && sudo rm -f /etc/sudoers.d/runyard";

/** After a cleanup on a machine set up with --prepare: the root command that deletes the runyard account. */
function AccountCommand() {
  const origin = window.location.origin;
  const command = origin.startsWith("https://")
    ? `curl -fsSL ${origin}/api/machine-setup/teardown.sh | sudo sh -s -- --prepared`
    : ACCOUNT_REMOVAL;
  return (
    <div className="mt-3 flex flex-col gap-1 text-[12px]">
      <span className="font-bold">To delete the runyard account too, run on the machine:</span>
      <CodeBlock text={command} label="Account removal command" />
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
  const https = origin.startsWith("https://");
  const { data: key } = useQuery({ ...sshKeyQuery, enabled: !https });
  // Over plain http the script isn't served, so the commands do the same by hand, matching
  // Runyard's key by its body.
  const body = key?.line.split(" ")[1];
  if (!https && !body)
    return (
      <p className="mt-3 text-[12px] text-tt-ink-2">
        To clean it up, delete Runyard's runner folder on the machine and remove Runyard's key from
        its <span className="font-board">authorized_keys</span>. Or open the dashboard over HTTPS
        for a command that does both.
      </p>
    );
  const commands =
    os === "windows"
      ? [
          [
            "In PowerShell, as the account Runyard used (an administrator one needs an administrator PowerShell)",
            https
              ? `irm ${origin}/api/machine-setup/teardown.ps1 | iex`
              : `Remove-Item -Recurse -Force "$env:ProgramData\\Runyard\\runners" -ErrorAction SilentlyContinue; foreach ($f in "$HOME\\.ssh\\authorized_keys", "$env:ProgramData\\ssh\\administrators_authorized_keys") { if ((Test-Path $f) -and (Select-String -Path $f -SimpleMatch -Pattern '${body}' -Quiet)) { Set-Content -Path $f -Encoding ascii -Value (Get-Content $f | Where-Object { -not $_.Contains('${body}') }) } }`,
          ],
        ]
      : [
          [
            "As the account Runyard used",
            https
              ? `curl -fsSL ${origin}/api/machine-setup/teardown.sh | sh`
              : `rm -rf ~/runyard-runners; f=~/.ssh/authorized_keys; [ -f $f ] && grep -vF '${body}' $f > $f.new; [ -f $f.new ] && chmod 600 $f.new && mv $f.new $f`,
          ],
          ...(os !== "macos"
            ? [
                [
                  "Fresh-machine setup, as root (also removes the runyard account)",
                  https
                    ? `curl -fsSL ${origin}/api/machine-setup/teardown.sh | sudo sh -s -- --prepared`
                    : ACCOUNT_REMOVAL,
                ],
              ]
            : []),
        ];
  return (
    <div className="mt-4 flex flex-col gap-2 text-[12px]">
      <span className="font-bold">To clean it up, run on the machine:</span>
      {commands.map(([label, text]) => (
        <div key={label} className="flex flex-col gap-1">
          <span className="text-tt-ink-3">{label}</span>
          <CodeBlock text={text!} label="Cleanup command" />
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
          className="mt-1.5 block font-board text-[11.5px] font-normal break-all opacity-85"
        />
      )}
    </>
  );
}
