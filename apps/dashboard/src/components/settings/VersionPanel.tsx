import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import type { InstallKind } from "@runyard/core";
import { api, call } from "../../api.ts";
import { timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { sessionQuery, updatesQuery } from "../../lib/queries.ts";
import { CodeBlock, Toggle, TtError } from "../machine/parts.tsx";
import { Chip, Panel, Row } from "../tt.tsx";
import { Kvh, Note, RowText, SIcon, rowButton } from "./parts.tsx";

const INSTALL: Record<InstallKind, string> = {
  docker: "Docker image",
  service: "Background service",
  terminal: "Started in a terminal",
  source: "From source",
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/**
 * Which Runyard this is and whether a newer one is out, from a daily look at GitHub's releases.
 * When one is, admins get the command that updates this host the way it was installed: Runyard
 * doesn't replace itself.
 */
export function VersionPanel() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const admin = session.user?.role === "admin";
  const status = useQuery(updatesQuery);
  const now = useNow();
  const queryClient = useQueryClient();
  const check = useMutation({
    mutationFn: () => call(api.updates.check.$post()),
    onSuccess: (data) => queryClient.setQueryData(updatesQuery.queryKey, data),
  });
  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) => call(api.updates.settings.$put({ json: { enabled } })),
    onSuccess: (data) => queryClient.setQueryData(updatesQuery.queryKey, data),
  });
  const s = status.data;
  return (
    <Panel
      id="version"
      title="Version"
      meta={
        s?.available ? (
          <Chip tone="busy">Update available</Chip>
        ) : s?.latest && !s.error ? (
          <Chip tone="ok">Up to date</Chip>
        ) : undefined
      }
    >
      {status.error && <TtError className="px-4 pb-3" error={status.error} />}
      {s && (
        <>
          <Row className="!border-t-0">
            <SIcon name="update" />
            <RowText
              title={`Runyard ${s.current}`}
              detail={
                <>
                  {INSTALL[s.install]}
                  {s.available && s.latest
                    ? ` · ${s.latest.version} is out${s.latest.publishedAt ? `, released ${day(s.latest.publishedAt)}` : ""}`
                    : s.checkedAt
                      ? ` · Checked ${timeAgo(s.checkedAt, now)}`
                      : s.enabled
                        ? " · Not checked yet"
                        : " · Daily check off"}
                </>
              }
            />
            {s.latest && (
              <a
                href={s.latest.url}
                target="_blank"
                rel="noreferrer"
                className={rowButton.secondary}
              >
                {s.available ? "What's new" : "Release notes"}
              </a>
            )}
          </Row>
          {s.error && <Note className="!text-tt-ink-3">{s.error}</Note>}
          {admin && s.available && s.latest && s.steps && (
            <div className="border-t border-tt-rule pb-3.5">
              <Kvh>Update to {s.latest.version}</Kvh>
              {s.steps.command && <CodeBlock className="mx-4 mt-1.5" text={s.steps.command} />}
              <p className="mx-4 mt-2 text-[12px] text-tt-ink-3">{s.steps.note}</p>
            </div>
          )}
          {admin && (
            <Row>
              <span className="min-w-0 flex-1">
                <Toggle checked={s.enabled} onChange={(on) => setEnabled.mutate(on)}>
                  <span className="font-normal">Check GitHub for a new release once a day</span>
                </Toggle>
              </span>
              <button
                type="button"
                className={rowButton.secondary}
                onClick={() => check.mutate()}
                disabled={check.isPending}
              >
                {check.isPending ? "Checking…" : "Check now"}
              </button>
            </Row>
          )}
          <TtError className="px-4 pb-3" error={check.error ?? setEnabled.error} />
        </>
      )}
    </Panel>
  );
}
