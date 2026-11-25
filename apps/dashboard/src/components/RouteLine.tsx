import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";
import { Icon } from "./icons.tsx";

export type Stop = { id: string; label: string; done: boolean };

/**
 * Getting started as a line with stops, like a route on a station map: done stops filled, the
 * current one an orange dot with a soft ring. The filled stretch of line follows the current stop
 * (GSAP). Done stops can be selected to look back at them. `dark` draws it on a board's black.
 */
export function RouteLine({
  stops,
  current,
  onSelect,
  dark = false,
  compact = false,
  phoneLabels = true,
}: {
  stops: Stop[];
  current: number;
  onSelect?: (index: number) => void;
  dark?: boolean;
  compact?: boolean;
  /** False hides the labels on phones, where the stop is named in a sentence instead. */
  phoneLabels?: boolean;
}) {
  const fill = useRef<HTMLSpanElement>(null);
  const share = stops.length > 1 ? (current / (stops.length - 1)) * 100 : 0;

  useLayoutEffect(() => {
    const el = fill.current;
    if (!el) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced) {
      el.style.width = `${share}%`;
      return;
    }
    const tween = gsap.to(el, { width: `${share}%`, duration: 0.8, ease: "power2.inOut" });
    return () => {
      tween.kill();
    };
  }, [share]);

  const muted = dark ? "text-[#9aa0a9]" : "text-tt-ink-3";
  const line = dark ? "bg-[#343841]" : "bg-tt-rule-2";
  return (
    <ol
      // A size container, so each label can be capped to its share of the line (below).
      className={`relative flex justify-between [container-type:inline-size] ${compact ? "pb-5" : "pb-7"} ${phoneLabels ? "" : "max-lg:pb-0"}`}
    >
      {/* The line runs between the first and last stop's centers. */}
      <span
        aria-hidden
        className={`absolute top-[7px] right-[7px] left-[7px] h-[2px] rounded ${line}`}
      >
        <span ref={fill} className="block h-full w-0 rounded bg-tt-loco" />
      </span>
      {stops.map((s, i) => {
        const on = i === current;
        const dot = on
          ? "border-tt-loco bg-tt-loco shadow-[0_0_0_5px_rgba(232,115,42,.22)]"
          : s.done
            ? "border-tt-loco bg-tt-loco text-white"
            : dark
              ? "border-[#5b616c] bg-tt-board"
              : "border-tt-rule-2 bg-tt-card";
        const label = (
          <>
            <span
              className={`relative z-[1] flex size-4 items-center justify-center rounded-full border-2 ${dot}`}
            >
              {s.done && !on && <Icon name="check" size={9} />}
            </span>
            <span
              // Capped to the room it has, so a tight line wraps a label rather than running it into
              // the next. An end label hangs off one side of its stop and a middle one is centered, so
              // an end label's share plus half a middle one's (0.62 + 0.76 / 2) is exactly one gap.
              style={{
                maxWidth: `min(11rem, calc(100cqw / ${Math.max(stops.length - 1, 1)} * ${
                  i === 0 || i === stops.length - 1 ? 0.62 : 0.76
                }))`,
              }}
              className={`absolute top-6 w-max text-[12px] leading-tight font-semibold ${
                on ? (dark ? "text-tt-flap" : "text-tt-ink") : muted
              } ${i === 0 ? "left-0 text-left" : i === stops.length - 1 ? "right-0 text-right" : "left-1/2 -translate-x-1/2 text-center"} ${
                !on ? "max-sm:hidden" : ""
              } ${phoneLabels ? "" : "max-lg:hidden"}`}
            >
              {s.label}
            </span>
          </>
        );
        return (
          <li key={s.id} className="relative" aria-current={on ? "step" : undefined}>
            {onSelect && (s.done || on) ? (
              <button
                type="button"
                onClick={() => onSelect(i)}
                className="flex"
                aria-label={`${s.label}${s.done ? ", done" : ""}`}
              >
                {label}
              </button>
            ) : (
              <span className="flex" aria-label={`${s.label}${s.done ? ", done" : ""}`}>
                {label}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
