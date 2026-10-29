import type { YardView } from "@runyard/core";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, call } from "../api.ts";
import { CopyFeedback } from "../components/CopyValue.tsx";
import { Button } from "../components/form.tsx";
import { Icon } from "../components/icons.tsx";
import { Sidebar } from "../components/Sidebar.tsx";
import { ErrorText, TimeAgo } from "../components/ui.tsx";
import { yardQuery, useYard, useYardStream } from "../lib/yard.ts";
import { filterYard, flattenNav, navKey, type NavItem } from "../lib/nav.ts";
import { healthQuery, sessionQuery } from "../lib/queries.ts";

/** Every signed-in page. Sends visitors to setup or sign-in first. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.setupRequired) throw redirect({ to: "/setup" });
    if (!session.user) throw redirect({ to: "/login" });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(yardQuery),
  component: Layout,
});

/** Which collapsible sidebar groups are open, remembered per browser. */
function useOpenGroup(key: string): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const setOpen = (next: boolean) => {
    setOpenState(next);
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // Non-essential.
    }
  };
  return [open, setOpen];
}

/** aarondfrancis/fleet's window: sidebar, a header with breadcrumbs and Check now, and the page. */
function Layout() {
  useYardStream();
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const health = useQuery(healthQuery);
  const demo = health.data?.demo === true;
  const admin = session.user?.role === "admin";
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [query, setQuery] = useState("");
  const [otherOpen, setOtherOpen] = useOpenGroup("runyard.otherMachinesOpen");
  const [runnersOpen, setRunnersOpen] = useOpenGroup("runyard.runnersOpen");
  // Below 1024px the sidebar is a drawer over the page, opened from the top bar.
  const narrow = useMediaQuery("(max-width: 1023px)");
  const [drawer, setDrawer] = useState(false);
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    // Following a link closes it.
    setDrawerPath(pathname);
    setDrawer(false);
  }

  const filtered = useMemo(() => filterYard(view, query), [view, query]);
  const nav = useMemo(
    () =>
      flattenNav(filtered, query.trim() !== "" || otherOpen, query.trim() !== "" || runnersOpen),
    [filtered, query, otherOpen, runnersOpen],
  );
  const selected = selectedKey(pathname);

  // aarondfrancis/fleet's keyboard navigation: ↑/↓ through the sidebar, Home for the overview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement
      )
        return;
      if (e.key === "Escape" && drawer) {
        setDrawer(false);
        return;
      }
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        document.querySelector("[role=dialog], [role=menu]")
      )
        return;
      let next: NavItem | undefined;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const i = nav.findIndex((item) => navKey(item) === selected);
        const step = e.key === "ArrowDown" ? 1 : -1;
        next = nav[i < 0 ? 0 : Math.max(0, Math.min(nav.length - 1, i + step))];
      } else if (e.key === "Home") next = nav[0];
      if (!next) return;
      e.preventDefault();
      void navigate({ to: next.path, params: next.params });
      document
        .querySelector(`[data-nav="${CSS.escape(navKey(next))}"]`)
        ?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, selected, navigate, drawer]);

  return (
    <CopyFeedback>
      <div className="flex h-full">
        {narrow && drawer && (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-30 bg-black/40"
            onClick={() => setDrawer(false)}
          />
        )}
        <div
          className={`fixed inset-y-0 left-0 z-40 h-full transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 lg:transition-none ${drawer ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`}
          inert={narrow && !drawer}
        >
          <Sidebar
            view={view}
            filtered={filtered}
            query={query}
            setQuery={setQuery}
            otherOpen={otherOpen}
            setOtherOpen={setOtherOpen}
            runnersOpen={runnersOpen}
            setRunnersOpen={setRunnersOpen}
            selected={selected}
            admin={admin}
            demo={demo}
          />
        </div>
        <Main
          view={view}
          pathname={pathname}
          demo={demo}
          onMenu={narrow ? () => setDrawer(true) : undefined}
        />
      </div>
    </CopyFeedback>
  );
}

function Main({
  view,
  pathname,
  demo,
  onMenu,
}: {
  view: YardView;
  pathname: string;
  demo: boolean;
  /** Opens the navigation drawer, on narrow screens. */
  onMenu?: () => void;
}) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const check = useMutation({
    mutationFn: async () => (await call(api.check.$post())) as YardView,
    onSuccess: (next) => queryClient.setQueryData(yardQuery.queryKey, next),
  });
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [pathname]);
  const crumbs = breadcrumbs(pathname, view);

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-bg">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4 xl:px-6">
        {onMenu && (
          <button
            type="button"
            aria-label="Open navigation"
            onClick={onMenu}
            className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
          >
            <Icon name="menu" size={16} />
          </button>
        )}
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-1 text-[13px]">
            {crumbs.map((crumb, i) => (
              // On a phone, only where you are; the drawer has the rest.
              <li
                key={i}
                className={`min-w-0 items-center gap-1 ${i < crumbs.length - 1 ? "hidden sm:flex" : "flex"}`}
              >
                {i > 0 && (
                  <span className="hidden shrink-0 text-ink-3 sm:inline">
                    <Icon name="chevron" size={13} />
                  </span>
                )}
                {crumb.to && i < crumbs.length - 1 ? (
                  <Link to={crumb.to} className="truncate text-ink-2 hover:text-ink">
                    {crumb.label}
                  </Link>
                ) : i < crumbs.length - 1 ? (
                  <span className="truncate text-ink-2">{crumb.label}</span>
                ) : (
                  <span className="truncate font-medium" aria-current="page" title={crumb.label}>
                    {crumb.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <span
          className="hidden shrink-0 text-[12px] text-ink-2 tabular lg:inline"
          title={new Date(view.generatedAt).toLocaleString()}
        >
          {demo ? (
            "Demo data"
          ) : (
            <>
              Updated <TimeAgo at={view.generatedAt} />
            </>
          )}
        </span>
        <Button small variant="primary" disabled={check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? "Checking…" : "Check now"}
        </Button>
      </header>
      {check.isError && (
        <div className="border-b border-line px-6 py-2">
          <ErrorText error={check.error} />
        </div>
      )}
      <UpdateBar />
      {demo && <DemoBanner />}
      <div ref={scrollRef} className="scroll min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 xl:px-8">
          <Outlet />
        </div>
      </div>
    </main>
  );
}

/**
 * Shows once the server is serving a newer dashboard than this tab loaded, such
 * as after an upgrade or restart: the open tab keeps running its old code.
 */
function UpdateBar() {
  const build = useQuery(healthQuery).data?.build ?? null;
  const [loaded, setLoaded] = useState<string | null>(null);
  if (build && loaded === null) setLoaded(build);
  if (!build || !loaded || build === loaded) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-accent/30 bg-accent/10 px-5 py-2 text-[12.5px]">
      <span className="min-w-0 flex-1">Runyard was updated. Reload to use the new version.</span>
      <Button small variant="primary" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}

/** aarondfrancis/fleet's banner. Demo is a server mode here: on a shared server, one viewer can't switch it for everyone. */
function DemoBanner() {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-warn/30 bg-warn/10 px-5 py-2 text-[12px]">
      <span className="font-semibold tracking-wide text-warn">DEMO DATA</span>
      <span className="min-w-0 flex-1 truncate text-ink-2">
        Fictional machines answered by a stand-in. Nothing real is contacted.
      </span>
    </div>
  );
}

/** The sidebar row a path belongs to. */
function selectedKey(pathname: string): string {
  const machine = /^\/machines\/([^/]+)$/.exec(pathname);
  if (machine && machine[1] !== "add") return `/machines/$id:${machine[1]}`;
  const peer = /^\/peers\/([^/]+)$/.exec(pathname);
  if (peer) return `/peers/$nodeId:${peer[1]}`;
  const pool = /^\/pools\/([^/]+)$/.exec(pathname);
  if (pool && pool[1] !== "new") return `/pools/$id:${pool[1]}`;
  const runner = /^\/runners\/([^/]+)$/.exec(pathname);
  if (runner) return `/runners/$key:${decodeURIComponent(runner[1]!)}`;
  return pathname === "/ignored" ? "/ignored" : pathname === "/" ? "/" : pathname;
}

function breadcrumbs(pathname: string, view: YardView): { label: string; to?: string }[] {
  const yard = { label: "Yard", to: "/" };
  // Machines, pools and runners have no list page of their own (the sidebar lists them), so
  // their section is a label rather than a link.
  const machine = /^\/machines\/([^/]+)$/.exec(pathname)?.[1];
  if (machine === "add") return [yard, { label: "Machines" }, { label: "Add machines" }];
  if (machine) {
    return [
      yard,
      { label: "Machines" },
      { label: view.machines.find((m) => m.id === machine)?.name ?? "Machine" },
    ];
  }
  const peer = /^\/peers\/([^/]+)$/.exec(pathname)?.[1];
  if (peer) {
    return [
      yard,
      { label: "Tailnet devices" },
      { label: view.discovered.find((p) => p.nodeId === peer)?.name ?? "Machine" },
    ];
  }
  const pool = /^\/pools\/([^/]+)$/.exec(pathname)?.[1];
  if (pool === "new") return [yard, { label: "Pools" }, { label: "New pool" }];
  if (pool) {
    return [
      yard,
      { label: "Pools" },
      { label: view.pools.pools.find((p) => p.id === pool)?.name ?? "Pool" },
    ];
  }
  const runner = /^\/runners\/([^/]+)$/.exec(pathname)?.[1];
  if (runner) {
    const key = decodeURIComponent(runner);
    return [
      yard,
      { label: "Runners" },
      { label: view.runners.find((r) => r.key === key)?.name ?? "Runner" },
    ];
  }
  const pages: Record<string, string> = {
    "/queue": "Queued jobs",
    "/boat": "boat.dev",
    "/": "Yard overview",
    "/ignored": "Ignored machines",
  };
  const settings: Record<string, { label: string; parent?: string }> = {
    "/settings/account": { label: "Account" },
    "/settings/connections": { label: "Connections" },
    "/settings/users": { label: "Users" },
    "/settings/github": { label: "GitHub", parent: "Connections" },
    "/settings/forgejo": { label: "Forgejo", parent: "Connections" },
  };
  const s = settings[pathname];
  if (s) {
    return [
      { label: "Settings", to: "/settings/account" },
      ...(s.parent ? [{ label: s.parent, to: "/settings/connections" }] : []),
      { label: s.label },
    ];
  }
  return [yard, { label: pages[pathname] ?? "" }];
}

/** Whether a media query matches, following changes such as a window resized past it. */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}
