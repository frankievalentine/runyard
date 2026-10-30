import type { OsFamily, SshTransport } from "@runyard/core";
import { TextField } from "./form.tsx";

/** How Runyard reaches a machine: shared by the add form and the edit dialog. */
export function MachineFields(props: {
  sshTarget: string;
  setSshTarget: (v: string) => void;
  transport: SshTransport;
  setTransport: (v: SshTransport) => void;
  expectedOs: OsFamily | null;
  setExpectedOs: (v: OsFamily | null) => void;
  /** Editing only: new machines always start with Runyard's key only. */
  runyardKeyOnly?: boolean;
  setRunyardKeyOnly?: (v: boolean) => void;
}) {
  return (
    <>
      <TextField
        label="SSH target"
        value={props.sshTarget}
        onChange={(e) => props.setSshTarget(e.target.value)}
        placeholder="ci@build-box.tail1234.ts.net"
        spellCheck={false}
        autoCapitalize="off"
        description="user@host, or a Host alias from the Runyard host's ~/.ssh/config."
        required
      />
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink-2">Connect with</span>
        <select
          className="input"
          value={props.transport}
          onChange={(e) => props.setTransport(e.target.value as SshTransport)}
        >
          <option value="openssh">OpenSSH (the Runyard host's keys)</option>
          <option value="tailscale">Tailscale SSH</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink-2">Operating system</span>
        <select
          className="input"
          value={props.expectedOs ?? ""}
          onChange={(e) => props.setExpectedOs((e.target.value || null) as OsFamily | null)}
        >
          <option value="">Detect (macOS or Linux)</option>
          <option value="macos">macOS</option>
          <option value="linux">Linux</option>
          <option value="windows">Windows</option>
        </select>
      </label>
      {props.setRunyardKeyOnly && props.transport === "openssh" && (
        <label className="flex items-start gap-2 text-[12.5px]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={props.runyardKeyOnly ?? false}
            onChange={(e) => props.setRunyardKeyOnly?.(e.target.checked)}
          />
          <span>
            <span className="font-medium">Sign in with Runyard's key only</span>
            <span className="block text-[12px] text-ink-2">
              For machines set up with Runyard's setup command. Turn it off if you sign in with your
              own keys.
            </span>
          </span>
        </label>
      )}
    </>
  );
}
