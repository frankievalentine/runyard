import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CopyValue } from "../../components/CopyValue.tsx";
import { Button } from "../../components/form.tsx";
import { Icon } from "../../components/icons.tsx";
import { usePeerActions } from "../../components/peers.ts";
import {
  Card,
  EmptyLine,
  ErrorText,
  GroupedCard,
  KeyValueLine,
  PageHeader,
  Pill,
  Section,
  type KeyValueRow,
} from "../../components/ui.tsx";
import { useYard } from "../../lib/yard.ts";
import { timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { osLabel } from "../../lib/status.ts";

export const Route = createFileRoute("/_app/peers/$nodeId")({
  component: KeyedPeer,
});

/** Each nodeId gets the page fresh: moving between them never carries one's state to the next. */
function KeyedPeer() {
  return <Peer key={Route.useParams().nodeId} />;
}

/** A tailnet device that isn't a Runyard machine: aarondfrancis/fleet's Other machines page, with Add instead of automatic checks. */
function Peer() {
  const { nodeId } = Route.useParams();
  const view = useYard();
  const now = useNow();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const actions = usePeerActions(nodeId);
  const peer = view.discovered.find((p) => p.nodeId === nodeId);
  if (!peer) {
    return (
      <Card>
        <EmptyLine>
          This device is no longer listed.{" "}
          <Link to="/" className="text-accent hover:underline">
            Go to overview
          </Link>
        </EmptyLine>
      </Card>
    );
  }
  const admin = session.user?.role === "admin";
  const error = actions.add.error ?? actions.ignore.error;
  return (
    <div>
      <PageHeader
        icon={<Icon name="machine" size={18} />}
        title={peer.name}
        status={
          <Pill tone={peer.online ? "ok" : "muted"} hollow>
            {peer.online ? "Online · not checked" : "Offline"}
          </Pill>
        }
        subtitle={
          <>
            <CopyValue value={peer.address} label="Address" /> · {osLabel[peer.os]}
          </>
        }
        actions={
          admin && (
            <>
              <Button
                small
                variant="ghost"
                disabled={actions.ignore.isPending}
                onClick={() => actions.ignore.mutate()}
              >
                Ignore
              </Button>
              <Button
                small
                variant="primary"
                disabled={actions.add.isPending}
                onClick={() => actions.add.mutate()}
              >
                Add machine
              </Button>
            </>
          )
        }
      />
      {error && <ErrorText className="mt-3" error={error} />}
      <Card className="mt-8 px-4 py-3 text-[12.5px] text-ink-2">
        Runyard doesn't connect until you add this device.{admin ? "" : " An admin can add it."}
      </Card>
      <Section title="Details">
        <GroupedCard
          groups={[
            {
              key: "tailnet",
              title: "Tailnet",
              rows: (
                [
                  [
                    "Status",
                    peer.online
                      ? "Online"
                      : `Offline${peer.lastSeen ? `, last seen ${timeAgo(peer.lastSeen, now)}` : ""}`,
                  ],
                  ["Hostname", peer.name, peer.name],
                  ["Address", peer.address, peer.address],
                  ["Tailscale SSH", peer.tailscaleSsh ? "Advertised" : "Not advertised"],
                  ...(peer.tags.length
                    ? [
                        ["Tags", peer.tags.join(", "), peer.tags.join(", ")] as [
                          string,
                          string,
                          string,
                        ],
                      ]
                    : []),
                ] as KeyValueRow[]
              ).map((row) => [row[0], <KeyValueLine row={row} />]),
            },
          ]}
        />
      </Section>
    </div>
  );
}
