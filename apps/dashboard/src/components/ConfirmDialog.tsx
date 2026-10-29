import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { ReactNode } from "react";
import { Button } from "./form.tsx";
import { ErrorText } from "./ui.tsx";

/**
 * A danger button that asks before it acts: every delete, remove, revoke and
 * disconnect goes through one. The dialog stays open on an error so it shows.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirm,
  onConfirm,
  pending,
  error,
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
  /** Anything to show under the description, such as commands to run. */
  children?: ReactNode;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger render={<Button small variant="danger" />}>
        {trigger}
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-black/30" />
        <AlertDialog.Popup className="panel fixed top-1/2 left-1/2 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 p-5">
          <AlertDialog.Title className="text-[15px] font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-[13px] text-ink-2">
            {description}
          </AlertDialog.Description>
          {children}
          {error ? <ErrorText className="mt-2" error={error} /> : null}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close render={<Button />}>Cancel</AlertDialog.Close>
            <Button variant="danger" onClick={onConfirm} disabled={pending}>
              {confirm}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
