import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { api, call } from "../api.ts";
import { Button } from "../components/form.tsx";
import { ThemeMenu } from "../components/ThemeMenu.tsx";
import { sessionQuery } from "../lib/queries.ts";

/** Every signed-in page. Sends visitors to setup or sign-in first. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.setupRequired) throw redirect({ to: "/setup" });
    if (!session.user) throw redirect({ to: "/login" });
  },
  component: Layout,
});

const navLink =
  "flex h-7 items-center rounded-[6px] px-2 text-ink-2 hover:bg-hover data-[status=active]:bg-selected data-[status=active]:text-ink";

function Layout() {
  const { data: session } = useSuspenseQuery(sessionQuery);
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

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-sidebar">
        <div className="px-4 pt-4 pb-3 text-[14px] font-semibold">Runyard</div>
        <nav className="flex flex-col gap-px px-2">
          <Link to="/" className={navLink} activeOptions={{ exact: true }}>
            Overview
          </Link>
          {user.role === "admin" && (
            <Link to="/users" className={navLink}>
              Users
            </Link>
          )}
        </nav>
        <div className="mt-auto flex flex-col gap-1 border-t border-line p-2">
          <Link to="/account" className={`${navLink} flex-col items-start !h-auto py-1.5`}>
            <span className="truncate text-ink">{user.username ?? user.tailscaleLogin}</span>
            <span className="text-[11.5px] text-ink-3">
              {user.role === "admin" ? "Admin" : "Viewer"}
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
