import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../api.ts";
import { AuthCard } from "../components/AuthCard.tsx";
import { Button, TextField } from "../components/form.tsx";
import { ErrorText } from "../components/ui.tsx";
import { passkeysAvailable, signInWithPasskey } from "../lib/passkeys.ts";
import { sessionQuery } from "../lib/queries.ts";

export const Route = createFileRoute("/login")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.setupRequired) throw redirect({ to: "/setup" });
    if (session.user) throw redirect({ to: "/" });
  },
  component: Login,
});

function Login() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => call(api.login.$post({ json: { username, password } })),
    onSuccess: (next) => {
      queryClient.setQueryData(sessionQuery.queryKey, next);
      void navigate({ to: "/" });
    },
  });

  const passkey = useMutation({
    mutationFn: signInWithPasskey,
    onSuccess: (next) => {
      queryClient.setQueryData(sessionQuery.queryKey, next);
      void navigate({ to: "/" });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <AuthCard title="Sign in">
      {session.tailscaleLogin && (
        <p className="mt-2 text-[12.5px] text-ink-2">
          <span className="font-medium text-ink">{session.tailscaleLogin}</span> isn't a Runyard
          user. Ask an admin to add it, or sign in with a password.
        </p>
      )}
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
        <TextField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          autoFocus
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {login.error && <ErrorText error={login.error} />}
        <Button type="submit" variant="primary" disabled={login.isPending}>
          Sign in
        </Button>
      </form>
      {passkeysAvailable() && (
        <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
          <Button onClick={() => passkey.mutate()} disabled={passkey.isPending}>
            Sign in with a passkey
          </Button>
          {passkey.error && <ErrorText error={passkey.error} />}
        </div>
      )}
    </AuthCard>
  );
}
