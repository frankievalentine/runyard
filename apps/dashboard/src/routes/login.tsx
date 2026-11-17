import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../api.ts";
import {
  AuthField,
  AuthLayout,
  AuthNotice,
  authPrimary,
  authSecondary,
} from "../components/AuthLayout.tsx";
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

  // This device's Tailscale login is a Runyard user: this browser signed out of it.
  const offerTailscale = Boolean(session.tailscaleLogin && session.tailscaleUser);
  const tailscale = useMutation({
    mutationFn: () => call(api.login.tailscale.$post()),
    onSuccess: (next) => {
      queryClient.setQueryData(sessionQuery.queryKey, next);
      void navigate({ to: "/" });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const passkeys = passkeysAvailable();
  return (
    <AuthLayout
      board={[
        { text: "Sign in" },
        { text: window.location.hostname, tone: "dim" },
        { text: "Departures after sign-in", tone: "go" },
      ]}
    >
      <h1 className="text-[30px] leading-none font-extrabold [font-stretch:85%]">Sign in</h1>
      <p className="mt-2 text-[14px] text-tt-ink-2">
        {offerTailscale
          ? "This device's Tailscale login can sign you in."
          : passkeys
            ? "With a passkey, or your username and password."
            : "With your username and password."}
      </p>

      <div className="mt-6 flex flex-col gap-2.5">
        {offerTailscale && (
          <button
            type="button"
            className={authPrimary}
            onClick={() => tailscale.mutate()}
            disabled={tailscale.isPending}
          >
            Continue as {session.tailscaleLogin}
          </button>
        )}
        {tailscale.error && <AuthNotice>{message(tailscale.error)}</AuthNotice>}
        {passkeys && (
          <button
            type="button"
            className={offerTailscale ? authSecondary : authPrimary}
            onClick={() => passkey.mutate()}
            disabled={passkey.isPending}
          >
            {passkey.isPending ? "Waiting for your passkey…" : "Sign in with a passkey"}
          </button>
        )}
        {passkey.error && <AuthNotice>{message(passkey.error)}</AuthNotice>}
      </div>

      {session.tailscaleLogin && !session.tailscaleUser && (
        <div className="mt-4">
          <AuthNotice tone="info">
            <span className="font-semibold text-tt-ink">{session.tailscaleLogin}</span> isn't a
            Runyard user. Ask an admin to add it, or sign in with a password.
          </AuthNotice>
        </div>
      )}

      <div className="my-6 flex items-center gap-3 text-[12px] font-semibold tracking-[.08em] text-tt-ink-3 uppercase">
        <span className="h-px flex-1 bg-tt-rule" />
        {offerTailscale || passkeys ? "Or with a password" : "Password"}
        <span className="h-px flex-1 bg-tt-rule" />
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <AuthField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          autoFocus={!offerTailscale && !passkeys}
        />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {login.error && <AuthNotice>{message(login.error)}</AuthNotice>}
        <button
          type="submit"
          className={offerTailscale || passkeys ? authSecondary : authPrimary}
          disabled={login.isPending}
        >
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {!window.isSecureContext && (
        <div className="mt-6">
          <AuthNotice tone="warn">
            Passkeys need HTTPS. This address is plain http://, so passwords travel unencrypted.
            Open Runyard at its tailnet address to use a passkey.
          </AuthNotice>
        </div>
      )}
    </AuthLayout>
  );
}
