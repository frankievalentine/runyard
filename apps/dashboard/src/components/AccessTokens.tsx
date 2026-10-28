import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, call } from "../api.ts";
import { CopyValue } from "./CopyValue.tsx";
import { Button, TextField } from "./form.tsx";
import { Card, ErrorText, Pill, Section } from "./ui.tsx";

const tokensKey = ["access-tokens"];

/**
 * The user's access tokens, for agents using Runyard's MCP server. A new
 * token is shown once; the list never shows the secret.
 */
export function AccessTokens({ admin }: { admin: boolean }) {
  const queryClient = useQueryClient();
  const tokens = useQuery({ queryKey: tokensKey, queryFn: () => call(api.tokens.$get()) });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "prepare">("read");
  const [expires, setExpires] = useState<"30" | "90" | "365" | "never">("90");
  const [created, setCreated] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: tokensKey });
  const add = useMutation({
    mutationFn: () =>
      call(
        api.tokens.$post({
          json: {
            name,
            scope,
            expiresInDays: expires === "never" ? null : (Number(expires) as 30 | 90 | 365),
          },
        }),
      ),
    onSuccess: async ({ token }) => {
      setCreated(token);
      setAdding(false);
      setName("");
      await refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => call(api.tokens[":id"].$delete({ param: { id } })),
    onSuccess: refresh,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  const now = Date.now();

  return (
    <Section
      title="Access tokens"
      action={
        !adding && (
          <Button small onClick={() => setAdding(true)}>
            New token
          </Button>
        )
      }
    >
      <Card className="overflow-hidden">
        <p className="border-b border-line px-4 py-3 text-[12.5px] text-ink-2">
          For AI agents using Runyard's MCP server. A token acts as you, never with more access than
          you have; tokens that prepare changes can save pools and prepare reviews, but only you run
          a review, here in the dashboard.
        </p>
        {created && (
          <div className="flex flex-col gap-1.5 border-b border-line bg-ok/5 px-4 py-3 text-[12.5px]">
            <span className="font-medium">
              Copy the new token now; Runyard won't show it again.
            </span>
            <div className="rounded-md border border-line bg-bg px-2.5 py-1.5">
              <CopyValue
                value={created}
                label="Access token"
                className="font-mono text-[12px] break-all"
              />
            </div>
            <div>
              <Button small variant="ghost" onClick={() => setCreated(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
        {tokens.data?.length === 0 && !adding && !created && (
          <p className="px-4 py-3 text-[12.5px] text-ink-2">None yet.</p>
        )}
        {tokens.data?.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium">{t.name}</span>
                <Pill tone={t.scope === "prepare" ? "info" : "muted"}>
                  {t.scope === "prepare" ? "Read and prepare" : "Read only"}
                </Pill>
              </div>
              <div className="truncate text-[12px] text-ink-2">
                <span className="font-mono">{t.prefix}…</span> · created{" "}
                {new Date(t.createdAt).toLocaleDateString()}
                {t.expiresAt
                  ? t.expiresAt <= now
                    ? " · expired"
                    : ` · expires ${new Date(t.expiresAt).toLocaleDateString()}`
                  : " · never expires"}
                {t.lastUsedAt
                  ? ` · last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                  : " · never used"}
              </div>
            </div>
            <Button
              variant="danger"
              small
              onClick={() => revoke.mutate(t.id)}
              disabled={revoke.isPending}
            >
              Revoke
            </Button>
          </div>
        ))}
        {adding && (
          <form onSubmit={submit} className="flex flex-col gap-3 px-4 py-4">
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Claude Code on my laptop"
              description="Which agent uses it; changes it prepares are recorded under this name."
              required
            />
            <div className="grid grid-cols-1 gap-3 min-[600px]:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-ink-2">Access</span>
                <select
                  className="input"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as "read" | "prepare")}
                >
                  <option value="read">Read only</option>
                  {admin && <option value="prepare">Read and prepare changes</option>}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-ink-2">Expires</span>
                <select
                  className="input"
                  value={expires}
                  onChange={(e) => setExpires(e.target.value as typeof expires)}
                >
                  <option value="30">In 30 days</option>
                  <option value="90">In 90 days</option>
                  <option value="365">In a year</option>
                  <option value="never">Never</option>
                </select>
              </label>
            </div>
            {add.error && <ErrorText error={add.error} />}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={add.isPending}>
                Create token
              </Button>
              <Button onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </form>
        )}
        {revoke.error && <ErrorText className="px-4 py-3" error={revoke.error} />}
      </Card>
    </Section>
  );
}
