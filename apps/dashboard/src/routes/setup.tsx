import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../api.ts";
import {
  AuthField,
  AuthLayout,
  AuthNotice,
  authEyebrow,
  authLede,
  authPrimary,
  authSecondary,
  authTitle,
  type BoardRow,
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
const STRENGTH = ["Too short: at least 12 characters.", "Fair", "Good", "Strong"] as const;

/** The board while claiming, then after: it flips between them as in the design. */
const CLAIM_BOARD: BoardRow[] = [
  { job: "New install", status: "Ready to claim", tone: "signal" },
  { job: "Setup code", status: "In Runyard's log" },
  { job: "First admin", status: "Not created yet" },
];
const PASSKEY_BOARD: BoardRow[] = [
  { job: "Admin", status: "Created", tone: "go" },
  { job: "Passkey", status: "Optional" },
  { job: "Next stop", status: "Getting started", tone: "moving" },
];

/** Claiming a new install with the setup code it printed, then offering a passkey. */
function Setup() {
  const [claimed, setClaimed] = useState(false);
  const offer = claimed && passkeysAvailable();
  return (
    <AuthLayout board={offer ? PASSKEY_BOARD : CLAIM_BOARD}>
      {offer ? <OfferPasskey /> : <Claim onClaimed={setClaimed} />}
    </AuthLayout>
  );
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
    <>
      <p className={authEyebrow}>New install</p>
      <h1 className={authTitle}>Claim your Runyard</h1>
      <p className={authLede}>
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
          {/* The design's meter: four bars across the field, red to green, the hint below. */}
          <div className="mt-0.5 grid grid-cols-4 gap-1" aria-hidden>
            {[1, 2, 3, 4].map((n) => {
              const level = password ? strength + 1 : 0;
              return (
                <i
                  key={n}
                  className={`h-1 rounded-sm ${
                    level >= n
                      ? level === 1
                        ? "bg-tt-bad"
                        : level === 2
                          ? "bg-[#e3a800]"
                          : "bg-tt-ok"
                      : "bg-tt-rule"
                  }`}
                />
              );
            })}
          </div>
          <span className="text-[12.5px] text-tt-ink-3" aria-live="polite">
            {password ? STRENGTH[strength] : "At least 12 characters."}
          </span>
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
    </>
  );
}

/** Right after claiming: add a passkey on this device, or skip to Getting started. */
function OfferPasskey() {
  const navigate = useNavigate();
  const [name, setName] = useState(() => suggestedPasskeyName(navigator.userAgent));
  const add = useMutation({ mutationFn: () => addPasskey(name) });
  const next = () => void navigate({ to: "/start" });
  return (
    <>
      <p className={authEyebrow}>Optional</p>
      <h1 className={authTitle}>Add a passkey</h1>
      <p className={authLede}>
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
    </>
  );
}
