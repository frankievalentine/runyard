import type { OsFamily, SshTransport } from "@runyard/core";
import { Field, Input, Select, Toggle } from "./machine/parts.tsx";

/**
 * How Runyard reaches a machine: shared by Add machine and Edit. Fragments, so the form around
 * them sets the grid (two across on a wide screen, as in the design).
 */
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
      <Field
        label="SSH target"
        hint="user@host, or a Host alias from the Runyard host's ~/.ssh/config."
      >
        <Input
          value={props.sshTarget}
          onChange={(e) => props.setSshTarget(e.target.value)}
          placeholder="ci@build-box.tail1234.ts.net"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          required
        />
      </Field>
      <Field label="Connect with">
        <Select
          value={props.transport}
          onChange={(e) => props.setTransport(e.target.value as SshTransport)}
        >
          <option value="openssh">OpenSSH (the Runyard host's keys)</option>
          <option value="tailscale">Tailscale SSH</option>
        </Select>
      </Field>
      <Field label="Operating system">
        <Select
          value={props.expectedOs ?? ""}
          onChange={(e) => props.setExpectedOs((e.target.value || null) as OsFamily | null)}
        >
          <option value="">Detect (macOS or Linux)</option>
          <option value="macos">macOS</option>
          <option value="linux">Linux</option>
          <option value="windows">Windows</option>
        </Select>
      </Field>
      {props.setRunyardKeyOnly && props.transport === "openssh" && (
        <div className="sm:col-span-2">
          <Toggle
            checked={props.runyardKeyOnly ?? false}
            onChange={(v) => props.setRunyardKeyOnly?.(v)}
          >
            Sign in with Runyard's key only
            <span className="block text-[12px] font-normal text-tt-ink-3">
              For machines set up with Runyard's setup command. Turn it off if you sign in with your
              own keys.
            </span>
          </Toggle>
        </div>
      )}
    </>
  );
}
