import { useState } from "react";
import { accessSteps, type AccessStep, type MachineView } from "@runyard/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, call } from "../api.ts";
import { sshKeyQuery } from "../lib/queries.ts";
import { useNow } from "../lib/now.ts";
import { yardQuery } from "../lib/yard.ts";
import { CopyValue } from "./CopyValue.tsx";
import { InfoTip, TipText } from "./InfoTip.tsx";
import { CodeBlock, Dot, Toggle, TtError } from "./machine/parts.tsx";
import { Panel, TtButton } from "./tt.tsx";

/**
 * How Runyard gets into a machine it hasn't reached yet: each SSH step in
 * order, where the last check left off, and the commands for that step.
 * Shown until the first successful check.
 */
export function AccessPanel({ m, admin }: { m: MachineView; admin: boolean }) {
  const queryClient = useQueryClient();
  const check = useMutation({
    mutationFn: () => call(api.machines[":id"].check.$post({ param: { id: m.id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });
  return (
    <Panel
      id="setup"
      className="scroll-mt-4"
      title={
        <span className="inline-flex items-center gap-1.5">
          Connect Runyard to {m.name}
          <InfoTip label="connecting Runyard">
            <TipText what="Runyard reaches machines over SSH. It only reads until you review a change and run it." />
          </InfoTip>
        </span>
      }
      action={
        <TtButton onClick={() => check.mutate()} disabled={check.isPending}>
          {check.isPending ? "Checking…" : "Check again"}
        </TtButton>
      }
    >
      {admin && <SetupCommand m={m} className="px-4 pb-3.5" />}
      <AccessSteps m={m} admin={admin} />
      <TtError className="px-4 pb-3" error={check.error} />
    </Panel>
  );
}

/** Each SSH step in order, where the last check left off, and the commands for that step. */
export function AccessSteps({ m, admin }: { m: MachineView; admin: boolean }) {
  const key = useQuery({ ...sshKeyQuery, enabled: admin });
  const steps = accessSteps(m, key.data?.line ?? null);
  return (
    <ol className="border-t border-tt-rule py-1.5">
      {steps.map((s, i) => (
        <Step key={s.id} step={s} n={i + 1} admin={admin} m={m} />
      ))}
    </ol>
  );
}

function Step({
  step,
  n,
  admin,
  m,
}: {
  step: AccessStep;
  n: number;
  admin: boolean;
  m: MachineView;
}) {
  const current = step.state === "current";
  return (
    <li>
      <div className="flex gap-3 px-4 py-2 text-[13px]">
        <Dot
          tone={step.state === "done" ? "ok" : current ? "bad" : "unknown"}
          className="mt-[5px]"
        />
        <div className="min-w-0 flex-1 text-tt-ink-2">
          <b
            className={`block font-bold ${step.state === "todo" ? "text-tt-ink-2" : "text-tt-ink"}`}
          >
            {n}. {step.title}
          </b>
          {step.state !== "done" && <p className="mt-0.5">{step.detail}</p>}
          {step.state !== "done" && step.output && (
            <CopyValue
              value={step.output}
              label="ssh output"
              className="mt-1 block font-board text-[11.5px] break-all text-tt-ink-3"
            />
          )}
          {current && admin && step.commands.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {step.commands.map((c) => (
                <div key={c.label} className="flex flex-col gap-1">
                  <span className="text-[12px] text-tt-ink-3">{c.label}</span>
                  <CodeBlock text={c.text} />
                </div>
              ))}
            </div>
          )}
          {current && admin && step.id === "hostKey" && <TrustHostKey m={m} />}
        </div>
      </div>
    </li>
  );
}

type Scan = {
  host: string;
  type: string;
  fingerprint: string;
  trusted: boolean;
  changed: boolean;
  tailscale: "match" | "different" | null;
};

/** The host key's file on the machine, for comparing fingerprints there. */
function hostKeyFile(type: string, windows: boolean): string {
  const name = type === "ssh-ed25519" ? "ed25519" : type.startsWith("ecdsa") ? "ecdsa" : "rsa";
  return windows
    ? `ssh-keygen -lf "$env:ProgramData\\ssh\\ssh_host_${name}_key.pub"`
    : `ssh-keygen -lf /etc/ssh/ssh_host_${name}_key.pub`;
}

/**
 * Reads the machine's host key and shows its fingerprint to compare on the
 * machine. Trusting it reads the key again and keeps only that fingerprint.
 */
function TrustHostKey({ m }: { m: MachineView }) {
  const queryClient = useQueryClient();
  const scan = useMutation({
    mutationFn: () =>
      call(api.machines[":id"]["host-key"].scan.$post({ param: { id: m.id } })) as Promise<Scan>,
  });
  const trust = useMutation({
    mutationFn: (replace: boolean) =>
      call(
        api.machines[":id"]["host-key"].trust.$post({
          param: { id: m.id },
          json: { fingerprint: scan.data!.fingerprint, replace },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });
  const k = scan.data;
  if (trust.isSuccess)
    return (
      <p className="mt-2 text-[12.5px] font-semibold text-tt-ok-ink">
        Trusted. Runyard is checking {m.name} again.
      </p>
    );
  return (
    <div className="mt-2 flex flex-col gap-2 text-[12.5px]">
      {!k && (
        <div>
          <TtButton onClick={() => scan.mutate()} disabled={scan.isPending}>
            {scan.isPending ? "Reading…" : "Read host key"}
          </TtButton>
        </div>
      )}
      {k && (
        <>
          <div className="rounded-lg border border-tt-rule bg-tt-paper px-3 py-2">
            <div className="text-[12px] text-tt-ink-3">
              {k.host} offers this {k.type} key:
            </div>
            <CopyValue
              value={k.fingerprint}
              label="Fingerprint"
              className="font-board text-[12.5px] break-all text-tt-ink"
            />
          </div>
          {k.tailscale === "match" && (
            <p className="font-semibold text-tt-ok-ink">
              It matches the key Tailscale publishes for this machine.
            </p>
          )}
          {k.tailscale === "different" && (
            <p className="font-semibold text-tt-warn-ink">
              It isn't one of the keys Tailscale publishes for this machine. Compare it on the
              machine before trusting it.
            </p>
          )}
          {k.changed ? (
            <p className="font-semibold text-tt-bad-ink">
              Runyard already trusts a different key for {k.host}. A reinstall changes it, but so
              would something intercepting the connection. Replace it only if you know why.
            </p>
          ) : (
            <p>Compare it with what the machine prints for its own key:</p>
          )}
          <CodeBlock text={hostKeyFile(k.type, m.os === "windows")} />
          <div className="flex flex-wrap gap-2">
            <TtButton
              variant={k.changed ? "danger" : "primary"}
              onClick={() => trust.mutate(k.changed)}
              disabled={trust.isPending}
            >
              {k.changed ? "Replace trusted key" : "Trust this key"}
            </TtButton>
            <TtButton onClick={() => scan.mutate()} disabled={scan.isPending}>
              Read again
            </TtButton>
          </div>
        </>
      )}
      <TtError error={scan.error ?? trust.error} />
    </div>
  );
}

/**
 * The one-line setup command: run on the machine, it authorizes Runyard's key
 * and reports the account and host keys back. Offered over HTTPS only.
 */
export function SetupCommand({ m, className = "" }: { m: MachineView; className?: string }) {
  const now = useNow();
  const show = useMutation({
    mutationFn: () =>
      call(api.machines[":id"]["setup-command"].$post({ param: { id: m.id } })) as Promise<{
        posix: string;
        prepare: string;
        windows: string;
        expiresAt: number;
      }>,
  });
  const cmd = show.data;
  const [nopasswd, setNopasswd] = useState(false);
  const expired = cmd ? cmd.expiresAt <= now : false;
  const commands = cmd
    ? [
        ...(m.os !== "windows"
          ? [{ label: "macOS or Linux, as Runyard's account", text: cmd.posix }]
          : []),
        ...(m.os === "linux" || m.os === null
          ? [
              {
                label: "Fresh Linux, as root (installs the SSH server, adds a runyard account)",
                text: `${cmd.prepare}${nopasswd ? " --sudo" : ""}`,
              },
            ]
          : []),
        ...(m.os === "windows" || m.os === null
          ? [
              {
                label: "Windows PowerShell (as admin for an admin account)",
                text: cmd.windows,
              },
            ]
          : []),
      ]
    : [];
  return (
    <div className={`text-[12.5px] ${className}`}>
      <b className="text-[14px] font-bold">Fastest: one command on the machine</b>
      <p className="mt-0.5 mb-2 text-tt-ink-2">
        Authorizes Runyard's key and completes the steps below. Installs nothing, except the
        fresh-machine version.
      </p>
      {window.location.protocol !== "https:" ? (
        <p className="text-tt-ink-3">
          Open the dashboard over HTTPS to get this command, or follow the steps below.
        </p>
      ) : !cmd || expired ? (
        <TtButton variant="primary" onClick={() => show.mutate()} disabled={show.isPending}>
          {expired ? "Show new command" : "Show setup command"}
        </TtButton>
      ) : (
        <div className="flex flex-col gap-2.5">
          {commands.map((c) => (
            <div key={c.label} className="flex flex-col gap-1">
              <span className="text-[12px] text-tt-ink-3">{c.label}</span>
              <CodeBlock text={c.text} label="Setup command" />
            </div>
          ))}
          {(m.os === "linux" || m.os === null) && (
            <Toggle checked={nopasswd} onChange={setNopasswd}>
              <span className="font-normal">
                Give the runyard account passwordless sudo. Otherwise the script asks you to set a
                password.
              </span>
            </Toggle>
          )}
          <span className="text-[12px] text-tt-ink-3">
            Works once, until{" "}
            {new Date(cmd.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            .
          </span>
        </div>
      )}
      <TtError className="mt-2" error={show.error} />
    </div>
  );
}
