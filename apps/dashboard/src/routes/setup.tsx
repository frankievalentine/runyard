import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
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
import { formatSetupCode, passwordStrength } from "../lib/claim.ts";
import { addPasskey, passkeysAvailable, suggestedPasskeyName } from "../lib/passkeys.ts";
import { sessionQuery } from "../lib/queries.ts";

export const Route = createFileRoute("/setup")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (!session.setupRequired) throw redirect({ to: session.user ? "/" : "/login" });
  },
  component: Setup,
});

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const STRENGTH = ["At least 12 characters", "Fair", "Good", "Strong"] as const;

/** Claiming a new install with the setup code it printed, then offering a passkey. */
function Setup() {
  const [claimed, setClaimed] = useState(false);
  return claimed && passkeysAvailable() ? <OfferPasskey /> : <Claim onClaimed={setClaimed} />;
}

function Claim({ onClaimed }: { onClaimed: (claimed: boolean) => void }) {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const viaTailscale = session.tailscaleLogin !== null;
  const strength = passwordStrength(password);

  const setup = useMutation({
    mutationFn: () =>
      call(api.setup.$post({ json: { code, ...(username ? { username, password } : {}) } })),
    onSuccess: (next) => {
      queryClient.setQueryData(sessionQuery.queryKey, next);
      // A new install heads for Getting started, after a passkey if this browser can make one.
      if (passkeysAvailable()) onClaimed(true);
      else void navigate({ to: "/start" });
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
  const here = address?.startsWith(window.location.origin);

  return (
    <AuthLayout
      board={[
        { text: "New install" },
        { text: "Claim your Runyard", tone: "signal" },
        { text: "Enter the setup code", tone: "dim" },
      ]}
    >
      <p className="text-[12px] font-bold tracking-[.1em] text-tt-ink-3 uppercase">New install</p>
      <h1 className="mt-1 text-[30px] leading-none font-extrabold [font-stretch:85%]">
        Claim your Runyard
      </h1>
      <p className="mt-2 text-[14px] text-tt-ink-2">
        Runyard printed a one-time setup code in its terminal when it started. Enter it to create
        the first admin.
      </p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <AuthField
          label="Setup code"
          value={code}
          onChange={(e) => setCode(formatSetupCode(e.target.value))}
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="one-time-code"
          spellCheck={false}
          className="h-11 w-full rounded-lg border border-tt-rule-2 bg-tt-card px-3 font-board text-[16px] tracking-[.12em] text-tt-ink outline-none focus:border-tt-ink"
          hint="It's in Runyard's log, or the terminal where you started it."
          required
          autoFocus
        />
        {viaTailscale && (
          <AuthNotice tone="info">
            You'll sign in as{" "}
            <span className="font-semibold text-tt-ink">{session.tailscaleLogin}</span> through
            Tailscale. A username and password are optional, for signing in without it.
          </AuthNotice>
        )}
        <AuthField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required={!viaTailscale}
        />
        <div className="flex flex-col gap-1.5">
          <AuthField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={username || !viaTailscale ? 12 : undefined}
            required={!viaTailscale || username !== ""}
          />
          <div className="flex items-center gap-2" aria-live="polite">
            <span className="grid flex-1 grid-cols-3 gap-1" aria-hidden>
              {[1, 2, 3].map((n) => (
                <i
                  key={n}
                  className={`h-1 rounded-full ${strength >= n ? (strength === 1 ? "bg-tt-signal" : "bg-tt-ok") : "bg-tt-rule"}`}
                />
              ))}
            </span>
            <span className="w-40 text-right text-[12.5px] text-tt-ink-3">
              {password ? STRENGTH[strength] : "At least 12 characters"}
            </span>
          </div>
        </div>
        {address && !here && (
          <AuthNotice tone="info">
            From your other devices, Runyard is at{" "}
            <a href={address} className="font-board font-semibold text-tt-ink underline">
              {address}
            </a>
            . Bookmark it: there, Tailscale signs you in.
          </AuthNotice>
        )}
        {setup.error && <AuthNotice>{message(setup.error)}</AuthNotice>}
        <button type="submit" className={authPrimary} disabled={setup.isPending}>
          {setup.isPending ? "Creating…" : "Create admin"}
        </button>
      </form>
    </AuthLayout>
  );
}

/** Right after claiming: add a passkey on this device, or skip to Getting started. */
function OfferPasskey() {
  const navigate = useNavigate();
  const [name, setName] = useState(() => suggestedPasskeyName(navigator.userAgent));
  const add = useMutation({ mutationFn: () => addPasskey(name) });
  const next = () => void navigate({ to: "/start" });
  return (
    <AuthLayout
      board={[
        { text: "Admin created", tone: "go" },
        { text: "Add a passkey", tone: "signal" },
        { text: "Then set up your yard", tone: "dim" },
      ]}
    >
      <p className="text-[12px] font-bold tracking-[.1em] text-tt-ink-3 uppercase">Optional</p>
      <h1 className="mt-1 text-[30px] leading-none font-extrabold [font-stretch:85%]">
        Add a passkey
      </h1>
      <p className="mt-2 text-[14px] text-tt-ink-2">
        Sign in with Touch ID, Windows Hello or a security key instead of a password. A passkey
        works only at this address, {window.location.host}.
      </p>
      {add.isSuccess ? (
        <div className="mt-6 flex flex-col gap-4">
          <AuthNotice tone="info">
            <span className="font-semibold text-tt-ink">Passkey added.</span> Next time, sign in
            with “{name}”.
          </AuthNotice>
          <button type="button" className={authPrimary} onClick={next}>
            Set up your yard
          </button>
        </div>
      ) : (
        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <AuthField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint="So you can tell your passkeys apart in Settings ▸ Account."
            required
          />
          {add.error && <AuthNotice>{message(add.error)}</AuthNotice>}
          <button type="submit" className={authPrimary} disabled={add.isPending}>
            {add.isPending ? "Waiting for your device…" : "Add passkey"}
          </button>
          <button type="button" className={authSecondary} onClick={next}>
            Skip for now
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
