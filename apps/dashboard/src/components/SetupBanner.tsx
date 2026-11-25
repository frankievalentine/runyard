import { Link } from "@tanstack/react-router";
import { useJobsSeen } from "../lib/calendar.ts";
import { startStops } from "../lib/setup.ts";
import { useYard } from "../lib/yard.ts";
import { RouteLine } from "./RouteLine.tsx";
import { useDismissed } from "./SetupChecklist.tsx";

/**
 * The Board's "Set up your yard" band while Getting started has stops left: the route line, the
 * next stop in a sentence, Start (or Continue) and Skip for now. Skipping hides it in every
 * browser; Settings ▸ Account brings it back.
 */
export function SetupBanner() {
  const view = useYard();
  const jobsSeen = useJobsSeen();
  const { dismissed, setDismissed } = useDismissed();
  const { stops, current, finished } = startStops(view, jobsSeen);
  if (dismissed || finished) return null;
  const started = stops.some((s) => s.done);
  return (
    <section
      aria-labelledby="setup-title"
      // Three across only on wide screens; until then the route gets its own full-width row under
      // the title and buttons, so its stop labels have room (beside the sidebar at 1280px it had
      // about 400px for five).
      className="grid grid-cols-1 items-center gap-x-8 gap-y-4 rounded-xl border border-tt-rule bg-tt-card px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] 2xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_auto]"
    >
      <div className="min-w-0">
        <p className="text-[11px] font-bold tracking-[.1em] text-tt-ink-3 uppercase">
          Getting started · {stops.length} stops
        </p>
        <h2 id="setup-title" className="mt-1 text-[19px] font-extrabold [font-stretch:85%]">
          Set up your yard
        </h2>
        <p className="mt-1 text-[12.5px] text-tt-ink-2">
          {started
            ? stops[current]?.detail
            : "Connect your forge, add a machine and create a pool. Nothing changes on a machine until you review it."}
        </p>
      </div>
      <div className="min-w-0 px-2 lg:col-span-2 lg:row-start-2 lg:pt-1 2xl:col-span-1 2xl:row-start-auto 2xl:pt-0">
        <RouteLine stops={stops} current={current} compact phoneLabels={false} />
        {/* Phones name the stop in a sentence; the line has no room for its labels. */}
        <p className="mt-3 text-[13px] text-tt-ink-2 lg:hidden">
          {started ? "Next stop" : "First stop"}:{" "}
          <b className="font-bold text-tt-ink">{stops[current]?.label}</b>
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="h-9 rounded-lg border border-tt-rule-2 px-3.5 text-[13px] font-semibold hover:bg-tt-hover max-lg:h-11 max-lg:flex-1"
        >
          Skip for now
        </button>
        <Link
          to="/start"
          className="inline-flex h-9 items-center justify-center rounded-lg bg-tt-inv px-4 text-[13px] font-semibold text-tt-on-inv hover:opacity-90 max-lg:h-11 max-lg:flex-[2]"
        >
          {started ? "Continue" : "Start"}
        </Link>
      </div>
    </section>
  );
}
