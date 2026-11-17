import gsap from "gsap";
import { useEffect, useLayoutEffect, useRef } from "react";

const FLAPSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const shown = (ch: string) => (ch === " " ? " " : ch);

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

type Cell = HTMLElement & { _tl?: gsap.core.Timeline | null };

/** Sets a cell's resting face, both halves, with the flaps hidden. */
function face(cell: Cell, ch: string) {
  const [t, b, ft, fb] = cell.children as unknown as HTMLElement[];
  t!.firstElementChild!.textContent = b!.firstElementChild!.textContent = shown(ch);
  ft!.style.display = fb!.style.display = "none";
}

/**
 * One cell flipping from `from` to `to`, through `spins` random characters first: the top flap
 * folds down over the old character while the bottom flap unfolds with the new one.
 */
function flip(cell: Cell, from: string, to: string, delay: number, spins: number) {
  cell._tl?.kill();
  cell._tl = null;
  if (reducedMotion()) {
    face(cell, to);
    return;
  }
  const seq: string[] = [];
  for (let k = 0; k < spins; k++) seq.push(FLAPSET[(Math.random() * FLAPSET.length) | 0]!);
  seq.push(to);
  const [t, b, ft, fb] = cell.children as unknown as HTMLElement[];
  const tl = gsap.timeline({
    delay,
    onComplete: () => {
      cell._tl = null;
    },
  });
  let prev = from;
  for (const ch of seq) {
    const p = prev;
    tl.call(() => {
      t!.firstElementChild!.textContent = shown(ch);
      b!.firstElementChild!.textContent = shown(p);
      ft!.firstElementChild!.textContent = shown(p);
      fb!.firstElementChild!.textContent = shown(ch);
      ft!.style.display = fb!.style.display = "block";
      gsap.set(ft!, { rotationX: 0 });
      gsap.set(fb!, { rotationX: 90 });
    })
      .to(ft!, { rotationX: -90, duration: 0.055, ease: "power1.in" })
      .to(fb!, { rotationX: 0, duration: 0.065, ease: "power1.out" })
      .call(() => {
        b!.firstElementChild!.textContent = shown(ch);
        ft!.style.display = fb!.style.display = "none";
      });
    prev = ch;
  }
  cell._tl = tl;
}

/**
 * Text on a departure board's split-flap cells, as in the Timetable design: one cell per
 * character, upper case, padded to `cells`. On first paint every cell flips in from blank (after
 * `delay`, staggered left to right); later changes flip only the cells that change, quickly when
 * just a digit or two moves (a ticking time). A parent sizes cells with --flap-w, --flap-h,
 * --flap-fs and --flap-g. With reduced motion the text just appears.
 */
export function SplitFlap({
  text,
  cells,
  tone = "flap",
  delay = 0,
  className = "",
}: {
  text: string;
  cells: number;
  /** The characters' color: board white, signal yellow, moving orange, go green or dim. */
  tone?: "flap" | "signal" | "moving" | "go" | "dim";
  /** Seconds before the first paint's flip starts, to stagger rows and columns. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const chars = useRef<string[] | null>(null);
  const firstDelay = useRef(delay);
  const display = text.toUpperCase().slice(0, cells).padEnd(cells, " ");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const all = [...el.querySelectorAll<Cell>(":scope > i")];
    const first = chars.current === null || chars.current.length !== cells;
    if (first) {
      chars.current = Array.from({ length: cells }, () => " ");
      all.forEach((c) => face(c, " "));
    }
    const was = chars.current!;
    let changed = 0;
    for (let i = 0; i < cells; i++) if (was[i] !== display[i]) changed++;
    const spins = first ? 3 : changed <= 2 ? 0 : 2;
    all.forEach((cell, i) => {
      const to = display[i] ?? " ";
      const from = was[i] ?? " ";
      if (from === to) return;
      was[i] = to;
      flip(cell, from, to, (first ? firstDelay.current : 0) + i * (first ? 0.022 : 0.018), spins);
    });
  }, [display, cells]);

  // Stops any flip still running when the cells leave the page.
  useEffect(() => {
    const el = ref.current;
    return () => {
      el?.querySelectorAll<Cell>(":scope > i").forEach((c) => c._tl?.kill());
    };
  }, []);

  const color =
    tone === "signal"
      ? "text-tt-signal"
      : tone === "moving"
        ? "text-tt-loco"
        : tone === "go"
          ? "text-[#6fe39b]"
          : tone === "dim"
            ? "text-[#8e949e]"
            : "text-tt-flap";
  return (
    <span ref={ref} className={`flap ${color} ${className}`}>
      <span className="sr-only">{text}</span>
      {Array.from({ length: cells }, (_, i) => (
        <i key={i} aria-hidden>
          <span className="t">
            <b />
          </span>
          <span className="b">
            <b />
          </span>
          <span className="ft">
            <b />
          </span>
          <span className="fb">
            <b />
          </span>
        </i>
      ))}
    </span>
  );
}
