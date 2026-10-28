import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { Button, TextField } from "../../components/form.tsx";
import { Card, ErrorText, Section } from "../../components/ui.tsx";
import { addPasskey, passkeysAvailable } from "../../lib/passkeys.ts";
import { passkeysQuery, sessionQuery } from "../../lib/queries.ts";

export const Route = createFileRoute("/_app/account")({
  component: Account,
});

function Account() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const user = session.user;
  if (!user) return null;
  return (
    <>
      <h1 className="text-[20px] font-semibold tracking-tight">Account</h1>
      <Section title="Sign-in">
        <Card className="flex flex-col gap-1 px-4 py-3 text-[13px]">
          {user.username && (
            <div>
              Username <span className="font-mono text-ink-2">{user.username}</span>
            </div>
          )}
          {user.tailscaleLogin && (
            <div>
              Tailscale <span className="font-mono text-ink-2">{user.tailscaleLogin}</span>
            </div>
          )}
        </Card>
      </Section>
      <Passkeys />
      {user.username && <ChangePassword />}
    </>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = useMutation({
    mutationFn: () => call(api.me.password.$post({ json: { current, next } })),
    onSuccess: () => {
      setCurrent("");
      setNext("");
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    change.mutate();
  };
  return (
    <Section title="Change password">
      <Card className="max-w-md px-4 py-4">
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
          {change.isSuccess && <p className="text-[12px] text-ink-2">Password changed.</p>}
          <div>
            <Button type="submit" variant="primary" disabled={change.isPending}>
              Change password
            </Button>
          </div>
        </form>
      </Card>
    </Section>
  );
}

function Passkeys() {
  const queryClient = useQueryClient();
  const passkeys = useQuery(passkeysQuery);
  const [name, setName] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: passkeysQuery.queryKey });
  const add = useMutation({
    mutationFn: () => addPasskey(name),
    onSuccess: async () => {
      setName("");
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
    <Section title="Passkeys">
      <Card className="max-w-md overflow-hidden">
        {passkeys.data?.length === 0 && (
          <p className="border-b border-line px-4 py-3 text-[12.5px] text-ink-2">
            No passkeys yet.
          </p>
        )}
        {passkeys.data?.map((p) => (
          <div key={p.id} className="flex items-center gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{p.name}</div>
              <div className="truncate text-[12px] text-ink-2">
                {p.rpId} · added {new Date(p.createdAt).toLocaleDateString()}
                {p.lastUsedAt && ` · last used ${new Date(p.lastUsedAt).toLocaleDateString()}`}
              </div>
            </div>
            <Button
              variant="danger"
              small
              onClick={() => remove.mutate(p.id)}
              disabled={remove.isPending}
            >
              Remove
            </Button>
          </div>
        ))}
        <div className="px-4 py-4">
          {available ? (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <TextField
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="MacBook Touch ID"
                description="A passkey works only on the address you add it from."
                required
              />
              {(add.error ?? remove.error) && <ErrorText error={add.error ?? remove.error} />}
              <div>
                <Button type="submit" variant="primary" disabled={add.isPending}>
                  Add passkey
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-[12.5px] text-ink-2">
              Passkeys need HTTPS or localhost. Open Runyard through tailscale serve to add one.
            </p>
          )}
        </div>
      </Card>
    </Section>
  );
}
