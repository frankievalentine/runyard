import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

/*
 * Explanations that stay out of the way until asked for. A Popover rather than a Tooltip: it
 * opens on hover and keyboard focus on a desktop, and on a tap on a phone, where tooltips never
 * open. Its text is the explanation itself, never the only place an action or a warning is shown.
 */

// shadcn/ui's tooltip as the baseline: a solid ink bubble with no shadow, 12px text on 16px lines,
// a small square arrow, and a quick fade and scale from the side it opens on.
const shape =
  "z-50 max-w-xs origin-(--transform-origin) rounded-lg px-3 py-1.5 text-[12px] leading-4 font-normal tracking-normal normal-case outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0";
const arrowShape =
  "size-2.5 rotate-45 rounded-[2px] data-[side=bottom]:-top-1 data-[side=left]:-right-1 data-[side=right]:-left-1 data-[side=top]:-bottom-1";
// The tt-tip colors (styles.css): ink on light cards, the board's light ink over the dark board
// panels, and a raised dark gray in the dark theme. A shadow there separates it from what's below.
const popup = (dark: boolean) =>
  `${shape} shadow-[0_8px_24px_-6px_var(--tt-tip-shadow)] ${dark ? "bg-tt-tip-board text-tt-on-tip-board" : "bg-tt-tip text-tt-on-tip"}`;
const arrow = (dark: boolean) => `${arrowShape} ${dark ? "bg-tt-tip-board" : "bg-tt-tip"}`;

function Tip({
  trigger,
  label,
  children,
  triggerClassName,
  dark = false,
}: {
  trigger: ReactNode;
  label: string;
  children: ReactNode;
  triggerClassName: string;
  dark?: boolean;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={100}
        closeDelay={60}
        aria-label={label}
        className={triggerClassName}
        // Inside a <summary> or a clickable row, the click opens the tip, not the details or row.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={8} collisionPadding={12} className="z-50">
          <Popover.Popup className={popup(dark)}>
            <Popover.Arrow className={arrow(dark)} />
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A small (i) that explains the thing beside it. `label` names it for screen readers. */
export function InfoTip({
  label,
  children,
  dark = false,
  large = false,
}: {
  label: string;
  children: ReactNode;
  /** On the dark board panels (Departures, Traffic). */
  dark?: boolean;
  /** Beside a page title: 18px rather than 14px. */
  large?: boolean;
}) {
  const icon = large ? 18 : 14;
  return (
    <Tip
      dark={dark}
      label={`About ${label}`}
      // 14px beside 13px text, lifted 1px so it centers on the capitals rather than the line box.
      triggerClassName={`inline-grid flex-none cursor-default ${large ? "size-5" : "size-4 -translate-y-px"} place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 ${dark ? "text-[#8b9099] hover:text-tt-flap focus-visible:text-tt-flap focus-visible:outline-tt-flap data-[popup-open]:text-tt-flap" : "text-tt-ink-3 hover:text-tt-ink focus-visible:text-tt-ink focus-visible:outline-tt-ink data-[popup-open]:text-tt-ink"}`}
      trigger={
        <svg
          aria-hidden
          width={icon}
          height={icon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5.5" />
          <circle cx="12" cy="7.75" r=".6" fill="currentColor" />
        </svg>
      }
    >
      {children}
    </Tip>
  );
}

/**
 * A value cut to one line, its whole text a hover or tap away: paths, fingerprints, addresses.
 * `label` says what it is, for screen readers.
 */
export function Clipped({ value, label }: { value: string; label: string }) {
  return (
    <Tip
      label={`${label}: ${value}`}
      triggerClassName="block max-w-full min-w-0 cursor-default truncate text-left underline decoration-tt-rule-2 decoration-dotted underline-offset-2"
      trigger={value}
    >
      <span className="font-mono text-[12px] break-all">{value}</span>
    </Tip>
  );
}

/** Things a tap already does something on: a tip inside one keeps the tap for it. */
const TAPPABLE = "a, button, select, input, textarea, summary, label, [role=button], [role=radio]";

/**
 * A tooltip on something without an (i): a row, a chip, a value. It opens on hover and keyboard
 * focus, and on a phone on a tap, unless it sits on or inside a link or button, whose tap opens
 * that instead (and whose page has the details). A second tap, or a tap elsewhere, closes it. The
 * child keeps being the element it is. Looks like InfoTip's.
 */
export function RowTip({
  content,
  children,
  side = "top",
  dark = false,
  disabled = false,
}: {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  /** Over the dark board panels. */
  dark?: boolean;
  /** Renders the child alone, without a tooltip. */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const touch = useRef(false);
  // Opened by a tap: the next tap anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!trigger.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);
  if (disabled) return children;
  return (
    <Tooltip.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Trigger
        ref={(el: HTMLElement | null) => {
          trigger.current = el;
        }}
        delay={300}
        closeDelay={0}
        closeOnClick={false}
        render={children}
        onPointerDown={(e) => {
          touch.current = e.pointerType === "touch";
        }}
        onClick={(e) => {
          if (!touch.current) return;
          const el = e.currentTarget as HTMLElement;
          if (el.matches(TAPPABLE) || el.parentElement?.closest(TAPPABLE)) return;
          setOpen((o) => !o);
        }}
      />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={8} collisionPadding={12} className="z-50">
          <Tooltip.Popup className={popup(dark)}>
            <Tooltip.Arrow className={arrow(dark)} />
            {content}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** A tip's paragraphs: what it is, then the particulars (dimmed), then what to do (bold). */
export function TipText({
  what,
  details,
  todo,
}: {
  what: ReactNode;
  details?: ReactNode;
  todo?: ReactNode;
}) {
  return (
    <span className="flex flex-col gap-1.5">
      <span>{what}</span>
      {details && <span className="[overflow-wrap:anywhere] opacity-75">{details}</span>}
      {todo && <span className="font-semibold">{todo}</span>}
    </span>
  );
}
