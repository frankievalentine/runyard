import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { pointsAt } from "../lib/webhooks.ts";
import { useState, type FormEvent } from "react";
import { api, call } from "../api.ts";
import { timeAgo } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";
import { CopyValue } from "./CopyValue.tsx";
import { ErrorText } from "./ui.tsx";
import { Chip, Panel, ttButton } from "./tt.tsx";
import { Note, TtField } from "./settings/parts.tsx";
import { InfoTip, TipText } from "./InfoTip.tsx";

export const webhookStatusQuery = {
  queryKey: ["webhook-status"],
  queryFn: () => call(api.webhooks.status.$get()),
};

type Status = Awaited<ReturnType<typeof webhookStatusQuery.queryFn>>;

/**
 * Optional GitHub webhooks: Funnel (or a proxy) exposes the webhook listener,
 * Runyard points each app's hook at it, and GitHub's settings switch it on.
 * Deliveries only make Runyard re-read sooner; polling keeps working without them.
 */
export function Webhooks() {
  const status = useQuery(webhookStatusQuery);
  const s = status.data;
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-1.5">
          Webhooks
          <InfoTip label="webhooks">
            <TipText
              what="Without webhooks Runyard notices queued jobs within about 45 seconds; with them, within seconds."
              details="A delivery only makes Runyard re-read GitHub sooner. It never acts on what a delivery says."
            />
          </InfoTip>
        </span>
      }
      meta="Optional"
    >
      {status.isPending && <Note>Checking…</Note>}
      {status.error && <ErrorText className="px-4 pb-3" error={status.error} />}
      {s && s.port === null && (
        <Note>
          The webhook listener is off (RUNYARD_WEBHOOKS=off). Runyard polls GitHub instead.
        </Note>
      )}
      {s && s.port !== null && <Steps s={s} port={s.port} />}
    </Panel>
  );
}

const dot = (on: boolean) =>
  `mt-[5px] size-2 flex-none rounded-full ${on ? "bg-tt-ok" : "border-[1.5px] border-[#e3a800]"}`;

function Steps({ s, port }: { s: Status; port: number }) {
  const command = `tailscale funnel --bg http://127.0.0.1:${port}`;
  return (
    <>
      <div className="flex items-start gap-3 border-t border-tt-rule px-4 py-3 text-[12.5px]">
        <span
          role="img"
          aria-label={s.funnelUrl ? "Done" : "To do"}
          className={dot(!!s.funnelUrl)}
        />
        <div className="min-w-0 flex-1">
          <b className="block text-[13px] font-bold">1. Make the webhook listener public</b>
          {s.funnelUrl ? (
            <div className="mt-1 space-y-1 text-tt-ink-2">
              <p>
                Funnel is set to serve it at{" "}
                <span className="font-mono break-all text-tt-ink">{s.funnelUrl}</span>.
              </p>
              <p>
                That's this machine's setting; to check GitHub can reach it, open{" "}
                <span className="font-mono break-all text-tt-ink">
                  {s.funnelUrl}/webhooks/github
                </span>{" "}
                from a device off your tailnet, such as a phone with Tailscale and Wi-Fi off. It
                should say Not found. When Funnel is new, its public name can take up to half an
                hour to appear.
              </p>
            </div>
          ) : (
            <div className="mt-1 space-y-1.5 text-tt-ink-2">
              <p>
                Runyard listens for webhooks only on this machine, at 127.0.0.1:{port}, and serves
                nothing else there. Tailscale Funnel can make that one port public; Runyard won't
                change Funnel for you.
              </p>
              <p>
                <b className="font-semibold text-tt-ink">First, turn Funnel on for your tailnet.</b>{" "}
                It's off by default. In the Tailscale admin console, allow it for this machine (the{" "}
                <span className="font-mono">funnel</span> node attribute in Access controls), or run
                the command below: if Funnel isn't on yet, it prints a link that turns it on, and
                you run the command again afterward.{" "}
                <a
                  href="https://tailscale.com/kb/1223/funnel"
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-tt-ink underline"
                >
                  How Funnel works
                </a>
              </p>
              <p>Then, on this machine:</p>
              <div className="rounded-lg border border-tt-rule bg-tt-paper px-3 py-2 font-mono text-[12px] text-tt-ink">
                <CopyValue value={command} label="Command">
                  {command}
                </CopyValue>
              </div>
              <p>Any HTTPS reverse proxy to that port works instead of Funnel.</p>
              {s.funnelError && (
                <p className="text-tt-warn-ink">Couldn't read Funnel's status: {s.funnelError}</p>
              )}
            </div>
          )}
        </div>
      </div>
      {s.apps.length === 0 ? (
        <Note className="border-t border-tt-rule pt-3">
          Create a GitHub App first; then point its webhook here.
        </Note>
      ) : (
        s.apps.map((app) => <AppHook key={app.forgeId} app={app} publicUrl={s.funnelUrl} />)
      )}
    </>
  );
}

function AppHook({ app, publicUrl }: { app: Status["apps"][number]; publicUrl: string | null }) {
  const now = useNow();
  const queryClient = useQueryClient();
  // Follows Funnel's address, which can appear after the page opens, until something is typed.
  const [typed, setUrl] = useState<string | null>(null);
  const url = typed ?? publicUrl ?? "";
  const configure = useMutation({
    mutationFn: () =>
      call(
        api.webhooks.github[":forgeId"].$post({ param: { forgeId: app.forgeId }, json: { url } }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: webhookStatusQuery.queryKey }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    configure.mutate();
  };
  const pointed = app.secretSet && pointsAt(app.hookUrl, publicUrl);
  return (
    <div className="border-t border-tt-rule pb-1 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-1">
        <b className="text-[13.5px] font-bold">{app.name}</b>
        {app.lastDelivery ? (
          <Chip tone="ok">Delivering · last {timeAgo(app.lastDelivery.at, now)}</Chip>
        ) : (
          <Chip tone="neutral">No delivery yet</Chip>
        )}
      </div>
      {app.error && <ErrorText className="px-4" error={app.error} />}
      <div className="flex items-start gap-3 px-4 py-2">
        <span role="img" aria-label={pointed ? "Done" : "To do"} className={dot(!!pointed)} />
        <div className="min-w-0 flex-1">
          <b className="block text-[13px] font-bold">2. Point its webhook at Runyard</b>
          <div className="text-tt-ink-2">
            {pointed ? (
              <>
                GitHub sends to <span className="font-mono break-all">{app.hookUrl}</span>, signed
                with a secret only Runyard and GitHub know.
              </>
            ) : (
              <>
                {app.hookUrl && (
                  <>
                    It points at <span className="font-mono break-all">{app.hookUrl}</span>, not the
                    public address.{" "}
                  </>
                )}
                Runyard sets the app's webhook URL and a new secret through GitHub's API.
              </>
            )}
          </div>
          <form onSubmit={submit} className="mt-2.5 flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <TtField
                label="Runyard's public address"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://runyard.example.ts.net"
                required
              />
            </div>
            <button
              type="submit"
              className={pointed ? ttButton.secondary : ttButton.primary}
              disabled={configure.isPending || !url}
            >
              {pointed ? "Set again with a new secret" : "Set webhook"}
            </button>
          </form>
          {configure.error && <ErrorText className="mt-1" error={configure.error} />}
        </div>
      </div>
      <div className="flex items-start gap-3 px-4 py-2">
        <span
          role="img"
          aria-label={app.subscribed === true ? "Done" : "To do"}
          className={dot(app.subscribed === true)}
        />
        <div className="min-w-0 flex-1">
          <b className="block text-[13px] font-bold">3. Switch it on in GitHub</b>
          <div className="text-tt-ink-2">
            {app.subscribed ? (
              <>
                Already subscribed to Workflow job events. On the app's{" "}
                <b className="font-semibold text-tt-ink">General</b> page, check{" "}
                <b className="font-semibold text-tt-ink">Active</b> under Webhook and save; GitHub's
                API can't do this for Runyard.{" "}
              </>
            ) : (
              <>
                On the app's <b className="font-semibold text-tt-ink">General</b> page, check{" "}
                <b className="font-semibold text-tt-ink">Active</b> under Webhook. Then, under{" "}
                <b className="font-semibold text-tt-ink">Permissions & events</b>, check{" "}
                <b className="font-semibold text-tt-ink">Workflow job</b> under Subscribe to events.
                Save each page; GitHub's API can't do this for Runyard.{" "}
              </>
            )}
            <a
              href={app.settingsUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-tt-ink underline"
            >
              Open the app's settings
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
