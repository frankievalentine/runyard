import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useMediaQuery } from "../lib/media.ts";
import { CopyFeedback } from "../components/CopyValue.tsx";
import { Button } from "../components/form.tsx";
import { PhoneHeader, TabBar } from "../components/PhoneNav.tsx";
import { Sidebar } from "../components/Sidebar.tsx";
import { ErrorText } from "../components/ui.tsx";
import { yardQuery, useYard, useYardStream } from "../lib/yard.ts";
import { useCheckNow } from "../lib/check.ts";
import { phoneTabFor, sectionFor } from "../lib/nav.ts";
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

/**
 * Timetable's window: the floating sidebar beside the page on desktop (a header and a tab bar on
 * phones). Banners sit above the page, inside its column.
 */
function Layout() {
  const live = useYardStream();
  const view = useYard();
  const demo = useQuery(healthQuery).data?.demo === true;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = sectionFor(pathname);
  // Below 1024px: the phone layout, with the sections in a tab bar along the bottom.
  const narrow = useMediaQuery("(max-width: 1023px)");
  const scrollRef = useRef<HTMLElement>(null);
  const check = useCheckNow();
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [pathname]);

  return (
    <CopyFeedback>
      <div
        className={`flex h-full bg-tt-paper font-ui text-tt-ink ${narrow ? "flex-col" : "flex-row"}`}
      >
        {narrow ? (
          <PhoneHeader view={view} />
        ) : (
          <Sidebar
            view={view}
            section={section}
            demo={demo}
            checking={check.isPending}
            onCheck={() => check.mutate()}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Phones check from More; on desktop Check now is in the sidebar. */}
          {check.isError && (
            <div className="border-b border-tt-rule bg-tt-card px-6 py-2">
              <ErrorText error={check.error} />
            </div>
          )}
          <OfflineBar live={live} at={view.generatedAt} />
          <UpdateBar />
          {/* On desktop the sidebar's status line already says "Demo data". */}
          {demo && narrow && <DemoBanner />}
          <main ref={scrollRef} className="scroll min-h-0 flex-1">
            <div
              className={`mx-auto flex min-h-full w-full flex-col px-4 py-6 sm:px-6 sm:py-8 lg:pl-4 xl:px-8 xl:pl-5 ${pageWidth[section]}`}
            >
              <Outlet />
            </div>
          </main>
        </div>
        {narrow && <TabBar view={view} tab={phoneTabFor(pathname)} />}
      </div>
    </CopyFeedback>
  );
}

/**
 * How wide each section's pages get. From 1800px (`3xl:`) every section uses the room: the Board
 * and Settings with a third column, the others with wider tables and side columns.
 */
const pageWidth: Record<ReturnType<typeof sectionFor>, string> = {
  board: "max-w-[1440px] 3xl:max-w-[1880px]",
  jobs: "max-w-[1200px] 3xl:max-w-[1880px]",
  machines: "max-w-[1200px] 3xl:max-w-[1880px]",
  pools: "max-w-[1200px] 3xl:max-w-[1880px]",
  settings: "max-w-[1200px] 3xl:max-w-[1880px]",
};

/** Whether the device says it's online, following changes. */
function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("online", onChange);
      window.addEventListener("offline", onChange);
      return () => {
        window.removeEventListener("online", onChange);
        window.removeEventListener("offline", onChange);
      };
    },
    () => navigator.onLine,
  );
}

/**
 * Shows when the device is offline or Runyard stopped answering for a few seconds: the page is the
 * last view Runyard sent, and when that was. Mostly for the installed app away from the tailnet.
 */
function OfflineBar({ live, at }: { live: boolean; at: number }) {
  const online = useOnline();
  const [lost, setLost] = useState(false);
  useEffect(() => {
    if (live && online) {
      setLost(false);
      return;
    }
    // A reconnect within a few seconds isn't worth a banner.
    const t = window.setTimeout(() => setLost(true), online ? 5_000 : 0);
    return () => window.clearTimeout(t);
  }, [live, online]);
  if (!lost) return null;
  const time = new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-tt-rule bg-tt-warn-bg px-5 py-2 text-[12.5px] text-tt-warn-ink"
    >
      <span className="font-bold">{online ? "Can't reach Runyard" : "Offline"}</span>
      <span className="min-w-0 flex-1">
        Showing what it last sent, at {time}. This page catches up when it's back.
      </span>
    </div>
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
