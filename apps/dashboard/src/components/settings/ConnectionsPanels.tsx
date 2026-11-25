import { Menu } from "@base-ui/react/menu";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { formatDollars, plural } from "../../lib/format.ts";
import { checksQuery } from "../../lib/queries.ts";
import { useYard } from "../../lib/yard.ts";
import { Elapsed } from "../runners.tsx";
import { Clipped, InfoTip } from "../InfoTip.tsx";
import { ErrorText } from "../ui.tsx";
import { webhookStatusQuery } from "../Webhooks.tsx";
import { Chip, Panel, Row } from "../tt.tsx";
import { Note, RowText, SIcon, WithCode, rowButton } from "./parts.tsx";

/** The forges Runyard reads: each GitHub App and Forgejo account, and the way to manage each. */
export function ConnectionsPanel() {
  const view = useYard();
  const hooks = useQuery(webhookStatusQuery).data;
  const apps = view.github.apps;
  const conns = view.forgejo.connections;
  const hookText = (forgeId: string) => {
    if (!hooks || hooks.port === null) return null;
    const hook = hooks.apps.find((a) => a.forgeId === forgeId);
    if (!hook) return null;
    return hook.lastDelivery ? "webhooks delivering" : hook.secretSet ? "webhooks set" : "polling";
  };

  if (apps.length === 0 && conns.length === 0)
    return (
      <Panel id="connections" title="Connections" meta="None yet">
        <Row className="!border-t-0">
          <SIcon name="link" />
          <RowText
            title="No forge connected"
            detail="Runyard registers runners with GitHub or Forgejo and watches for queued jobs."
          />
        </Row>
        <Row className="flex-wrap">
          <Link to="/settings/github" className={rowButton.primary}>
            Connect GitHub
          </Link>
          <Link to="/settings/forgejo" className={rowButton.secondary}>
            Connect Forgejo
          </Link>
        </Row>
      </Panel>
    );

  return (
    <Panel id="connections" title="Connections" action={<ConnectMenu />}>
      {apps.map((app) => {
        const installs = app.installations.length;
        const hook = hookText(app.forgeId);
        return (
          <Row key={app.forgeId}>
            <SIcon name="link" />
            <RowText
              title={`GitHub · ${app.owner}`}
              detail={
                <>
                  {app.name} · {plural(installs, "installation")}
                  {hook && ` · ${hook}`}
                </>
              }
            />
            {/* On a phone only a problem gets a chip, leaving the row room for its name. */}
            <span className={app.error || !installs ? "" : "max-sm:hidden"}>
              <Chip tone={app.error ? "error" : installs ? "ok" : "warn"}>
                {app.error ? "Error" : installs ? "Connected" : "Not installed"}
              </Chip>
            </span>
            <Link to="/settings/github" className={rowButton.secondary}>
              Manage
            </Link>
          </Row>
        );
      })}
      {conns.map((c) => (
        <Row key={c.forgeId}>
          <SIcon name="link" />
          <RowText
            title={`Forgejo · ${c.login}`}
            detail={
              <>
                {new URL(c.baseUrl).host}
                {c.version && ` · Forgejo ${c.version.split("+")[0]}`}
              </>
            }
          />
          <span className={c.error ? "" : "max-sm:hidden"}>
            <Chip tone={c.error ? "error" : "ok"}>{c.error ? "Error" : "Connected"}</Chip>
          </span>
          <Link to="/settings/forgejo" className={rowButton.secondary}>
            Manage
          </Link>
        </Row>
      ))}
    </Panel>
  );
}

/** Connect another GitHub owner or Forgejo instance. */
function ConnectMenu() {
  const navigate = useNavigate();
  const item =
    "flex w-full items-center rounded-md px-2.5 py-2 text-left text-[13px] font-semibold outline-none data-[highlighted]:bg-tt-hover";
  return (
    <Menu.Root>
      <Menu.Trigger className={rowButton.secondary}>Connect</Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6}>
          <Menu.Popup className="min-w-44 rounded-lg border border-tt-rule bg-tt-card p-1 text-tt-ink shadow-[0_12px_30px_-12px_rgba(0,0,0,.35)] outline-none">
            <Menu.Item className={item} onClick={() => void navigate({ to: "/settings/github" })}>
              GitHub
            </Menu.Item>
            <Menu.Item className={item} onClick={() => void navigate({ to: "/settings/forgejo" })}>
              Forgejo
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

const DOT = {
  ok: "bg-tt-ok",
  warn: "bg-[#e3a800]",
  bad: "bg-tt-bad",
  off: "bg-tt-rule-2",
} as const;

/** The control machine's setup checks: ssh, Tailscale, the secret key, disk and the service. */
/** A check's dot, read aloud. */
const STATE_WORDS: Record<string, string> = {
  ok: "Fine",
  warn: "Needs a look",
  bad: "Not working",
  off: "Off",
};

export function HostPanel() {
  const checks = useQuery(checksQuery);
  const attention = checks.data?.filter((c) => c.state === "warn" || c.state === "bad").length;
  return (
    <Panel
      id="host"
      title={
        <span className="inline-flex items-center gap-1.5">
          This machine
          <InfoTip label="this machine">
            The Runyard host itself: what it needs to reach machines and keep running.
          </InfoTip>
        </span>
      }
      meta={
        attention === undefined ? undefined : attention ? `${attention} need attention` : "Ready"
      }
    >
      {checks.isPending && <Note>Checking…</Note>}
      {checks.error && <ErrorText className="px-4 pb-3" error={checks.error} />}
      {checks.data && (
        <ul className="pb-1">
          {checks.data.map((c) => (
            <li key={c.id} className="text-[13px]">
              <div className="flex items-start gap-3 px-4 py-2">
                <span
                  role="img"
                  aria-label={STATE_WORDS[c.state]}
                  className={`mt-[5px] size-2 flex-none self-start rounded-full ${DOT[c.state]}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    <b className="font-semibold">{c.title}</b>
                    {c.about && <InfoTip label={c.title}>{c.about}</InfoTip>}
                  </span>
                  {/* A check that's fine shows its value on one line, whole on hover or tap; one
                      that needs attention keeps all of its words in view. */}
                  <small
                    className={`block text-[12px] ${c.state === "ok" ? "text-tt-ink-3" : "text-tt-ink-2 [overflow-wrap:anywhere]"}`}
                  >
                    {c.state === "ok" && c.detail.length > 44 ? (
                      <Clipped value={c.detail} label={c.title} />
                    ) : (
                      c.detail
                    )}
                  </small>
                </span>
              </div>
              {c.fix && (
                <p className="pr-4 pb-2 pl-9 text-[12px] text-tt-ink-3">
                  <WithCode text={c.fix} />
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <Row>
        <span className="flex-1" />
        <button
          type="button"
          className={rowButton.secondary}
          onClick={() => void checks.refetch()}
          disabled={checks.isFetching}
        >
          {checks.isFetching && !checks.isPending ? "Checking…" : "Check again"}
        </button>
      </Row>
    </Panel>
  );
}

/** boat.dev's running VMs and what they cost, or the way to connect it. */
export function BoatPanel() {
  const { boat } = useYard();
  if (!boat)
    return (
      <Panel id="boat" title="boat.dev on demand" meta="Optional">
        <Row className="!border-t-0">
          <SIcon name="cloud" />
          <RowText
            title="Not connected"
            detail="Jobs with runs-on: boat run on a fresh VM each. A read-only key adds what they cost, your plan's limits and VMs left running."
          />
          <Link to="/boat" className={rowButton.secondary}>
            Connect boat.dev
          </Link>
        </Row>
      </Panel>
    );
  const leftover = new Set(boat.leftover.map((v) => v.id));
  const total = boat.running.reduce((sum, v) => sum + (v.dollars ?? 0), 0);
  return (
    <Panel
      id="boat"
      title="boat.dev on demand"
      meta={boat.running.length ? `${formatDollars(total)} so far` : undefined}
      action={
        <Link to="/boat" className={rowButton.secondary}>
          Open
        </Link>
      }
    >
      {boat.error && <ErrorText className="px-4 pb-2" error={boat.error} />}
      {boat.limits && (
        <Note className="!pb-2">
          Plan {boat.limits.plan} · {boat.limits.activeSandboxes} of{" "}
          {boat.limits.maxActiveSandboxes} VMs running
        </Note>
      )}
      {boat.running.length === 0 ? (
        <Row>
          <SIcon name="cloud" />
          <RowText title="No VMs running" detail="Each runs-on: boat job starts its own." />
        </Row>
      ) : (
        boat.running.map((v) => (
          <Row key={v.id}>
            <SIcon name="cloud" />
            <RowText
              mono
              title={v.name}
              detail={
                <>
                  {v.type}
                  {v.jobId !== null && ` · job ${v.jobId}`} · up <Elapsed since={v.createdAt} />
                  {leftover.has(v.id) && " · outside a running job"}
                </>
              }
            />
            <Chip tone={leftover.has(v.id) ? "warn" : "busy"}>
              {v.dollars === null ? "Cost unknown" : formatDollars(v.dollars)}
            </Chip>
          </Row>
        ))
      )}
    </Panel>
  );
}
