import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../api.ts";
import {
  AuthField,
  AuthLayout,
  AuthIcon,
  AuthNote,
  AuthNotice,
  authActions,
  authEyebrow,
  authForm,
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
    <AuthLayout
      board={offer ? PASSKEY_BOARD : CLAIM_BOARD}
      line={offer ? { text: "Admin created", tone: "go" } : undefined}
    >
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
      <form onSubmit={submit} className={`mt-6 ${authForm}`}>
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
          <AuthNote icon="tailnet">
            From your other devices, Runyard is at{" "}
            <a href={address} className="font-semibold text-tt-ink underline">
              {address.replace(/\/$/, "")}
            </a>
            . Bookmark it: there, Tailscale signs you in.
          </AuthNote>
        )}
        {setup.error && <AuthNotice>{message(setup.error)}</AuthNotice>}
        <div className={authActions}>
          <button type="submit" className={authPrimary} disabled={setup.isPending}>
            {setup.isPending ? "Creating…" : "Create admin"}
          </button>
        </div>
      </form>
    </>
  );
}

/** Right after claiming: add a passkey on this device, or skip to Getting started. */
function OfferPasskey() {
  const navigate = useNavigate();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const user = session.user?.username ?? session.user?.tailscaleLogin ?? "";
  const host = window.location.host;
  const [name, setName] = useState(() => suggestedPasskeyName(navigator.userAgent));
  const add = useMutation({ mutationFn: () => addPasskey(name) });
  const next = () => void navigate({ to: "/start" });
  if (add.isSuccess)
    return (
      <>
        <span className="mb-4 grid size-11 place-items-center rounded-full bg-tt-ok-bg text-tt-ok-ink">
          <svg
            aria-hidden
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        </span>
        <h1 className={authTitle}>Passkey added</h1>
        <p className={authLede}>
          Next time, sign in to {host} with your passkey instead of your password.
        </p>
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-tt-rule bg-tt-card px-3.5 py-3 text-tt-ink-2">
          <AuthIcon name="key" />
          <span className="min-w-0">
            <b className="block truncate text-tt-ink">{name || "This device"}</b>
            <small className="block text-[12.5px] text-tt-ink-3">
              Added just now · works on {host}
            </small>
          </span>
        </div>
        <div className={authActions}>
          <button type="button" className={authPrimary} onClick={next}>
            Continue to Getting started <span aria-hidden>→</span>
          </button>
        </div>
      </>
    );
  return (
    <>
      <p className={authEyebrow}>Admin created{user && ` · ${user}`}</p>
      <h1 className={authTitle}>Add a passkey</h1>
      <p className={authLede}>
        Sign in next time with Face ID, Touch ID, Windows Hello or a security key instead of your
        password.
      </p>
      <form
        className={`mt-6 ${authForm}`}
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
        <AuthNote icon="lock">
          A passkey works only on the address you add it from:{" "}
          <b className="font-semibold text-tt-ink">{host}</b>. Passkeys need HTTPS or localhost.
        </AuthNote>
        <div className={`${authActions} !flex-row`}>
          <button type="button" className={authSecondary} onClick={next}>
            Skip for now
          </button>
          <button type="submit" className={authPrimary} disabled={add.isPending}>
            <AuthIcon name="key" />
            {add.isPending ? "Waiting…" : "Add passkey"}
          </button>
        </div>
      </form>
    </>
  );
}
