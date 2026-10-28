import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { Button, TextField } from "../../components/form.tsx";
import { Card, ErrorText, Section } from "../../components/ui.tsx";
import { sessionQuery } from "../../lib/queries.ts";

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
