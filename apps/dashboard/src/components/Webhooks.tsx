import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, call } from "../api.ts";
import { timeAgo } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";
import { CopyValue } from "./CopyValue.tsx";
import { Button, TextField } from "./form.tsx";
import { Card, EmptyLine, ErrorText, Pill, StatusDot } from "./ui.tsx";

const statusQuery = {
  queryKey: ["webhook-status"],
  queryFn: () => call(api.webhooks.status.$get()),
};

type Status = Awaited<ReturnType<typeof statusQuery.queryFn>>;

/**
 * Optional GitHub webhooks: Funnel (or a proxy) exposes the webhook listener,
 * Runyard points each app's hook at it, and GitHub's settings switch it on.
 * Deliveries only make Runyard re-read sooner; polling keeps working without them.
 */
export function Webhooks() {
  const status = useQuery(statusQuery);
  if (status.isPending)
    return <Card className="px-4 py-3 text-[12.5px] text-ink-2">Checking…</Card>;
  if (status.error) return <ErrorText error={status.error} />;
  const s = status.data;
  if (s.port === null) {
    return (
      <Card>
        <EmptyLine>
          The webhook listener is off (RUNYARD_WEBHOOKS=off). Runyard polls GitHub instead.
        </EmptyLine>
      </Card>
    );
  }
  const command = `tailscale funnel --bg http://127.0.0.1:${s.port}`;
  return (
    <div className="max-w-3xl space-y-3 text-[13px]">
      <p className="text-ink-2">
        Optional. Without webhooks Runyard notices queued jobs within about 45 seconds; with them,
        within seconds. A delivery only makes Runyard re-read GitHub sooner; it never acts on what a
        delivery says.
      </p>
      <Card className="px-4 py-3">
        <div className="flex items-center gap-2 font-medium">
          <StatusDot tone={s.funnelUrl ? "ok" : "warn"} hollow={!s.funnelUrl} />
          1. Make the webhook listener public
        </div>
        {s.funnelUrl ? (
          <p className="mt-1 text-[12.5px] text-ink-2">
            Tailscale Funnel serves it at <span className="font-mono text-ink">{s.funnelUrl}</span>.
          </p>
        ) : (
          <div className="mt-1 space-y-1.5 text-[12.5px] text-ink-2">
            <p>
              Runyard listens for webhooks only on this machine, at 127.0.0.1:{s.port}, and serves
              nothing else there. Expose that port with Tailscale Funnel, which Runyard won't change
              for you:
            </p>
            <div className="rounded-md border border-line bg-sunken/60 px-3 py-2 font-mono text-[12px]">
              <CopyValue value={command} label="Command">
                {command}
              </CopyValue>
            </div>
            <p>
              Funnel must be allowed for this machine in your tailnet policy (the{" "}
              <span className="font-mono">funnel</span> node attribute).{" "}
              <a
                href="https://tailscale.com/kb/1223/funnel"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                How Funnel works
              </a>
              . Any HTTPS reverse proxy to that port works too.
            </p>
            {s.funnelError && (
              <p className="text-warn">Couldn't read Funnel's status: {s.funnelError}</p>
            )}
          </div>
        )}
      </Card>
      {s.apps.length === 0 ? (
        <Card>
          <EmptyLine>Create a GitHub App first; then point its webhook here.</EmptyLine>
        </Card>
      ) : (
        s.apps.map((app) => <AppHook key={app.forgeId} app={app} publicUrl={s.funnelUrl} />)
      )}
    </div>
  );
}

function AppHook({ app, publicUrl }: { app: Status["apps"][number]; publicUrl: string | null }) {
  const now = useNow();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(publicUrl ?? "");
  const configure = useMutation({
    mutationFn: () =>
      call(
        api.webhooks.github[":forgeId"].$post({ param: { forgeId: app.forgeId }, json: { url } }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusQuery.queryKey }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    configure.mutate();
  };
  // A new app's manifest sets a placeholder URL; once Funnel's address is known, only that counts.
  const pointed = Boolean(
    app.hookUrl &&
    app.secretSet &&
    (publicUrl
      ? app.hookUrl.startsWith(publicUrl)
      : !/\/\/(127\.0\.0\.1|localhost)[:/]/.test(app.hookUrl)),
  );
  return (
    <Card className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 font-medium">
        {app.name}
        {app.lastDelivery ? (
          <Pill tone="ok">Delivering · last {timeAgo(app.lastDelivery.at, now)}</Pill>
        ) : (
          <Pill tone="muted" hollow>
            No delivery yet
          </Pill>
        )}
      </div>
      {app.error && <ErrorText className="mt-1" error={app.error} />}
      <div className="mt-2 space-y-2 text-[12.5px]">
        <div className="flex items-start gap-2">
          <span className="mt-1">
            <StatusDot tone={pointed ? "ok" : "warn"} hollow={!pointed} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">2. Point its webhook at Runyard</div>
            <div className="text-ink-2">
              {pointed ? (
                <>
                  GitHub sends to <span className="font-mono">{app.hookUrl}</span>, signed with a
                  secret only Runyard and GitHub know.
                </>
              ) : (
                "Runyard sets the app's webhook URL and a new secret through GitHub's API."
              )}
            </div>
            <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2">
              <div className="min-w-64 flex-1">
                <TextField
                  label="Runyard's public address"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://runyard.example.ts.net"
                  required
                />
              </div>
              <Button
                type="submit"
                variant={pointed ? undefined : "primary"}
                disabled={configure.isPending || !url}
              >
                {pointed ? "Set again with a new secret" : "Set webhook"}
              </Button>
            </form>
            {configure.error && <ErrorText className="mt-1" error={configure.error} />}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <span className="mt-1">
            <StatusDot tone={app.subscribed ? "ok" : "warn"} hollow={!app.subscribed} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">3. Switch it on in GitHub</div>
            <div className="text-ink-2">
              {app.subscribed
                ? "Subscribed to Workflow job events."
                : "Not subscribed to Workflow job events yet."}{" "}
              In the app's settings, tick <b className="font-medium text-ink">Active</b> under
              Webhook and <b className="font-medium text-ink">Workflow job</b> under Subscribe to
              events; GitHub's API can't change these.{" "}
              <a
                href={app.settingsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Open the app's settings
              </a>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
