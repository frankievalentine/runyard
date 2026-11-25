import type { Pool, YardView } from "@runyard/core";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";
import { SplitFlap } from "../../components/board/SplitFlap.tsx";
import { Icon } from "../../components/icons.tsx";
import { InfoTip, RowTip, TipText } from "../../components/InfoTip.tsx";
import { Lab, poolStatus } from "../../components/pool/bits.tsx";
import { Chip, PageHead, Panel, ttButton } from "../../components/tt.tsx";
import { OnDemandList } from "../../components/YardLists.tsx";
import { isForgejo } from "../../lib/pools.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { useYard } from "../../lib/yard.ts";

export const Route = createFileRoute("/_app/pools/")({
  component: Pools,
});

const LEDE =
  "A pool says which machines run jobs for which repositories, and the labels workflows use to ask for them. Runyard turns that into runners.";

/** Every pool as a card, as in the Timetable design, and boat.dev's on-demand runners. */
function Pools() {
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const admin = session.user?.role === "admin";
  const pools = view.pools.pools;
  const canCreate = admin && view.machines.length > 0;
  return (
    <div className="flex flex-col gap-5">
      <PageHead
        title={
          <span className="inline-flex items-center gap-2">
            Pools
            <InfoTip label="Pools" large>
              <TipText what={LEDE} />
            </InfoTip>
          </span>
        }
        actions={
          canCreate &&
          pools.length > 0 && (
            <Link to="/pools/new" className={ttButton.primary}>
              <Icon name="plus" size={14} />
              <span className="mt-[2px]">New pool</span>
            </Link>
          )
        }
      />
      {pools.length === 0 ? (
        <Panel>
          <Empty
            flap="No pools yet"
            title={admin ? "Create a pool" : "No pools yet"}
            body={
              admin
                ? "A pool turns labels, machines and repositories into runners. It needs at least one machine."
                : "An admin hasn't created pools yet. A pool turns labels, machines and repositories into runners."
            }
          >
            {admin &&
              (canCreate ? (
                <Link to="/pools/new" className={ttButton.primary}>
                  <Icon name="plus" size={14} />
                  <span className="mt-[2px]">Create a pool</span>
                </Link>
              ) : (
                <>
                  <button
                    type="button"
                    className={ttButton.primary}
                    disabled
                    aria-describedby="pool-why"
                  >
                    <Icon name="plus" size={14} />
                    <span className="mt-[2px]">Create a pool</span>
                  </button>
                  <span id="pool-why" className="text-[12.5px] text-tt-ink-2">
                    Add a machine first
                  </span>
                  <Link to="/machines/add" className={ttButton.secondary}>
                    Add machine
                  </Link>
                </>
              ))}
          </Empty>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3 lg:gap-4">
          {pools.map((p) => (
            <PoolCard key={p.id} pool={p} view={view} />
          ))}
        </div>
      )}
      <OnDemandList view={view} />
    </div>
  );
}

/** What a pool's chip means, by label ("partial" for "2 of 3 runners"), when it isn't plain. */
const STATUS_TIP: Record<string, string> = {
  Paused: "No new one-job runners start for it. Jobs already running finish.",
  partial:
    "Some of this pool's runners aren't set up yet. Review its machines' changes to set up the rest.",
  "No runners": "None of its machines has a runner for it yet. Add machines to the pool.",
  Offline: "Every one of its runners is offline.",
};

/** A pool's card: its status, its machines as stops on a line, how it runs, its labels and scope. */
function PoolCard({ pool, view }: { pool: Pool; view: YardView }) {
  const status = poolStatus(view, pool);
  const statusTip =
    STATUS_TIP[/^\d+ of \d+ runners$/.test(status.label) ? "partial" : status.label];
  const machines = pool.machines.map(
    (pm) => view.machines.find((m) => m.id === pm.machineId)?.name ?? pm.machineId,
  );
  const slots = [...new Set(pool.machines.map((m) => m.slots))];
  const total = pool.machines.reduce((n, m) => n + m.slots, 0);
  const mode =
    pool.mode === "onDemand"
      ? "On demand: one runner per job"
      : slots.length === 1
        ? `Persistent: ${slots[0]} per machine`
        : `Persistent: ${total} runners`;
  const forges = [
    ...(pool.scopes.some((s) => !isForgejo(view, s)) ? ["GitHub"] : []),
    ...(pool.scopes.some((s) => isForgejo(view, s)) ? ["Forgejo"] : []),
  ];
  const labels = pool.labels.length ? pool.labels : [`runyard-pool-${pool.name}`];
  return (
    <Link
      to="/pools/$id"
      params={{ id: pool.id }}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-tt-rule bg-tt-card p-[18px] text-left hover:border-tt-ink-3 max-lg:p-4"
    >
      <span className="flex items-center justify-between gap-2">
        <b className="min-w-0 truncate text-[20px] leading-[1.1] font-bold tracking-[-.01em]">
          {pool.name}
        </b>
        {statusTip ? (
          <RowTip content={<TipText what={statusTip} />}>
            <span>
              <Chip tone={status.tone}>{status.label}</Chip>
            </span>
          </RowTip>
        ) : (
          <Chip tone={status.tone}>{status.label}</Chip>
        )}
      </span>
      <span className="mt-0.5 flex items-center" aria-hidden>
        {machines.map((name, i) => (
          <span key={`${name}-${i}`} className="contents">
            {i > 0 && <u className="h-[3px] flex-1 bg-tt-ink" />}
            <i className="size-3 flex-none rounded-full border-[3px] border-tt-ink bg-tt-card" />
          </span>
        ))}
        <u className="h-[3px] flex-1 bg-tt-ink" />
      </span>
      <RowTip
        content={
          <TipText
            what={
              pool.mode === "onDemand"
                ? "Runyard starts a fresh runner for each queued job and removes it when the job ends."
                : "Its runners stay set up on each machine and wait for jobs, so builds start warm."
            }
          />
        }
      >
        <small className="text-[12.5px] text-tt-ink-3">
          {mode}
          {machines.length > 0 && ` · ${machines.join(", ")}`}
        </small>
      </RowTip>
      <span className="flex flex-wrap gap-1">
        {labels.map((l) =>
          pool.labels.length ? (
            <Lab key={l}>{l}</Lab>
          ) : (
            <RowTip
              key={l}
              content={
                <TipText
                  what="This pool has no labels of its own yet. Runyard gives every runner in it this one, so a workflow can ask for exactly these runners."
                  todo="Use it in runs-on:"
                />
              }
            >
              <span>
                <Lab>{l}</Lab>
              </span>
            </RowTip>
          ),
        )}
      </span>
      <small className="text-[12.5px] break-words text-tt-ink-3">
        {forges.join(" and ")}
        {forges.length > 0 && " · "}
        {pool.scopes.map((s) => s.target).join(", ")}
      </small>
    </Link>
  );
}

/** The design's empty state: a short line of flaps, a title, a sentence and what to do. */
function Empty({
  flap,
  title,
  body,
  children,
}: {
  flap?: string;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex max-w-[660px] flex-col items-start gap-2.5 px-6 pt-[26px] pb-7 max-lg:px-4 max-lg:pt-5 max-lg:pb-[22px]">
      {flap && (
        <div
          className="rounded-md bg-tt-board p-1.5"
          style={{ "--flap-w": "14px", "--flap-h": "26px", "--flap-fs": "15px" } as CSSProperties}
        >
          <SplitFlap text={flap} cells={flap.length} tone="signal" />
        </div>
      )}
      <h3 className="text-[18px] leading-tight font-extrabold">{title}</h3>
      <p className="text-[14px] text-tt-ink-2">{body}</p>
      {children && <div className="mt-1 flex flex-wrap items-center gap-2.5">{children}</div>}
    </div>
  );
}
