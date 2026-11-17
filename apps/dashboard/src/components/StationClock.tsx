import { useEffect, useRef } from "react";

const TICKS = Array.from({ length: 60 }, (_, i) => i);

/**
 * Timetable's station clock: a face whose second hand sweeps, and the time beside it. The hands
 * move through refs, not state, so the page doesn't re-render every frame. With reduced motion the
 * second hand steps once a second.
 */
export function StationClock({ size = 44, digital = true }: { size?: number; digital?: boolean }) {
  const hours = useRef<SVGRectElement>(null);
  const minutes = useRef<SVGRectElement>(null);
  const seconds = useRef<SVGGElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const secs = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let frame = 0;
    let timer = 0;
    const draw = () => {
      const d = new Date();
      const s = d.getSeconds() + (reduced ? 0 : d.getMilliseconds() / 1000);
      const m = d.getMinutes() + s / 60;
      const h = (d.getHours() % 12) + m / 60;
      hours.current?.setAttribute("transform", `rotate(${h * 30} 50 50)`);
      minutes.current?.setAttribute("transform", `rotate(${m * 6} 50 50)`);
      seconds.current?.setAttribute("transform", `rotate(${s * 6} 50 50)`);
      if (time.current) {
        time.current.textContent = d.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
      }
      if (secs.current) secs.current.textContent = `:${String(d.getSeconds()).padStart(2, "0")}`;
    };
    const loop = () => {
      draw();
      frame = requestAnimationFrame(loop);
    };
    if (reduced) {
      draw();
      timer = window.setInterval(draw, 1000);
    } else loop();
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, []);

  return (
    <span className="flex shrink-0 items-center gap-2.5">
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden className="shrink-0">
        <circle
          cx="50"
          cy="50"
          r="47"
          fill="var(--tt-card)"
          stroke="var(--tt-ink)"
          strokeWidth="2"
        />
        {TICKS.map((i) => (
          <line
            key={i}
            x1="50"
            y1="5"
            x2="50"
            y2={i % 5 === 0 ? 15 : 9}
            stroke="var(--tt-ink)"
            strokeWidth={i % 5 === 0 ? 3.6 : 1.3}
            transform={`rotate(${i * 6} 50 50)`}
          />
        ))}
        <rect ref={hours} x="47" y="24" width="6" height="32" rx="1" fill="var(--tt-ink)" />
        <rect ref={minutes} x="47.9" y="10" width="4.2" height="46" rx="1" fill="var(--tt-ink)" />
        <g ref={seconds}>
          <line x1="50" y1="64" x2="50" y2="17" stroke="var(--tt-loco)" strokeWidth="1.6" />
          <rect x="46.5" y="12" width="7" height="7" rx="1" fill="var(--tt-loco)" />
        </g>
        <circle cx="50" cy="50" r="2.6" fill="var(--tt-loco)" />
      </svg>
      {digital && (
        <span className="font-board text-[22px] leading-none font-bold tabular" aria-hidden>
          <span ref={time} />
          <span ref={secs} className="text-[14px] font-medium text-tt-ink-3" />
        </span>
      )}
    </span>
  );
}
