import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { Departures } from "../../components/board/Departures.tsx";
import { Notices } from "../../components/board/Notices.tsx";
import { Platforms } from "../../components/board/Platforms.tsx";
import { TrafficCalendar } from "../../components/board/TrafficCalendar.tsx";
import { EventTimeline } from "../../components/machines.tsx";
import { forgesConnected } from "../../components/runners.tsx";
import { Card, EmptyLine, PageHeader } from "../../components/ui.tsx";
import { SetupChecklist } from "../../components/SetupChecklist.tsx";
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
 * Timetable's Board: the departure board of running and waiting jobs beside the notices, and the
 * traffic calendar beside the platforms, each pair sharing its edges. Setup comes first until done.
 */
function Board() {
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const admin = session.user?.role === "admin";
  const narrow = useNarrow();
  if (view.machines.length === 0 && !forgesConnected(view)) {
    return (
      <div className="mx-auto max-w-2xl pt-4">
        <PageHeader
          title="Welcome to Runyard"
          subtitle="Runyard watches the machines that run your CI over SSH and your tailnet, and installs runners on them only after you review the changes."
        />
        {admin ? (
          <SetupChecklist />
        ) : (
          <Card className="mt-6">
            <EmptyLine>An admin hasn't added any machines yet.</EmptyLine>
          </Card>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[18px]">
      {admin && <SetupChecklist />}
      {narrow ? (
        <>
          <Departures view={view} phone />
          <Notices view={view} />
          <Platforms view={view} />
          <TrafficCalendar phone />
        </>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_372px] grid-rows-[auto_auto] gap-[18px]">
          <Departures view={view} />
          <Notices view={view} besideBoard />
          <TrafficCalendar />
          <Platforms view={view} besideBoard />
        </div>
      )}
      <EventTimeline title="Recent activity" />
    </div>
  );
}
