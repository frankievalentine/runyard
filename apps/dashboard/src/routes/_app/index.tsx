import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Departures } from "../../components/board/Departures.tsx";
import { Notices } from "../../components/board/Notices.tsx";
import { Platforms } from "../../components/board/Platforms.tsx";
import { TrafficCalendar } from "../../components/board/TrafficCalendar.tsx";
import { EventTimeline } from "../../components/machines.tsx";
import { SetupBanner } from "../../components/SetupBanner.tsx";
import { useYard } from "../../lib/yard.ts";
import { EXTRA_WIDE, useMediaQuery } from "../../lib/media.ts";
import { sessionQuery } from "../../lib/queries.ts";

export const Route = createFileRoute("/_app/")({
  component: Board,
});

/**
 * Timetable's Board: the departure board of running and waiting jobs over the traffic calendar,
 * beside the notices over the platforms. The departure board takes whatever height is left. Until
 * Getting started is done, its route line leads; a new install shows every panel's empty state.
 * Below 1024px it stacks, phone style. From 1800px, recent activity takes a third column, so
 * the whole Board fits without scrolling.
 */
function Board() {
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const admin = session.user?.role === "admin";
  const narrow = useMediaQuery("(max-width: 1023px)");
  const wide = useMediaQuery(EXTRA_WIDE);
  const activity = view.machines.length > 0;
  return (
    // With the third column, the Board fills the window's height: the departure board and the
    // platforms grow into it, and the activity list scrolls.
    <div className={`flex flex-col gap-[18px] ${wide && activity ? "flex-1" : ""}`}>
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
        <div
          className={`grid gap-[18px] ${wide && activity ? "flex-1 grid-cols-[minmax(0,1fr)_372px_380px]" : "grid-cols-[minmax(0,1fr)_372px]"}`}
        >
          <div className="flex min-w-0 flex-col gap-[18px] [&>section:first-child]:flex-1">
            <Departures view={view} />
            <TrafficCalendar />
          </div>
          <div className="flex min-w-0 flex-col gap-[18px] [&>section:last-child]:flex-1">
            <Notices view={view} />
            <Platforms view={view} />
          </div>
          {wide && activity && (
            // Takes the row's height rather than setting it: the list scrolls inside.
            <div className="relative min-w-0">
              <EventTimeline title="Recent activity" fill />
            </div>
          )}
        </div>
      )}
      {activity && !wide && <EventTimeline title="Recent activity" />}
    </div>
  );
}
