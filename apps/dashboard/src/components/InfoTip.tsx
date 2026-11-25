import { Popover } from "@base-ui/react/popover";
import type { ReactNode } from "react";

/*
 * Explanations that stay out of the way until asked for. A Popover rather than a Tooltip: it
 * opens on hover and keyboard focus on a desktop, and on a tap on a phone, where tooltips never
 * open. Its text is the explanation itself, never the only place an action or a warning is shown.
 */

const popup =
  "z-50 max-w-[min(280px,calc(100vw-32px))] rounded-lg bg-tt-inv px-3 py-2 text-[12.5px] leading-snug font-normal tracking-normal normal-case text-tt-on-inv shadow-[0_12px_30px_-10px_rgba(0,0,0,.45)] outline-none transition-opacity duration-100 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0";

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
        delay={150}
        closeDelay={80}
        aria-label={label}
        className={triggerClassName}
      >
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={6} collisionPadding={12}>
          <Popover.Popup className={popup}>{children}</Popover.Popup>
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
      triggerClassName="inline-grid size-[18px] flex-none cursor-help place-items-center rounded-full align-middle text-tt-ink-3 hover:text-tt-ink focus-visible:text-tt-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-tt-ink data-[popup-open]:text-tt-ink"
      trigger={
        <svg
          aria-hidden
          width="15"
          height="15"
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
      triggerClassName="block max-w-full min-w-0 cursor-help truncate text-left underline decoration-tt-rule-2 decoration-dotted underline-offset-2"
      trigger={value}
    >
      <span className="font-mono text-[12px] break-all">{value}</span>
    </Tip>
  );
}
