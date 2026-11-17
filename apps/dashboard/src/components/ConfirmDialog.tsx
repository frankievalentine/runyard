import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import { ttButton, ttRowButton } from "./tt.tsx";
import { ErrorText } from "./ui.tsx";

/*
 * Timetable's dialogs: a confirmation before anything is deleted, removed, revoked or
 * disconnected, and a plain dialog for forms. Bottom sheets on phones (.sheet-dialog).
 */

const popup =
  "sheet-dialog fixed top-1/2 left-1/2 max-h-[calc(100vh-64px)] w-[min(calc(100vw-32px),480px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[14px] border border-tt-rule bg-tt-card text-tt-ink shadow-[0_30px_70px_-20px_rgba(0,0,0,.5)]";
const backdrop = "fixed inset-0 bg-black/40";
const heading = "text-[24px] leading-tight font-extrabold [font-stretch:78%]";

/** A dialog in the design's style: a condensed title, its body, and buttons at the end. */
export function TtDialog({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdrop} />
        <Dialog.Popup className={popup}>
          <div className="flex items-start gap-3 px-[22px] pt-5 pb-1.5">
            <Dialog.Title className={`flex-1 ${heading}`}>{title}</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="grid size-8 place-items-center rounded-lg text-tt-ink-3 hover:bg-tt-hover hover:text-tt-ink"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M6 6l12 12M18 6 6 18" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </Dialog.Close>
          </div>
          <div className="px-[22px] pt-1.5 pb-[22px]">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A dialog's buttons, at its end. */
export function DialogButtons({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex flex-wrap justify-end gap-2.5">{children}</div>;
}

/**
 * A danger button that asks before it acts, in the design's style. The dialog stays open on an
 * error so it shows.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirm,
  onConfirm,
  pending,
  error,
  triggerClassName = ttRowButton.danger,
  children,
}: {
  trigger: ReactNode;
  title: ReactNode;
  description: ReactNode;
  /** The confirming button's label; names the action, never "OK". */
  confirm: ReactNode;
  onConfirm: () => void;
  pending?: boolean;
  error?: unknown;
  /** The trigger's style; a small danger button by default. */
  triggerClassName?: string;
  /** Anything to show under the description, such as commands to run. */
  children?: ReactNode;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger className={triggerClassName}>{trigger}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdrop} />
        <AlertDialog.Popup className={`${popup} px-[22px] pt-5 pb-[22px]`}>
          <AlertDialog.Title className={heading}>{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[13.5px] text-tt-ink-2">
            {description}
          </AlertDialog.Description>
          {children}
          {error ? <ErrorText className="mt-2" error={error} /> : null}
          <DialogButtons>
            <AlertDialog.Close className={ttButton.secondary}>Cancel</AlertDialog.Close>
            <button
              type="button"
              className={`${ttButton.danger} !border-tt-bad`}
              onClick={onConfirm}
              disabled={pending}
            >
              {confirm}
            </button>
          </DialogButtons>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
