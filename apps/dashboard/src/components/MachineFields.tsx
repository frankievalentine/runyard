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
        description="user@host, or a Host alias from this machine's ~/.ssh/config. The host key must already be trusted here."
        required
      />
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink-2">Connect with</span>
        <select
          className="input"
          value={props.transport}
          onChange={(e) => props.setTransport(e.target.value as SshTransport)}
        >
          <option value="openssh">OpenSSH (this machine's ssh and keys)</option>
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
    </>
  );
}
