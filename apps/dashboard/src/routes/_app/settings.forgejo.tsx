import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { ForgejoConnectionView } from "@runyard/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { Button, TextField } from "../../components/form.tsx";
import {
  Card,
  EmptyLine,
  ErrorText,
  Pill,
  Section,
  StatusDot,
  SubHeader,
} from "../../components/ui.tsx";
import { fleetQuery, useFleet } from "../../lib/fleet.ts";
import { plural, timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { healthQuery, sessionQuery } from "../../lib/queries.ts";

export const Route = createFileRoute("/_app/settings/forgejo")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.user?.role !== "admin") throw redirect({ to: "/" });
  },
  component: ForgejoSettings,
});

function ForgejoSettings() {
  const { forgejo } = useFleet();
  return (
    <div>
      <SubHeader
        back={
          <Link to="/settings/connections" className="text-accent hover:underline">
            ← Connections
          </Link>
        }
        title="Forgejo"
        subtitle="Runyard reads and registers runners on a Forgejo instance with one user's access token: that user's own runners and those of the organizations they own."
      />
      <Section title="Connections" count={forgejo.connections.length}>
        {forgejo.connections.length === 0 ? (
          <Card>
            <EmptyLine>No Forgejo connection yet. Add one below.</EmptyLine>
          </Card>
        ) : (
          <div className="space-y-3">
            {forgejo.connections.map((c) => (
              <ConnectionCard key={c.forgeId} conn={c} />
            ))}
          </div>
        )}
      </Section>
      <Section title="Connect Forgejo">
        <Connect />
      </Section>
    </div>
  );
}

function ConnectionCard({ conn }: { conn: ForgejoConnectionView }) {
  const now = useNow();
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={conn.baseUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:underline"
            >
              {conn.login} on {new URL(conn.baseUrl).host}
            </a>
            <Pill tone={conn.error ? "bad" : "ok"}>{conn.error ? "Error" : "Connected"}</Pill>
          </div>
          <div className="text-[12px] text-ink-2">
            {conn.version ? `Forgejo ${conn.version.split("+")[0]}` : "Version not read yet"}
          </div>
        </div>
        <RemoveConnection conn={conn} />
      </div>
      {conn.error && <ErrorText className="px-4 py-2" error={conn.error} />}
      {conn.scopes.length > 0 && (
        <ul className="divide-y divide-line">
          {conn.scopes.map((s) => {
            const problem = s.runnersError ?? s.jobsError;
            const open = s.publicRepos ?? [];
            return (
              <li
                key={`${s.kind}:${s.target}`}
                className="flex flex-wrap items-start gap-3 px-4 py-3 text-[12.5px]"
              >
                <span className="mt-1.5">
                  <StatusDot
                    tone={problem ? "bad" : s.runnersAt ? "ok" : "muted"}
                    hollow={!s.runnersAt && !problem}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {s.target}{" "}
                    <span className="font-normal text-ink-2">
                      · {s.kind === "org" ? "organization runners" : "account runners"}
                    </span>
                  </div>
                  <div className="text-ink-2">
                    Runners {s.runnersAt ? `read ${timeAgo(s.runnersAt, now)}` : "not read yet"}
                    {open.length > 0 &&
                      ` · ${plural(open.length, "public repository", "public repositories")}`}
                  </div>
                  {problem && <ErrorText className="mt-1" error={problem} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Connect() {
  const demo = useQuery(healthQuery).data?.demo === true;
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("https://codeberg.org");
  const [token, setToken] = useState("");
  const connect = useMutation({
    mutationFn: () => call(api.forgejo.connections.$post({ json: { url, token } })),
    onSuccess: async () => {
      setToken("");
      await queryClient.invalidateQueries({ queryKey: fleetQuery.queryKey });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    connect.mutate();
  };
  return (
    <Card className="max-w-xl px-4 py-4">
      <form onSubmit={submit} className="flex flex-col gap-4 text-[13px]">
        <p className="text-ink-2">
          Create an access token in Forgejo under{" "}
          <b className="font-medium text-ink">Settings ▸ Applications</b> with{" "}
          <b className="font-medium text-ink">user</b>,{" "}
          <b className="font-medium text-ink">organization</b> and{" "}
          <b className="font-medium text-ink">repository</b> set to read and write: Forgejo files
          each runner endpoint under the scope of its path. Runyard needs Forgejo 15 or later and
          stores the token encrypted.
        </p>
        <TextField
          label="Forgejo address"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <TextField
          label="Access token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
        {connect.error && <ErrorText error={connect.error} />}
        <div>
          <Button type="submit" variant="primary" disabled={connect.isPending || demo}>
            Connect
          </Button>
        </div>
        {demo && (
          <p className="text-[12px] text-ink-3">
            Not available with demo data: this would contact a real Forgejo.
          </p>
        )}
      </form>
    </Card>
  );
}

function RemoveConnection({ conn }: { conn: ForgejoConnectionView }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => call(api.forgejo.connections[":id"].$delete({ param: { id: conn.forgeId } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: fleetQuery.queryKey }),
  });
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger render={<Button small variant="danger" />}>Remove</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-black/30" />
        <AlertDialog.Popup className="panel fixed top-1/2 left-1/2 w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 p-5">
          <AlertDialog.Title className="text-[15px] font-semibold">
            Remove {conn.login} on {new URL(conn.baseUrl).host}?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-[13px] text-ink-2">
            Runyard forgets the connection and its token. Runners already registered keep running;
            revoke the token in Forgejo if it's no longer needed.
          </AlertDialog.Description>
          {remove.error && <ErrorText className="mt-2" error={remove.error} />}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close render={<Button />}>Cancel</AlertDialog.Close>
            <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Remove
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
