import { accessSteps, type AccessStep, type MachineView } from "@runyard/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, call } from "../api.ts";
import { sshKeyQuery } from "../lib/queries.ts";
import { yardQuery } from "../lib/yard.ts";
import { CopyValue } from "./CopyValue.tsx";
import { Button } from "./form.tsx";
import { Card, ErrorText, StatusDot } from "./ui.tsx";

/**
 * How Runyard gets into a machine it hasn't reached yet: each SSH step in
 * order, where the last check left off, and the commands for that step.
 * Shown until the first successful check.
 */
export function AccessPanel({ m, admin }: { m: MachineView; admin: boolean }) {
  const queryClient = useQueryClient();
  const key = useQuery({ ...sshKeyQuery, enabled: admin });
  const steps = accessSteps(m, key.data?.line ?? null);
  const check = useMutation({
    mutationFn: () => call(api.machines[":id"].check.$post({ param: { id: m.id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });
  return (
    <section id="setup" className="mt-6 scroll-mt-6">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">Connect Runyard to {m.name}</div>
            <div className="text-[12px] text-ink-2">
              Runyard reaches machines over SSH, read-only until you review a change.
            </div>
          </div>
          <Button small onClick={() => check.mutate()} disabled={check.isPending}>
            {check.isPending ? "Checking…" : "Check again"}
          </Button>
        </div>
        <ol className="divide-y divide-line">
          {steps.map((s, i) => (
            <Step key={s.id} step={s} n={i + 1} admin={admin} m={m} />
          ))}
        </ol>
        {check.error && <ErrorText className="px-4 pb-3" error={check.error} />}
      </Card>
    </section>
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
    <li className={`flex gap-3 px-4 py-3 ${current ? "bg-warn/5" : ""}`}>
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
        {step.state === "done" ? (
          <StatusDot tone="ok" />
        ) : current ? (
          <StatusDot tone="warn" />
        ) : (
          <span className="text-[12px] text-ink-2 tabular">{n}</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] font-medium ${step.state === "todo" ? "text-ink-2" : ""}`}>
          {step.title}
        </div>
        {step.state !== "done" && <p className="mt-0.5 text-[12.5px] text-ink-2">{step.detail}</p>}
        {current && admin && step.commands.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {step.commands.map((c) => (
              <div key={c.label} className="flex flex-col gap-1">
                <span className="text-[12px] text-ink-2">{c.label}</span>
                <div className="rounded-md border border-line bg-bg px-2.5 py-1.5">
                  <CopyValue
                    value={c.text}
                    label="Command"
                    className="font-mono text-[12px] break-all whitespace-pre-wrap"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        {current && admin && step.id === "hostKey" && <TrustHostKey m={m} />}
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
      <p className="mt-2 text-[12.5px] text-ok">Trusted. Runyard is checking {m.name} again.</p>
    );
  return (
    <div className="mt-2 flex flex-col gap-2 text-[12.5px]">
      {!k && (
        <div>
          <Button small onClick={() => scan.mutate()} disabled={scan.isPending}>
            {scan.isPending ? "Reading…" : "Read its host key"}
          </Button>
        </div>
      )}
      {k && (
        <>
          <div className="rounded-md border border-line bg-bg px-2.5 py-2">
            <div className="text-[12px] text-ink-2">
              {k.host} offers this {k.type} key:
            </div>
            <CopyValue
              value={k.fingerprint}
              label="Fingerprint"
              className="font-mono text-[12.5px] break-all"
            />
          </div>
          {k.tailscale === "match" && (
            <p className="text-ok">It matches the key Tailscale publishes for this machine.</p>
          )}
          {k.tailscale === "different" && (
            <p className="text-warn">
              It isn't one of the keys Tailscale publishes for this machine. Compare it on the
              machine before trusting it.
            </p>
          )}
          {k.changed ? (
            <p className="text-bad">
              Runyard already trusts a different key for {k.host}. A reinstall changes it, but so
              would something intercepting the connection. Replace it only if you know why.
            </p>
          ) : (
            <p className="text-ink-2">Compare it with what the machine prints for its own key:</p>
          )}
          <div className="rounded-md border border-line bg-bg px-2.5 py-1.5">
            <CopyValue
              value={hostKeyFile(k.type, m.os === "windows")}
              label="Command"
              className="font-mono text-[12px] break-all"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              small
              variant={k.changed ? "danger" : "primary"}
              onClick={() => trust.mutate(k.changed)}
              disabled={trust.isPending}
            >
              {k.changed ? "Replace the trusted key" : "They match: trust this key"}
            </Button>
            <Button small variant="ghost" onClick={() => scan.mutate()} disabled={scan.isPending}>
              Read again
            </Button>
          </div>
        </>
      )}
      {(scan.error ?? trust.error) && <ErrorText error={scan.error ?? trust.error} />}
    </div>
  );
}
