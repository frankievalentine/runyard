import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { timeAgo } from "../lib/format.ts";
import { useState, type FormEvent } from "react";
import { api, call } from "../api.ts";
import { CopyValue } from "./CopyValue.tsx";
import { ErrorText } from "./ui.tsx";
import { Panel, Row, ttButton } from "./tt.tsx";
import {
  DialogButtons,
  SIcon,
  TtConfirm,
  TtDialog,
  TtField,
  rowButton,
  ttSelect,
} from "./settings/parts.tsx";
import { InfoTip, RowTip, TipText } from "./InfoTip.tsx";

const tokensKey = ["access-tokens"];

/** "Oct 29", or "Jan 27, 2027" outside this year: a day without the ambiguity of 10/29/2026. */
const formatDay = (at: number) =>
  new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(new Date(at).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });

const ACCESS = {
  read: {
    title: "Read only",
    detail: "Sees what the dashboard shows: machines, pools, runners and queued jobs.",
  },
  prepare: {
    title: "Read and prepare",
    detail:
      "Also saves pools, adds machines and prepares reviews. Only you run a review, here in the dashboard.",
  },
} as const;

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
  const setAccess = useMutation({
    mutationFn: ({ id, scope }: { id: string; scope: "read" | "prepare" }) =>
      call(api.tokens[":id"].$patch({ param: { id }, json: { scope } })),
    onSuccess: refresh,
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
    <Panel
      id="tokens"
      title={
        <span className="inline-flex items-center gap-1.5">
          Access tokens for AI agents
          <InfoTip label="access tokens">
            <TipText
              what="An AI agent connects to Runyard over MCP with one of these. It acts as you, never with more access than you have."
              details="Read and prepare lets it also save pools and prepare reviews. Only you can run a review, here in the dashboard."
            />
          </InfoTip>
        </span>
      }
      action={
        <button type="button" className={rowButton.secondary} onClick={() => setAdding(true)}>
          New token
        </button>
      }
    >
      {created && (
        <div className="mx-4 mb-3 flex flex-col gap-2 rounded-lg border border-tt-rule bg-tt-hover px-3.5 py-3 text-[12.5px]">
          <span className="font-semibold">
            Copy the new token now; Runyard won't show it again.
          </span>
          <div className="rounded-md border border-tt-rule bg-tt-card px-2.5 py-1.5">
            <CopyValue
              value={created}
              label="Access token"
              className="font-mono text-[12px] break-all"
            />
          </div>
          <div>
            <button type="button" className={rowButton.secondary} onClick={() => setCreated(null)}>
              Done
            </button>
          </div>
        </div>
      )}
      {tokens.error && <ErrorText className="px-4 pb-3" error={tokens.error} />}
      {tokens.data?.length === 0 && !created && (
        <p className="px-4 pb-1 text-[13px] text-tt-ink-2">
          <b className="font-semibold text-tt-ink">No tokens yet.</b> Create one to let an AI agent
          read your CI.
        </p>
      )}
      {tokens.data?.map((t) => (
        <Row key={t.id} className="flex-wrap">
          <SIcon name="key" />
          <span className="min-w-0 flex-1 basis-48">
            <b className="block truncate font-mono text-[13px] font-bold">{t.name}</b>
            <small className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-tt-ink-3">
              {[
                !admin && <span key="scope">{ACCESS[t.scope].title}</span>,
                <RowTip
                  key="prefix"
                  content={<TipText what="The start of the token, to tell your tokens apart." />}
                >
                  <span className="font-mono">{t.prefix}…</span>
                </RowTip>,
                <span key="created">created {formatDay(t.createdAt)}</span>,
                t.expiresAt && t.expiresAt <= now ? (
                  <span key="expires" className="font-semibold text-tt-bad-ink">
                    expired {formatDay(t.expiresAt)}
                  </span>
                ) : (
                  <span key="expires">
                    {t.expiresAt ? `expires ${formatDay(t.expiresAt)}` : "never expires"}
                  </span>
                ),
                t.lastUsedAt ? (
                  <RowTip
                    key="used"
                    content={<TipText what={new Date(t.lastUsedAt).toLocaleString()} />}
                  >
                    <span>used {timeAgo(t.lastUsedAt, now)}</span>
                  </RowTip>
                ) : (
                  <span key="used">never used</span>
                ),
              ]
                .filter(Boolean)
                .map((part, i) =>
                  i === 0 ? (
                    part
                  ) : (
                    // The dot travels with what follows it, so a wrap never leaves one dangling.
                    <span key={i} className="inline-flex items-center gap-x-1.5 whitespace-nowrap">
                      <span aria-hidden>·</span>
                      {part}
                    </span>
                  ),
                )}
            </small>
          </span>
          <span className="flex items-center gap-2">
            {/* Admins change a token's access here; others see it in the line above. */}
            {admin && (
              <select
                aria-label={`Access for ${t.name}`}
                className={`${ttSelect} !h-[32px] !w-auto !text-[12.5px]`}
                value={t.scope}
                disabled={setAccess.isPending}
                onChange={(e) =>
                  setAccess.mutate({ id: t.id, scope: e.target.value as "read" | "prepare" })
                }
              >
                <option value="read">Read only</option>
                <option value="prepare">Read and prepare</option>
              </select>
            )}
            <TtConfirm
              trigger="Revoke"
              title={`Revoke ${t.name}?`}
              description="Anything using it is refused from its next request. This can't be undone; make a new token to give access again."
              confirm="Revoke token"
              onConfirm={() => revoke.mutate(t.id)}
              pending={revoke.isPending}
              error={revoke.error}
            />
          </span>
        </Row>
      ))}
      {setAccess.error && <ErrorText className="px-4 py-2" error={setAccess.error} />}
      <TtDialog open={adding} onOpenChange={setAdding} title="New access token">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <TtField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Claude Code on my laptop"
            hint="Which agent uses it; changes it prepares are recorded under this name."
            required
            autoFocus
          />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[12.5px] font-semibold text-tt-ink-2">Access</legend>
            <div className="grid grid-cols-1 gap-2 min-[600px]:grid-cols-2">
              {(["read", "prepare"] as const).map((value) => {
                const disabled = value === "prepare" && !admin;
                return (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-[10px] border-[1.5px] bg-tt-card px-3 py-2.5 ${
                      scope === value
                        ? "border-tt-ink shadow-[inset_0_0_0_1px_var(--tt-ink)]"
                        : "border-tt-rule-2"
                    } ${disabled ? "cursor-not-allowed opacity-55" : ""}`}
                  >
                    <input
                      type="radio"
                      name="token-access"
                      className="mt-[3px] shrink-0 accent-[var(--tt-ink)]"
                      checked={scope === value}
                      onChange={() => setScope(value)}
                      disabled={disabled}
                    />
                    <span>
                      <b className="block text-[13.5px]">{ACCESS[value].title}</b>
                      <small className="block text-[12px] text-tt-ink-2">
                        {disabled
                          ? "Only admins can make tokens that prepare changes."
                          : ACCESS[value].detail}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="flex max-w-60 flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-tt-ink-2">Expires</span>
            <select
              className={ttSelect}
              value={expires}
              onChange={(e) => setExpires(e.target.value as typeof expires)}
            >
              <option value="30">In 30 days</option>
              <option value="90">In 90 days</option>
              <option value="365">In a year</option>
              <option value="never">Never</option>
            </select>
          </label>
          {add.error && <ErrorText error={add.error} />}
          <DialogButtons>
            <button type="button" className={ttButton.secondary} onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className={ttButton.primary} disabled={add.isPending}>
              Create token
            </button>
          </DialogButtons>
        </form>
      </TtDialog>
    </Panel>
  );
}
