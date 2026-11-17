import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Icon } from "../../components/icons.tsx";
import { MachineList, TailnetList, UnassignedList } from "../../components/YardLists.tsx";
import { filterYard } from "../../lib/nav.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { useYard } from "../../lib/yard.ts";

export const Route = createFileRoute("/_app/machines/")({
  component: Machines,
});

/** Every machine with its runners, runners Runyard doesn't manage, and devices on the tailnet. */
function Machines() {
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const admin = session.user?.role === "admin";
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterYard(view, query), [view, query]);
  const searching = query.trim() !== "";
  const nothing =
    searching &&
    !filtered.machines.length &&
    !filtered.discovered.length &&
    !filtered.ignored.length &&
    !filtered.runners.length;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-ui text-[28px] leading-none font-extrabold [font-stretch:85%]">
            Machines
          </h1>
          <p className="mt-1.5 text-[13px] text-tt-ink-2">
            {view.machines.length} {view.machines.length === 1 ? "machine" : "machines"} ·{" "}
            {view.summary.runners} {view.summary.runners === 1 ? "runner" : "runners"}
          </p>
        </div>
        <label className="relative block w-full sm:w-64">
          <span className="sr-only">Filter machines and runners</span>
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-tt-ink-3">
            <Icon name="search" />
          </span>
          <input
            className="input !h-9 !rounded-lg !border-tt-rule-2 !bg-tt-card !pl-8 text-[13px]"
            placeholder="Filter by name, address, OS or label"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
          />
        </label>
      </header>
      <MachineList view={view} filtered={filtered} admin={admin} searching={searching} />
      <UnassignedList filtered={filtered} />
      <TailnetList filtered={filtered} />
      {nothing && <p className="text-tt-ink-2">Nothing matches “{query}”.</p>}
    </div>
  );
}
