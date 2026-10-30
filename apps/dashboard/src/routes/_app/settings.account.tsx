import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { AccessTokens } from "../../components/AccessTokens.tsx";
import { SetupSummary } from "../../components/SetupChecklist.tsx";
import { Button, TextField } from "../../components/form.tsx";
import { Card, ErrorText, Pill, Section } from "../../components/ui.tsx";
import { addPasskey, passkeysAvailable } from "../../lib/passkeys.ts";
import { passkeysQuery, sessionQuery } from "../../lib/queries.ts";

export const Route = createFileRoute("/_app/settings/account")({
  component: Account,
});

function Account() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const passkeys = useQuery(passkeysQuery);
  const user = session.user;
  if (!user) return null;
  const name = user.username ?? user.tailscaleLogin ?? "Account";
  const count = passkeys.data?.length;
  return (
    <div className="max-w-2xl">
      <Card className="mt-6 flex items-start gap-4 px-5 py-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[17px] font-semibold text-accent uppercase">
          {name[0]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{name}</span>
            <Pill tone={user.role === "admin" ? "info" : "muted"}>
              {user.role === "admin" ? "Admin" : "Viewer"}
            </Pill>
          </div>
          <dl className="mt-2 grid grid-cols-[110px_1fr] gap-y-1 text-[12.5px]">
            <dt className="text-ink-2">Password</dt>
            <dd>
              {user.username ? (
                <>
                  Set for <span className="font-mono">{user.username}</span>
                </>
              ) : (
                "None"
              )}
            </dd>
            <dt className="text-ink-2">Tailscale</dt>
            <dd className="truncate">
              {user.tailscaleLogin ? (
                <span className="font-mono">{user.tailscaleLogin}</span>
              ) : (
                "Not linked"
              )}
            </dd>
            <dt className="text-ink-2">Passkeys</dt>
            <dd>{count === undefined ? "…" : count === 0 ? "None" : count}</dd>
          </dl>
        </div>
      </Card>
      <Passkeys />
      <AccessTokens admin={user.role === "admin"} />
      {user.username && <ChangePassword />}
      {user.role === "admin" && <SetupSummary />}
    </div>
  );
}

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = useMutation({
    mutationFn: () => call(api.me.password.$post({ json: { current, next } })),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setOpen(false);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    change.mutate();
  };
  return (
    <Section
      title="Password"
      action={
        !open && (
          <Button small onClick={() => setOpen(true)}>
            Change password
          </Button>
        )
      }
    >
      {!open ? (
        <Card className="px-4 py-3 text-[12.5px] text-ink-2">
          {change.isSuccess
            ? "Password changed. Your other sessions were signed out."
            : "Changing it signs out your other sessions."}
        </Card>
      ) : (
        <Card className="px-4 py-4">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <TextField
              label="Current password"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
            <TextField
              label="New password"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              description="At least 12 characters. Your other sessions are signed out."
              required
            />
            {change.error && <ErrorText error={change.error} />}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={change.isPending}>
                Change password
              </Button>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}
    </Section>
  );
}

function Passkeys() {
  const queryClient = useQueryClient();
  const passkeys = useQuery(passkeysQuery);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: passkeysQuery.queryKey });
  const add = useMutation({
    mutationFn: () => addPasskey(name),
    onSuccess: async () => {
      setName("");
      setAdding(false);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => call(api.passkeys[":id"].$delete({ param: { id } })),
    onSuccess: refresh,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  const available = passkeysAvailable();

  return (
    <Section
      title="Passkeys"
      action={
        available &&
        !adding && (
          <Button small onClick={() => setAdding(true)}>
            Add passkey
          </Button>
        )
      }
    >
      <Card className="overflow-hidden">
        {passkeys.data?.length === 0 && !adding && (
          <p className="px-4 py-3 text-[12.5px] text-ink-2">
            None yet. A passkey signs you in with Touch ID, Windows Hello or a security key instead
            of your password.
          </p>
        )}
        {passkeys.data?.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{p.name}</div>
              <div className="truncate text-[12px] text-ink-2">
                {p.rpId} · added {new Date(p.createdAt).toLocaleDateString()}
                {p.lastUsedAt && ` · last used ${new Date(p.lastUsedAt).toLocaleDateString()}`}
              </div>
            </div>
            <ConfirmDialog
              trigger="Remove"
              title={`Remove passkey ${p.name}?`}
              description="It can't sign you in anymore. Your password and other passkeys still work."
              confirm="Remove passkey"
              onConfirm={() => remove.mutate(p.id)}
              pending={remove.isPending}
              error={remove.error}
            />
          </div>
        ))}
        {!available && (
          <p className="px-4 py-3 text-[12.5px] text-ink-2">
            Passkeys need HTTPS or localhost. Open Runyard at its tailnet address to add one.
          </p>
        )}
        {available && adding && (
          <div className="px-4 py-4">
            <form onSubmit={submit} className="flex flex-col gap-3">
              <TextField
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="MacBook Touch ID"
                description="A passkey works only on the address you add it from."
                required
              />
              {add.error && <ErrorText error={add.error} />}
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={add.isPending}>
                  Add passkey
                </Button>
                <Button onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        )}
      </Card>
    </Section>
  );
}
