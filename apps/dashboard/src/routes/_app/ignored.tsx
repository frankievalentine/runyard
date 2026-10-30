import type { PeerView } from "@runyard/core";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "../../components/form.tsx";
import { Icon } from "../../components/icons.tsx";
import { usePeerActions } from "../../components/peers.ts";
import {
  Card,
  EmptyLine,
  ErrorText,
  PageHeader,
  Section,
  StatusDot,
} from "../../components/ui.tsx";
import { useYard } from "../../lib/yard.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { osLabel } from "../../lib/status.ts";

export const Route = createFileRoute("/_app/ignored")({
  component: Ignored,
});

/** aarondfrancis/fleet's IgnoredDetail. */
function Ignored() {
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  return (
    <div>
      <PageHeader
        icon={<Icon name="eye-off" size={18} />}
        title="Ignored machines"
        subtitle="Hidden from Tailnet devices. Restore one to list it again."
      />
      <Section title="Machines" count={view.ignored.length}>
        <Card className="divide-y divide-line overflow-hidden">
          {view.ignored.length === 0 && <EmptyLine>Nothing is ignored.</EmptyLine>}
          {view.ignored.map((p) => (
            <IgnoredRow key={p.nodeId} peer={p} admin={session.user?.role === "admin"} />
          ))}
        </Card>
      </Section>
    </div>
  );
}

function IgnoredRow({ peer, admin }: { peer: PeerView; admin: boolean }) {
  const { restore } = usePeerActions(peer.nodeId);
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <StatusDot tone={peer.online ? "ok" : "muted"} hollow />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{peer.name}</div>
        <div className="truncate font-mono text-[11.5px] text-ink-2">
          {peer.address} · {osLabel[peer.os]}
        </div>
      </div>
      {admin && (
        <Button small disabled={restore.isPending} onClick={() => restore.mutate()}>
          Restore
        </Button>
      )}
      {restore.error && <ErrorText className="w-full" error={restore.error} />}
    </div>
  );
}
