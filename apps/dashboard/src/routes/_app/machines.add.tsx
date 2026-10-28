import type { OsFamily, PeerView, SshTransport } from "@runyard/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { Button, TextField } from "../../components/form.tsx";
import { MachineFields } from "../../components/MachineFields.tsx";
import {
  Card,
  EmptyLine,
  ErrorText,
  PageHeader,
  Pill,
  Section,
  StatusDot,
} from "../../components/ui.tsx";
import { Icon } from "../../components/icons.tsx";
import { fleetQuery, useFleet } from "../../lib/fleet.ts";
import { timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { osLabel } from "../../lib/status.ts";

export const Route = createFileRoute("/_app/machines/add")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.user?.role !== "admin") throw redirect({ to: "/" });
  },
  component: AddMachines,
});

function AddMachines() {
  const fleet = useFleet();
  return (
    <>
      <PageHeader
        icon={<Icon name="plus" size={18} />}
        title="Add machines"
        subtitle="Runyard reads a machine's health over SSH every minute, read-only. Nothing is installed on it, and only machines you add are checked."
      />
      <Section title="From your tailnet">
        <Card className="divide-y divide-line overflow-hidden">
          {fleet.discovered.length === 0 && (
            <EmptyLine>
              {fleet.tailnet.error
                ? "Tailscale can't be read on this machine, so there's nothing to list."
                : "Every desktop and server on the tailnet is already added or ignored."}
            </EmptyLine>
          )}
          {fleet.discovered.map((peer) => (
            <PeerRow key={peer.nodeId} peer={peer} />
          ))}
        </Card>
      </Section>
      <Section title="By SSH target">
        <AddBySsh />
      </Section>
      {fleet.ignored.length > 0 && (
        <Section title="Ignored">
          <Card className="divide-y divide-line overflow-hidden">
            {fleet.ignored.map((peer) => (
              <PeerRow key={peer.nodeId} peer={peer} ignored />
            ))}
          </Card>
        </Section>
      )}
    </>
  );
}

function PeerRow({ peer, ignored = false }: { peer: PeerView; ignored?: boolean }) {
  const now = useNow();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const refresh = () => queryClient.invalidateQueries({ queryKey: fleetQuery.queryKey });
  const add = useMutation({
    mutationFn: () => call(api.peers[":nodeId"].add.$post({ param: { nodeId: peer.nodeId } })),
    onSuccess: async (machine) => {
      await refresh();
      void navigate({ to: "/machines/$id", params: { id: machine.id } });
    },
  });
  const ignore = useMutation({
    mutationFn: () =>
      ignored
        ? call(api.peers[":nodeId"].ignore.$delete({ param: { nodeId: peer.nodeId } }))
        : call(api.peers[":nodeId"].ignore.$post({ param: { nodeId: peer.nodeId } })),
    onSuccess: refresh,
  });
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <StatusDot tone={peer.online ? "ok" : "muted"} hollow={!peer.online} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{peer.name}</span>
          <Pill tone="muted">{osLabel[peer.os]}</Pill>
          {peer.tailscaleSsh && <Pill tone="info">Tailscale SSH</Pill>}
        </div>
        <div className="truncate text-[12px] text-ink-2">
          <span className="font-mono">{peer.address}</span>
          {!peer.online && ` · last seen ${timeAgo(peer.lastSeen, now)}`}
        </div>
      </div>
      {!ignored && (
        <Button small variant="primary" onClick={() => add.mutate()} disabled={add.isPending}>
          Add
        </Button>
      )}
      <Button small variant="ghost" onClick={() => ignore.mutate()} disabled={ignore.isPending}>
        {ignored ? "Restore" : "Ignore"}
      </Button>
      {(add.error ?? ignore.error) && (
        <ErrorText className="w-full" error={add.error ?? ignore.error} />
      )}
    </div>
  );
}

function AddBySsh() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [sshTarget, setSshTarget] = useState("");
  const [transport, setTransport] = useState<SshTransport>("openssh");
  const [expectedOs, setExpectedOs] = useState<OsFamily | null>(null);
  const add = useMutation({
    mutationFn: () =>
      call(api.machines.$post({ json: { name, sshTarget, transport, expectedOs } })),
    onSuccess: async (machine) => {
      await queryClient.invalidateQueries({ queryKey: fleetQuery.queryKey });
      void navigate({ to: "/machines/$id", params: { id: machine.id } });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  return (
    <Card className="max-w-md px-4 py-4">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Build box"
          required
        />
        <MachineFields
          sshTarget={sshTarget}
          setSshTarget={setSshTarget}
          transport={transport}
          setTransport={setTransport}
          expectedOs={expectedOs}
          setExpectedOs={setExpectedOs}
        />
        {add.error && <ErrorText error={add.error} />}
        <div>
          <Button type="submit" variant="primary" disabled={add.isPending}>
            Add machine
          </Button>
        </div>
      </form>
    </Card>
  );
}
