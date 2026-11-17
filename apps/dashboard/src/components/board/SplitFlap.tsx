import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";

const SCRAMBLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Text on a departure board's split-flap cells: one cell per character, upper case, padded to
 * `cells`. A parent sizes the cells with --flap-w, --flap-h and --flap-fs. When the text changes, each changed cell flips through a few characters to its new one
 * (GSAP), staggered left to right. With reduced motion the new text just appears.
 */
export function SplitFlap({
  text,
  cells,
  tone = "flap",
  className = "",
}: {
  text: string;
  cells: number;
  /** The characters' color: board white, signal yellow, moving orange, go green or dim. */
  tone?: "flap" | "signal" | "moving" | "go" | "dim";
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<string>("");
  const display = text.toUpperCase().slice(0, cells).padEnd(cells, " ");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const previous = shown.current;
    shown.current = display;
    const glyphs = [...el.querySelectorAll<HTMLElement>("[data-glyph]")];
    // The glyphs are written here, never by React, so the flips and React don't fight over them.
    // The first paint, and every change under reduced motion, shows the text as is.
    if (!previous || reducedMotion()) {
      glyphs.forEach((g, i) => (g.textContent = display[i] ?? " "));
      return;
    }
    const ctx = gsap.context(() => {
      glyphs.forEach((glyph, i) => {
        const to = display[i] ?? " ";
        if (previous[i] === to) return;
        const steps = 2 + (i % 3);
        const tl = gsap.timeline({ delay: i * 0.025 });
        for (let s = 0; s < steps; s++) {
          const last = s === steps - 1;
          tl.to(glyph, { rotateX: -90, duration: 0.06, ease: "power1.in" })
            .call(() => {
              glyph.textContent = last
                ? to
                : SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]!;
            })
            .fromTo(glyph, { rotateX: 90 }, { rotateX: 0, duration: 0.07, ease: "power1.out" });
        }
      });
    }, el);
    return () => {
      // Interrupted by the next change: settle every cell on this text before that one flips.
      ctx.revert();
      glyphs.forEach((g, i) => (g.textContent = display[i] ?? " "));
    };
  }, [display]);

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
    <span
      ref={ref}
      className={`inline-flex flex-none gap-[2px] font-board font-bold ${color} ${className}`}
    >
      <span className="sr-only">{text}</span>
      {display.split("").map((_, i) => (
        <span
          key={i}
          aria-hidden
          className="relative inline-flex h-[var(--flap-h,24px)] w-[var(--flap-w,12px)] flex-none items-center justify-center overflow-hidden rounded-[2px] bg-tt-cell text-[length:var(--flap-fs,13px)] [perspective:120px] after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-black/60"
        >
          <span data-glyph className="inline-block whitespace-pre [backface-visibility:hidden]" />
        </span>
      ))}
    </span>
  );
}
