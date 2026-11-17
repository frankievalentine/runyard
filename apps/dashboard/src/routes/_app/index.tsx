import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { Departures } from "../../components/board/Departures.tsx";
import { Notices } from "../../components/board/Notices.tsx";
import { Platforms } from "../../components/board/Platforms.tsx";
import { TrafficCalendar } from "../../components/board/TrafficCalendar.tsx";
import { EventTimeline } from "../../components/machines.tsx";
import { SetupBanner } from "../../components/SetupBanner.tsx";
import { useYard } from "../../lib/yard.ts";
import { sessionQuery } from "../../lib/queries.ts";

export const Route = createFileRoute("/_app/")({
  component: Board,
});

/** Below 1024px the Board stacks its panels, phone style. */
function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia("(max-width: 1023px)");
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(max-width: 1023px)").matches,
  );
}

/**
 * Timetable's Board: the departure board of running and waiting jobs over the traffic calendar,
 * beside the notices over the platforms. The departure board takes whatever height is left. Until
 * Getting started is done, its route line leads; a new install shows every panel's empty state.
 */
function Board() {
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const admin = session.user?.role === "admin";
  const narrow = useNarrow();
  return (
    <div className="flex flex-col gap-[18px]">
      {admin && <SetupBanner />}
      {narrow ? (
        <>
          <Departures view={view} phone />
          <Notices view={view} />
          <Platforms view={view} />
          <TrafficCalendar phone />
        </>
      ) : (
        // Two columns that share their height: the departure board and the platforms grow to fill
        // theirs, so the bottoms line up, while the traffic calendar keeps its content's height.
        <div className="grid grid-cols-[minmax(0,1fr)_372px] gap-[18px]">
          <div className="flex min-w-0 flex-col gap-[18px] [&>section:first-child]:flex-1">
            <Departures view={view} />
            <TrafficCalendar />
          </div>
          <div className="flex min-w-0 flex-col gap-[18px] [&>section:last-child]:flex-1">
            <Notices view={view} />
            <Platforms view={view} />
          </div>
        </div>
      )}
      {view.machines.length > 0 && <EventTimeline title="Recent activity" />}
    </div>
  );
}
