import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { addPasskey, passkeysAvailable, suggestedPasskeyName } from "../../lib/passkeys.ts";
import { healthQuery, passkeysQuery, sessionQuery } from "../../lib/queries.ts";
import { setTheme, useTheme, type Theme } from "../../lib/theme.ts";
import { Icon } from "../icons.tsx";
import { ErrorText } from "../ui.tsx";
import { Panel, Row, ttButton } from "../tt.tsx";
import {
  DialogButtons,
  Kvh,
  Note,
  RowText,
  SIcon,
  TtConfirm,
  TtDialog,
  TtField,
  rowButton,
} from "./parts.tsx";

const day = (at: number) => new Date(at).toLocaleDateString();

/** Who you are, your passkeys and password, and the theme. Signing out has its own card. */
export function AccountPanel() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const version = useQuery(healthQuery).data?.version;
  const user = session.user;
  if (!user) return null;
  const name = user.username ?? user.tailscaleLogin ?? "Account";
  return (
    <Panel id="account" title="Account">
      <Row className="!border-t-0">
        <SIcon name="user" />
        <RowText
          title={name}
          detail={
            <>
              {user.role === "admin" ? "Admin" : "Viewer"}
              {user.username && user.tailscaleLogin && ` · Tailscale ${user.tailscaleLogin}`}
              {version && ` · Runyard ${version}`} at {window.location.host}
            </>
          }
        />
      </Row>
      <Passkeys />
      <Kvh>Password</Kvh>
      <Password hasPassword={user.username !== null} />
      <Kvh>Theme</Kvh>
      <ThemeChoice />
    </Panel>
  );
}

/** Signing out of this browser, beside the Settings heading. Phones also have it at the foot of More. */
export function SignOutButton() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => call(api.logout.$post()),
    onSuccess: () => {
      queryClient.clear();
      void navigate({ to: "/login" });
    },
  });
  if (!session.user) return null;
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        className={ttButton.danger}
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
      >
        <Icon name="signout" size={14} />
        {logout.isPending ? "Signing out…" : "Sign out"}
      </button>
      {logout.error && <ErrorText error={logout.error} />}
    </span>
  );
}

function Passkeys() {
  const queryClient = useQueryClient();
  const passkeys = useQuery(passkeysQuery);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => suggestedPasskeyName(navigator.userAgent));
  const refresh = () => queryClient.invalidateQueries({ queryKey: passkeysQuery.queryKey });
  const add = useMutation({
    mutationFn: () => addPasskey(name),
    onSuccess: async () => {
      setOpen(false);
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
    <>
      <Kvh>Passkeys</Kvh>
      {passkeys.error && <ErrorText className="px-4 py-1" error={passkeys.error} />}
      {passkeys.data?.length === 0 && (
        <Note className="pt-1 !pb-1.5 !text-[13px]">
          No passkeys yet. Sign in with Touch ID, Windows Hello or a security key instead of a
          password.
        </Note>
      )}
      {passkeys.data?.map((p) => (
        <Row key={p.id}>
          <SIcon name="key" />
          <RowText
            title={p.name}
            detail={
              <>
                {p.rpId} · added {day(p.createdAt)}
                {p.lastUsedAt && ` · used ${day(p.lastUsedAt)}`}
              </>
            }
          />
          <TtConfirm
            trigger="Remove"
            title={`Remove passkey ${p.name}?`}
            description="It can't sign you in anymore. Your password and other passkeys still work."
            confirm="Remove passkey"
            onConfirm={() => remove.mutate(p.id)}
            pending={remove.isPending}
            error={remove.error}
          />
        </Row>
      ))}
      <Row>
        <span className="min-w-0 flex-1 text-[12.5px] text-tt-ink-3">
          {available
            ? "A passkey works only at this address."
            : "Passkeys need HTTPS or localhost. Open Runyard at its tailnet address to add one."}
        </span>
        {available && (
          <button type="button" className={rowButton.secondary} onClick={() => setOpen(true)}>
            <SIcon name="key" size={15} />
            Add a passkey
          </button>
        )}
      </Row>
      <TtDialog open={open} onOpenChange={setOpen} title="Add a passkey">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-[13.5px] text-tt-ink-2">
            Your device asks to confirm it. A passkey works only at this address,{" "}
            {window.location.host}.
          </p>
          <TtField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint="So you can tell your passkeys apart."
            required
            autoFocus
          />
          {add.error && <ErrorText error={add.error} />}
          <DialogButtons>
            <button type="button" className={ttButton.secondary} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className={ttButton.primary} disabled={add.isPending}>
              {add.isPending ? "Waiting for your device…" : "Add passkey"}
            </button>
          </DialogButtons>
        </form>
      </TtDialog>
    </>
  );
}

function Password({ hasPassword }: { hasPassword: boolean }) {
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
  if (!hasPassword)
    return (
      <Row className="!border-t-0">
        <span className="min-w-0 flex-1 text-[12px] text-tt-ink-3">
          None: you sign in through Tailscale or with a passkey.
        </span>
      </Row>
    );
  return (
    <Row className="!border-t-0">
      <span className="min-w-0 flex-1 text-[12px] text-tt-ink-3" aria-live="polite">
        {change.isSuccess
          ? "Password changed. Your other sessions were signed out."
          : "At least 12 characters. Changing it signs out your other sessions."}
      </span>
      <button type="button" className={rowButton.secondary} onClick={() => setOpen(true)}>
        Change password
      </button>
      <TtDialog open={open} onOpenChange={setOpen} title="Change password">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <TtField
            label="Current password"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
            autoFocus
          />
          <TtField
            label="New password"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={12}
            hint="At least 12 characters. Your other sessions are signed out."
            required
          />
          {change.error && <ErrorText error={change.error} />}
          <DialogButtons>
            <button type="button" className={ttButton.secondary} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className={ttButton.primary} disabled={change.isPending}>
              Change password
            </button>
          </DialogButtons>
        </form>
      </TtDialog>
    </Row>
  );
}

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** The design's three-way theme switch. */
function ThemeChoice() {
  const theme = useTheme();
  return (
    <div className="px-4 pt-1.5 pb-4">
      <div role="group" aria-label="Theme" className="grid grid-cols-3 gap-2">
        {THEMES.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={theme === t.value}
            onClick={() => setTheme(t.value)}
            className={`rounded-[10px] border-[1.5px] bg-tt-card px-2.5 py-2 text-[13.5px] font-semibold ${
              theme === t.value
                ? "border-tt-ink shadow-[inset_0_0_0_1px_var(--tt-ink)]"
                : "border-tt-rule-2 text-tt-ink-2 hover:border-tt-ink-3"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
