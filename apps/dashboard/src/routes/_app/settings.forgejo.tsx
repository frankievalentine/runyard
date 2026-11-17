import type { ForgejoConnectionView } from "@runyard/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { ErrorText } from "../../components/ui.tsx";
import { Chip, PageHead, Panel, ttButton } from "../../components/tt.tsx";
import { Note, RowText, SIcon, TtConfirm, TtField } from "../../components/settings/parts.tsx";
import { yardQuery, useYard } from "../../lib/yard.ts";
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
  const { forgejo } = useYard();
  const n = forgejo.connections.length;
  return (
    <div>
      <PageHead
        back={{ to: "/settings/connections", label: "Settings" }}
        sign={<SIcon name="link" size={26} />}
        title="Forgejo"
        lede="Runyard reads and registers runners on a Forgejo instance with one user's access token: that user's own runners and those of the organizations they own."
      />
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2 lg:gap-[18px]">
        <Panel title="Connections" meta={n ? plural(n, "connection") : "None yet"}>
          {n === 0 ? (
            <Note>No Forgejo connection yet. Add one with an access token.</Note>
          ) : (
            forgejo.connections.map((c) => <ConnectionRows key={c.forgeId} conn={c} />)
          )}
        </Panel>
        <Connect />
      </div>
    </div>
  );
}

function ConnectionRows({ conn }: { conn: ForgejoConnectionView }) {
  const now = useNow();
  return (
    <div className="border-t border-tt-rule">
      <div className="flex flex-wrap items-center gap-3 px-4 py-[11px]">
        <SIcon name="link" />
        <RowText
          className="basis-60"
          title={
            <a href={conn.baseUrl} target="_blank" rel="noreferrer" className="hover:underline">
              {conn.login} on {new URL(conn.baseUrl).host}
            </a>
          }
          detail={conn.version ? `Forgejo ${conn.version.split("+")[0]}` : "Version not read yet"}
        />
        <Chip tone={conn.error ? "error" : "ok"}>{conn.error ? "Error" : "Connected"}</Chip>
        <RemoveConnection conn={conn} />
      </div>
      {conn.error && <ErrorText className="px-4 pb-2" error={conn.error} />}
      {conn.scopes.length > 0 && (
        <ul className="pb-1.5">
          {conn.scopes.map((s) => {
            const problem = s.runnersError ?? s.jobsError;
            const open = s.publicRepos ?? [];
            return (
              <li
                key={`${s.kind}:${s.target}`}
                className="flex items-start gap-3 py-2 pr-4 pl-[46px] text-[12.5px]"
              >
                <span
                  aria-hidden
                  className={`mt-[7px] size-2 flex-none rounded-full ${problem ? "bg-tt-bad" : s.runnersAt ? "bg-tt-ok" : "border-[1.5px] border-tt-off"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {s.target}{" "}
                    <span className="font-normal text-tt-ink-3">
                      · {s.kind === "org" ? "organization runners" : "account runners"}
                    </span>
                  </div>
                  <div className="text-tt-ink-2">
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
    </div>
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
      await queryClient.invalidateQueries({ queryKey: yardQuery.queryKey });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    connect.mutate();
  };
  return (
    <Panel title="Connect Forgejo">
      <form onSubmit={submit} className="flex flex-col gap-4 px-4 pb-4 text-[13px]">
        <p className="text-tt-ink-2">
          Create an access token in Forgejo under{" "}
          <b className="font-semibold text-tt-ink">Settings ▸ Applications</b> with{" "}
          <b className="font-semibold text-tt-ink">user</b>,{" "}
          <b className="font-semibold text-tt-ink">organization</b> and{" "}
          <b className="font-semibold text-tt-ink">repository</b> set to read and write: Forgejo
          files each runner endpoint under the scope of its path. Runyard needs Forgejo 15 or later
          and stores the token encrypted.
        </p>
        <TtField
          label="Forgejo address"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <TtField
          label="Access token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
        {connect.error && <ErrorText error={connect.error} />}
        <div>
          <button type="submit" className={ttButton.primary} disabled={connect.isPending || demo}>
            Connect
          </button>
        </div>
        {demo && (
          <p className="text-[12px] text-tt-ink-3">
            Not available with demo data: this would contact a real Forgejo.
          </p>
        )}
      </form>
    </Panel>
  );
}

function RemoveConnection({ conn }: { conn: ForgejoConnectionView }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => call(api.forgejo.connections[":id"].$delete({ param: { id: conn.forgeId } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });
  return (
    <TtConfirm
      trigger="Remove"
      title={`Remove ${conn.login} on ${new URL(conn.baseUrl).host}?`}
      description="Runyard forgets the connection and its token. Runners already registered keep running; revoke the token in Forgejo if it's no longer needed."
      confirm="Remove"
      onConfirm={() => remove.mutate()}
      pending={remove.isPending}
      error={remove.error}
    />
  );
}
