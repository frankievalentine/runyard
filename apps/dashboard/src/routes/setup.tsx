import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../api.ts";
import { AuthCard } from "../components/AuthCard.tsx";
import { Button, TextField } from "../components/form.tsx";
import { ErrorText } from "../components/ui.tsx";
import { sessionQuery } from "../lib/queries.ts";

export const Route = createFileRoute("/setup")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (!session.setupRequired) throw redirect({ to: session.user ? "/" : "/login" });
  },
  component: Setup,
});

function Setup() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const viaTailscale = session.tailscaleLogin !== null;

  const setup = useMutation({
    mutationFn: () =>
      call(api.setup.$post({ json: { code, ...(username ? { username, password } : {}) } })),
    onSuccess: (next) => {
      queryClient.setQueryData(sessionQuery.queryKey, next);
      void navigate({ to: "/" });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setup.mutate();
  };
  const address = useQuery({
    queryKey: ["setup-address"],
    queryFn: () => call(api.setup.address.$get()),
  }).data?.tailnetUrl;
  const here = typeof window !== "undefined" && address?.startsWith(window.location.origin);

  return (
    <AuthCard title="Create the first admin">
      <p className="mt-2 text-[13px] text-ink-2">
        Runyard printed a setup code in its log when it started. Enter it to claim this install.
      </p>
      {address && !here && (
        <p className="mt-3 rounded-md border border-line bg-sunken/60 px-3 py-2 text-[12.5px] text-ink-2">
          From your other devices, Runyard is at{" "}
          <a href={address} className="font-mono text-accent hover:underline">
            {address}
          </a>
          . Bookmark it: there, Tailscale signs you in.
        </p>
      )}
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
        <TextField
          label="Setup code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          spellCheck={false}
          required
          autoFocus
        />
        {viaTailscale && (
          <p className="text-[12.5px] text-ink-2">
            You'll sign in as <span className="font-medium text-ink">{session.tailscaleLogin}</span>{" "}
            through Tailscale. A username and password are optional, for signing in without
            Tailscale.
          </p>
        )}
        <TextField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required={!viaTailscale}
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          description="At least 12 characters."
          required={!viaTailscale || username !== ""}
        />
        {setup.error && <ErrorText error={setup.error} />}
        <Button type="submit" variant="primary" disabled={setup.isPending}>
          Create admin
        </Button>
      </form>
    </AuthCard>
  );
}
