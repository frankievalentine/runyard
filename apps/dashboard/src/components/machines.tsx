import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { EVENTS_PAGE, eventsQuery } from "../lib/yard.ts";
import { formatClock, timeAgo } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";
import { eventStyle } from "../lib/status.ts";
import { Button } from "./form.tsx";
import { Panel } from "./tt.tsx";
import { EmptyLine, ErrorText, StatusDot } from "./ui.tsx";

/** Observed history, newest first, a page at a time. */
export function EventTimeline({
  machineId,
  title = "History",
  fill = false,
}: {
  machineId?: string;
  title?: string;
  /** Fills a positioned parent, with the list scrolling inside, as in the Board's third column. */
  fill?: boolean;
}) {
  // The `before` cursor of each page back from the newest; empty on the first page.
  const [cursors, setCursors] = useState<number[]>([]);
  const events = useQuery(eventsQuery(machineId, cursors.at(-1)));
  const navigate = useNavigate();
  const now = useNow();
  const page = events.data?.slice(0, EVENTS_PAGE) ?? [];
  const older = (events.data?.length ?? 0) > EVENTS_PAGE;
  return (
    <Panel
      title={title}
      className={fill ? "absolute inset-0 flex flex-col" : "mt-[18px]"}
      action={
        (cursors.length > 0 || older) && (
          <div className="flex items-center gap-1.5">
            <Button
              small
              disabled={cursors.length === 0}
              onClick={() => setCursors(cursors.slice(0, -1))}
            >
              Newer
            </Button>
            <Button
              small
              disabled={!older}
              onClick={() => setCursors([...cursors, page.at(-1)!.id])}
            >
              Older
            </Button>
          </div>
        )
      }
    >
      <div
        className={`border-t border-tt-rule ${fill ? "scroll min-h-0 flex-1" : "overflow-hidden"}`}
      >
        {events.error && <ErrorText className="px-4 py-3" error={events.error} />}
        {events.data?.length === 0 && <EmptyLine>No events yet.</EmptyLine>}
        <ul className="divide-y divide-line">
          {page.map((e) => {
            const style = eventStyle[e.kind as keyof typeof eventStyle] ?? {
              label: e.kind,
              tone: "muted" as const,
            };
            return (
              <li key={e.id} className="flex items-start gap-3 px-4 py-2.5 text-[12.5px]">
                <span className="mt-1.5">
                  <StatusDot tone={style.tone} size={7} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {!machineId && (
                      <button
                        className="font-medium hover:underline"
                        onClick={() =>
                          void navigate({ to: "/machines/$id", params: { id: e.machineId } })
                        }
                      >
                        {e.machineName}
                      </button>
                    )}
                    <span className={machineId ? "font-medium" : "text-ink-2"}>{style.label}</span>
                  </div>
                  <p className="text-[12px] break-words text-ink-2">{e.detail}</p>
                </div>
                <span
                  className="shrink-0 text-[11.5px] text-ink-3 tabular"
                  title={new Date(e.at).toLocaleString()}
                >
                  {now - e.at < 86_400_000 ? formatClock(e.at) : timeAgo(e.at, now)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}
