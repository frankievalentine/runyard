import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { api, call } from "../api.ts";
import { Button } from "../components/form.tsx";
import { ThemeMenu } from "../components/ThemeMenu.tsx";
import { StatusDot } from "../components/ui.tsx";
import { fleetQuery, useFleet, useFleetStream } from "../lib/fleet.ts";
import { sessionQuery } from "../lib/queries.ts";
import { machineStatus } from "../lib/status.ts";

/** Every signed-in page. Sends visitors to setup or sign-in first. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.setupRequired) throw redirect({ to: "/setup" });
    if (!session.user) throw redirect({ to: "/login" });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(fleetQuery),
  component: Layout,
});

const navLink =
  "flex h-7 min-w-0 items-center gap-2 rounded-[6px] px-2 text-ink-2 hover:bg-hover data-[status=active]:bg-selected data-[status=active]:text-ink";

function Layout() {
  useFleetStream();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const fleet = useFleet();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => call(api.logout.$post()),
    onSuccess: () => {
      queryClient.clear();
      void navigate({ to: "/login" });
    },
  });
  const user = session.user;
  if (!user) return null;
  const admin = user.role === "admin";

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-sidebar">
        <div className="px-4 pt-4 pb-3 text-[14px] font-semibold">Runyard</div>
        <nav className="scroll flex min-h-0 flex-1 flex-col gap-px px-2">
          <Link to="/" className={navLink} activeOptions={{ exact: true }}>
            Overview
            {fleet.alerts.length > 0 && (
              <span className="ml-auto font-mono text-[11px] text-warn tabular">
                {fleet.alerts.length}
              </span>
            )}
          </Link>
          <div className="mt-4 mb-1 flex items-center px-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
            Machines
            {admin && (
              <Link
                to="/machines/add"
                className="ml-auto text-[12px] font-normal tracking-normal normal-case hover:text-ink"
              >
                Add
              </Link>
            )}
          </div>
          {fleet.machines.length === 0 && (
            <p className="px-2 text-[12px] text-ink-3">No machines yet.</p>
          )}
          {fleet.machines.map((m) => {
            const status = machineStatus(m);
            return (
              <Link
                key={m.id}
                to="/machines/$id"
                params={{ id: m.id }}
                className={navLink}
                title={status.label}
              >
                <StatusDot tone={status.tone} hollow={status.hollow} />
                <span className="truncate">{m.name}</span>
              </Link>
            );
          })}
          {admin && fleet.discovered.length > 0 && (
            <Link to="/machines/add" className={`${navLink} text-[12px] text-ink-3`}>
              Other machines
              <span className="ml-auto font-mono text-[11px] tabular">
                {fleet.discovered.length}
              </span>
            </Link>
          )}
          {admin && (
            <>
              <div className="mt-4 mb-1 px-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                Settings
              </div>
              <Link to="/users" className={navLink}>
                Users
              </Link>
            </>
          )}
        </nav>
        <div className="flex flex-col gap-1 border-t border-line p-2">
          <Link to="/account" className={`${navLink} !h-auto flex-col !items-start !gap-0 py-1.5`}>
            <span className="max-w-full truncate text-ink">
              {user.username ?? user.tailscaleLogin}
            </span>
            <span className="text-[11.5px] text-ink-3">
              {admin ? "Admin" : "Viewer"}
              {session.via === "tailscale" ? " · via Tailscale" : ""}
            </span>
          </Link>
          <div className="flex items-center justify-between">
            <ThemeMenu />
            {session.via === "session" && (
              <Button
                variant="ghost"
                small
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
              >
                Sign out
              </Button>
            )}
          </div>
        </div>
      </aside>
      <main className="scroll min-w-0 flex-1 px-8 py-6">
        <Outlet />
      </main>
    </div>
  );
}
