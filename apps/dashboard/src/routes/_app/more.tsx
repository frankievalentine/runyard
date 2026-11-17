import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { api, call } from "../../api.ts";
import type { ReactNode } from "react";
import { Icon, type IconName } from "../../components/icons.tsx";
import { InstallPanel } from "../../components/settings/InstallPanel.tsx";
import { SIcon } from "../../components/settings/parts.tsx";
import { PageHead } from "../../components/tt.tsx";
import { ErrorText, TimeAgo } from "../../components/ui.tsx";
import { useCheckNow } from "../../lib/check.ts";
import { formatDollars } from "../../lib/format.ts";
import { unassignedGroups } from "../../lib/nav.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { useYard } from "../../lib/yard.ts";

export const Route = createFileRoute("/_app/more")({
  component: More,
});

const row =
  "flex w-full items-center gap-3 border-t border-tt-rule p-3.5 text-left first:border-t-0 hover:bg-tt-hover disabled:opacity-60";

/** One line of a More menu: an icon, a title and the line under it, and a chevron. */
function Item({ icon, title, detail }: { icon: ReactNode; title: string; detail: ReactNode }) {
  return (
    <>
      <span className="text-tt-ink-2">{icon}</span>
      <span className="min-w-0 flex-1">
        <b className="block font-bold">{title}</b>
        <small className="block truncate text-[12.5px] text-tt-ink-3">{detail}</small>
      </span>
      <span className="text-tt-ink-3">
        <Icon name="chevron" size={12} />
      </span>
    </>
  );
}

const icon = (name: IconName) => <Icon name={name} size={18} />;

/**
 * The phone's More tab, as in the Timetable design: installing the app, then Pools, adding a
 * machine and Settings, then Check now, boat.dev and runners outside pools, and Sign out.
 */
function More() {
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const admin = session.user?.role === "admin";
  const check = useCheckNow();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: () => call(api.logout.$post()),
    onSuccess: () => {
      queryClient.clear();
      void navigate({ to: "/login" });
    },
  });
  const user = session.user;
  const name = user?.username ?? user?.tailscaleLogin ?? "";
  const pools = view.pools.pools.length;
  const unassigned = unassignedGroups(view.runners).flatMap((g) => g.runners);
  const boatRunners = view.runners.filter((r) => r.onDemand === "boat.dev");
  const boatCost = boatRunners.reduce((sum, r) => sum + (view.boatVms[r.key]?.dollars ?? 0), 0);
  const menu = "overflow-hidden rounded-xl border border-tt-rule bg-tt-card";
  return (
    <div className="flex flex-col gap-3">
      <PageHead title="More" />
      <InstallPanel />
      <nav aria-label="More" className={menu}>
        <Link to="/pools" className={row}>
          <Item
            icon={icon("plan")}
            title="Pools"
            detail={
              pools
                ? `${pools} ${pools === 1 ? "pool" : "pools"} · labels, machines, workflow snippets`
                : view.machines.length
                  ? "None yet"
                  : "None yet · add a machine first"
            }
          />
        </Link>
        {admin && (
          <Link to="/machines/add" className={row}>
            <Item
              icon={icon("plus")}
              title="Add a machine"
              detail="From your tailnet or by SSH target"
            />
          </Link>
        )}
        <Link to="/settings/account" className={row}>
          <Item
            icon={icon("settings")}
            title="Settings"
            detail="Connections, boat.dev, people, access tokens"
          />
        </Link>
      </nav>
      <div className={menu}>
        <button
          type="button"
          className={row}
          disabled={check.isPending}
          onClick={() => check.mutate()}
        >
          <Item
            icon={icon("refresh")}
            title={check.isPending ? "Checking…" : "Check now"}
            detail={
              <>
                Last check <TimeAgo at={view.generatedAt} />
              </>
            }
          />
        </button>
        <Link to="/boat" className={row}>
          <Item
            icon={<SIcon name="cloud" />}
            title="boat.dev"
            detail={
              view.boat
                ? boatRunners.length
                  ? `${boatRunners.length} ${boatRunners.length === 1 ? "VM" : "VMs"} on a job · ${formatDollars(boatCost)} so far`
                  : "Connected · idle"
                : "Not connected · optional"
            }
          />
        </Link>
        {unassigned.length > 0 && (
          <Link to="/machines" className={row}>
            <Item
              icon={icon("runner")}
              title="Runners not in a pool"
              detail={unassigned.map((r) => r.name).join(", ")}
            />
          </Link>
        )}
      </div>
      {/* The desktop's account menu has Sign out; on phones it lives here. */}
      <div className={menu}>
        <button
          type="button"
          className={row}
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          <span className="text-tt-bad">{icon("signout")}</span>
          <span className="min-w-0 flex-1">
            <b className="block font-bold text-tt-bad">
              {signOut.isPending ? "Signing out…" : "Sign out"}
            </b>
            <small className="block truncate text-[12.5px] text-tt-ink-3">
              Signed in as {name}
              {user && ` · ${user.role === "admin" ? "admin" : "viewer"}`}
              {session.via === "tailscale" && " · via Tailscale"}
            </small>
          </span>
        </button>
      </div>
      {check.isError && <ErrorText error={check.error} />}
      {signOut.isError && <ErrorText error={signOut.error} />}
    </div>
  );
}
