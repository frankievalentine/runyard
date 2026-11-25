import { Popover } from "@base-ui/react/popover";
import type { ReactNode } from "react";

/*
 * Explanations that stay out of the way until asked for. A Popover rather than a Tooltip: it
 * opens on hover and keyboard focus on a desktop, and on a tap on a phone, where tooltips never
 * open. Its text is the explanation itself, never the only place an action or a warning is shown.
 */

// shadcn/ui's tooltip as the baseline: a solid ink bubble with no shadow, 12px text on 16px lines,
// a small square arrow, and a quick fade and scale from the side it opens on.
const popup =
  "z-50 max-w-xs origin-(--transform-origin) rounded-lg bg-tt-inv px-3 py-1.5 text-[12px] leading-4 font-normal tracking-normal normal-case text-tt-on-inv outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0";
const arrow =
  "size-2.5 rotate-45 rounded-[2px] bg-tt-inv data-[side=bottom]:-top-1 data-[side=top]:-bottom-1";

function Tip({
  trigger,
  label,
  children,
  triggerClassName,
}: {
  trigger: ReactNode;
  label: string;
  children: ReactNode;
  triggerClassName: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={100}
        closeDelay={60}
        aria-label={label}
        className={triggerClassName}
      >
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={8} collisionPadding={12} className="z-50">
          <Popover.Popup className={popup}>
            <Popover.Arrow className={arrow} />
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A small (i) that explains the thing beside it. `label` names it for screen readers. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tip
      label={`About ${label}`}
      // 14px beside 13px text, lifted 1px so it centers on the capitals rather than the line box.
      triggerClassName="inline-grid size-4 flex-none -translate-y-px cursor-default place-items-center rounded-full text-tt-ink-3 hover:text-tt-ink focus-visible:text-tt-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-tt-ink data-[popup-open]:text-tt-ink"
      trigger={
        <svg
          aria-hidden
          width="14"
          height="14"
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
