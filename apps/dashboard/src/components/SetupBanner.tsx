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
      className="grid grid-cols-1 items-center gap-x-8 gap-y-4 rounded-xl border border-tt-rule bg-tt-card px-5 py-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_auto]"
    >
      <div className="min-w-0">
        <p className="text-[11px] font-bold tracking-[.1em] text-tt-ink-3 uppercase">
          Getting started · {stops.length} stops
        </p>
        <h2 id="setup-title" className="mt-1 text-[19px] font-extrabold [font-stretch:85%]">
          Set up your yard
        </h2>
        <p className="mt-1 text-[12.5px] text-tt-ink-2">{stops[current]?.detail}</p>
      </div>
      <div className="min-w-0 px-2">
        <RouteLine stops={stops} current={current} compact />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="h-9 rounded-lg border border-tt-rule-2 px-3.5 text-[13px] font-semibold hover:bg-tt-hover"
        >
          Skip for now
        </button>
        <Link
          to="/start"
          className="inline-flex h-9 items-center rounded-lg bg-tt-inv px-4 text-[13px] font-semibold text-tt-on-inv hover:opacity-90"
        >
          {started ? "Continue" : "Start"}
        </Link>
      </div>
    </section>
  );
}
