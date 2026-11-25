import { type MachineView, type OsFamily, type PeerView, type SshTransport } from "@runyard/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import gsap from "gsap";
import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, call } from "../../api.ts";
import { AccessSteps, SetupCommand } from "../../components/AccessPanel.tsx";
import { Icon } from "../../components/icons.tsx";
import { RowTip, TipText } from "../../components/InfoTip.tsx";
import { MachineFields } from "../../components/MachineFields.tsx";
import { SshKeyCard } from "../../components/SshKey.tsx";
import {
  Det,
  Field,
  Input,
  Pulse,
  reducedMotion,
  TtError,
  WarnIcon,
} from "../../components/machine/parts.tsx";
import { Chip, stickyHead, TtButton, ttButton } from "../../components/tt.tsx";
import { yardQuery, useYard } from "../../lib/yard.ts";
import { timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { osLabel } from "../../lib/status.ts";

export const Route = createFileRoute("/_app/machines/add")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.user?.role !== "admin") throw redirect({ to: "/" });
  },
  /** `machine`: the one just added, so a reload stays on its setup. */
  validateSearch: (search: Record<string, unknown>): { machine?: string } =>
    typeof search.machine === "string" ? { machine: search.machine } : {},
  component: AddMachine,
});

const STEPS = [
  "Choose the machine",
  "Run the setup command",
  "Check it's ready",
  "Ready for runners",
];

/**
 * Add machine, as Timetable's ticket: the stub follows the machine along its route, the body walks
 * through choosing it (from the tailnet or by SSH target), the setup command, its read-only checks,
 * and ready. Runyard only reads from the machine; it installs nothing here.
 */
function AddMachine() {
  const { machine: machineId } = Route.useSearch();
  const yard = useYard();
  const m = machineId ? yard.machines.find((x) => x.id === machineId) : undefined;
  const [step, setStep] = useState(machineId ? 1 : 0);
  // Choosing
  const [source, setSource] = useState<"tailnet" | "ssh">(
    yard.discovered.length ? "tailnet" : "ssh",
  );
  const [peerId, setPeerId] = useState<string | null>(yard.discovered[0]?.nodeId ?? null);
  const peer = yard.discovered.find((p) => p.nodeId === peerId) ?? yard.discovered[0];
  const [user, setUser] = useState("");
  const [name, setName] = useState("");
  const [sshTarget, setSshTarget] = useState("");
  const [transport, setTransport] = useState<SshTransport>("openssh");
  const [expectedOs, setExpectedOs] = useState<OsFamily | null>(null);

  const stubName =
    m?.name ?? (source === "tailnet" ? (peer?.name ?? "A machine") : name || "New machine");
  const stubFrom =
    m?.tailnet?.address ?? m?.sshTarget ?? (source === "tailnet" ? peer?.address : sshTarget) ?? "";

  if (machineId && !m)
    return (
      <Ticket step={0} name="Machine" from="">
        <h2 className="text-[24px] leading-none font-extrabold [font-stretch:78%] lg:text-[28px]">
          This machine isn't in Runyard anymore
        </h2>
        <p className="mt-1.5 text-tt-ink-2">It may have been removed while you were adding it.</p>
        <Foot>
          <Link to="/machines/add" search={{}} className={ttButton.primary}>
            Add a machine
          </Link>
        </Foot>
      </Ticket>
    );

  return (
    <Ticket step={step} name={stubName} from={stubFrom}>
      {step === 0 && (
        <Choose
          source={source}
          setSource={setSource}
          peer={peer}
          setPeerId={setPeerId}
          user={user}
          setUser={setUser}
          ssh={{
            name,
            setName,
            sshTarget,
            setSshTarget,
            transport,
            setTransport,
            expectedOs,
            setExpectedOs,
          }}
          onAdded={() => setStep(1)}
        />
      )}
      {step === 1 && m && <RunSetup m={m} next={() => setStep(2)} />}
      {step === 2 && m && <Checks m={m} back={() => setStep(1)} next={() => setStep(3)} />}
      {step === 3 && m && <Ready m={m} />}
    </Ticket>
  );
}

/** The ticket: the dark stub with the route on the left (on top on a phone), the step beside it. */
function Ticket({
  step,
  name,
  from,
  children,
}: {
  step: number;
  name: string;
  from: string;
  children: ReactNode;
}) {
  const fill = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const share = step / (STEPS.length - 1);
  useLayoutEffect(() => {
    const el = fill.current;
    if (!el) return;
    const width = `calc(${share * 100}% - ${share * 13}px)`;
    if (reducedMotion()) {
      el.style.width = width;
      return;
    }
    const tween = gsap.to(el, { width, duration: 0.8, ease: "power2.inOut" });
    return () => {
      tween.kill();
    };
  }, [share]);
  // Each step slides in, as in the design.
  useLayoutEffect(() => {
    const el = body.current?.firstElementChild;
    if (!el || reducedMotion()) return;
    const tween = gsap.from(el, { x: 30, opacity: 0, duration: 0.4, ease: "power3.out" });
    return () => {
      tween.revert();
    };
  }, [step]);
  return (
    // Desktop: the back link stays at the top, and the ticket sits in the middle of the window.
    <div className="flex flex-1 flex-col font-ui">
      <div className={`${stickyHead} lg:pb-[18px]`}>
        <Link
          to="/machines"
          className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-tt-ink-2 hover:text-tt-ink lg:mb-0"
        >
          <span aria-hidden>‹</span> Machines
        </Link>
      </div>
      <div className="mx-auto grid w-full max-w-[980px] lg:my-auto overflow-hidden rounded-[14px] bg-tt-card shadow-[0_1px_0_var(--tt-rule),0_24px_50px_-30px_rgba(0,0,0,.4)] lg:grid-cols-[300px_minmax(0,1fr)] lg:rounded-2xl dark:border dark:border-tt-rule">
        <aside className="relative flex flex-col gap-2.5 bg-tt-board px-[18px] py-4 text-white lg:gap-[18px] lg:px-6 lg:py-[26px]">
          {/* The perforation: down the right edge, or along the bottom on a phone. */}
          <span
            aria-hidden
            className="absolute inset-x-0 -bottom-2 h-4 bg-[radial-gradient(circle_at_12px_8px,var(--tt-card)_6px,transparent_6.5px)] bg-[length:24px_16px] bg-repeat-x lg:inset-x-auto lg:inset-y-0 lg:-right-2 lg:bottom-0 lg:h-auto lg:w-4 lg:bg-[radial-gradient(circle_at_8px_12px,var(--tt-card)_6px,transparent_6.5px)] lg:bg-[length:16px_24px] lg:bg-repeat-y"
          />
          <div>
            <div className="text-[10.5px] leading-none font-bold tracking-[.12em] text-[#8b9099] uppercase">
              Adding
            </div>
            <div className="mt-1.5 text-[22px] leading-[1.05] font-extrabold break-words [font-stretch:76%] lg:text-[26px]">
              {name}
            </div>
          </div>
          {from && (
            <div>
              <div className="text-[10.5px] leading-none font-bold tracking-[.12em] text-[#8b9099] uppercase">
                From
              </div>
              <div className="mt-1.5 font-board text-[13px] break-all text-[#c7cbd2]">{from}</div>
            </div>
          )}
          <div className="relative mt-1 h-[34px]" aria-hidden>
            <u className="absolute inset-x-1.5 top-4 h-[3px] bg-[#3a3e46] no-underline" />
            <u ref={fill} className="absolute top-4 left-1.5 h-[3px] w-0 bg-tt-loco no-underline" />
            {STEPS.map((_, i) => {
              const at = i / (STEPS.length - 1);
              return (
                <i
                  key={i}
                  className={`absolute top-[11px] size-[13px] rounded-full border-[3px] ${
                    i <= step
                      ? "border-tt-loco bg-tt-loco shadow-[0_0_0_4px_rgba(232,115,42,.2)]"
                      : "border-[#3a3e46] bg-tt-board"
                  }`}
                  style={{ left: `calc(${at * 100}% - ${at * 13}px)` }}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[11px] leading-none font-bold tracking-[.1em] text-[#8b9099] uppercase">
            <span>Your yard</span>
            <span>Ready</span>
          </div>
          <ol className="hidden gap-2.5 text-[13.5px] text-[#8b9099] lg:grid">
            {STEPS.map((s, i) => (
              <li
                key={s}
                aria-current={i === step ? "step" : undefined}
                className={i === step ? "font-bold text-white" : i < step ? "text-[#c7cbd2]" : ""}
              >
                {i < step && <span className="text-tt-loco">✓ </span>}
                {s}
              </li>
            ))}
          </ol>
          <p className="text-[12.5px] text-[#c7cbd2] lg:hidden">
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </p>
        </aside>
        <div
          ref={body}
          className="flex min-w-0 flex-col px-4 pt-[22px] pb-4 lg:min-h-[480px] lg:px-8 lg:py-7"
        >
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Heading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <>
      <h2 className="text-[24px] leading-none font-extrabold break-words [font-stretch:78%] lg:text-[28px]">
        {title}
      </h2>
      {children && <p className="mt-1.5 max-w-[60ch] text-tt-ink-2">{children}</p>}
    </>
  );
}

/** The ticket's foot: its buttons at the bottom right, full width on a phone. */
function Foot({ children }: { children: ReactNode }) {
  return (
    <div className="mt-auto flex gap-2.5 pt-[22px] max-lg:[&>*]:flex-1 lg:justify-end">
      {children}
    </div>
  );
}

type SshForm = {
  name: string;
  setName: (v: string) => void;
  sshTarget: string;
  setSshTarget: (v: string) => void;
  transport: SshTransport;
  setTransport: (v: SshTransport) => void;
  expectedOs: OsFamily | null;
  setExpectedOs: (v: OsFamily | null) => void;
};

/** Step one: a device from the tailnet, with an optional SSH user, or one by SSH target. */
function Choose({
  source,
  setSource,
  peer,
  setPeerId,
  user,
  setUser,
  ssh,
  onAdded,
}: {
  source: "tailnet" | "ssh";
  setSource: (v: "tailnet" | "ssh") => void;
  peer: PeerView | undefined;
  setPeerId: (id: string) => void;
  user: string;
  setUser: (v: string) => void;
  ssh: SshForm;
  onAdded: () => void;
}) {
  const yard = useYard();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const add = useMutation({
    mutationFn: () =>
      source === "tailnet"
        ? call(
            api.peers[":nodeId"].add.$post({
              param: { nodeId: peer!.nodeId },
              json: { user: user.trim() },
            }),
          )
        : call(
            api.machines.$post({
              json: {
                name: ssh.name,
                sshTarget: ssh.sshTarget,
                transport: ssh.transport,
                expectedOs: ssh.expectedOs,
              },
            }),
          ),
    onSuccess: async (machine) => {
      await queryClient.invalidateQueries({ queryKey: yardQuery.queryKey });
      void navigate({ to: "/machines/add", search: { machine: machine.id }, replace: true });
      onAdded();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  const option = (value: "tailnet" | "ssh", icon: ReactNode, title: string, sub: string) => (
    <button
      type="button"
      aria-pressed={source === value}
      onClick={() => setSource(value)}
      className={`flex w-full min-w-0 items-center gap-3.5 rounded-[10px] border-[1.5px] bg-tt-card p-3.5 text-left ${
        source === value
          ? "border-tt-ink shadow-[inset_0_0_0_1px_var(--tt-ink)]"
          : "border-tt-rule-2 hover:border-tt-ink-3"
      }`}
    >
      <span className="text-tt-ink-2">{icon}</span>
      <span className="min-w-0">
        <b className="block font-bold">{title}</b>
        <small className="block text-[12.5px] text-tt-ink-3">{sub}</small>
      </span>
    </button>
  );
  return (
    <form onSubmit={submit} className="flex flex-1 flex-col">
      <Heading title="Which machine?">
        Pick one Runyard can see on your tailnet, or give it an SSH target. Runyard checks it over
        SSH every minute and only reads from it until you review changes.
      </Heading>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-2.5">
        {option(
          "tailnet",
          <Icon name="grid" size={18} />,
          "From your tailnet",
          yard.discovered.length
            ? `${yard.discovered.length} ${yard.discovered.length === 1 ? "device" : "devices"} not added yet`
            : yard.tailnet.error
              ? "Tailscale can't be read on the Runyard host"
              : "Every device is added or ignored",
        )}
        {option(
          "ssh",
          <Icon name="server" size={18} />,
          "By SSH target",
          "user@host, or a host alias from the Runyard host's ~/.ssh/config",
        )}
      </div>
      {source === "tailnet" && (
        <div className="mt-4 flex flex-col gap-3.5">
          {yard.discovered.length === 0 ? (
            <p className="text-tt-ink-2">
              {yard.tailnet.error
                ? "Tailscale can't be read on the Runyard host, so there's nothing to list."
                : "Every desktop and server on the tailnet is already added or ignored."}
            </p>
          ) : (
            <div
              role="radiogroup"
              aria-label="Tailnet devices"
              className="overflow-hidden rounded-[10px] border border-tt-rule"
            >
              {yard.discovered.map((p, i) => (
                <PeerRow
                  key={p.nodeId}
                  peer={p}
                  first={i === 0}
                  selected={p.nodeId === peer?.nodeId}
                  select={() => setPeerId(p.nodeId)}
                />
              ))}
            </div>
          )}
          {peer && (
            <div className="max-w-[300px]">
              <Field
                label="SSH user (optional)"
                hint="Leave it empty to have the setup command fill it in."
              >
                <Input
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  placeholder="ci"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                />
              </Field>
            </div>
          )}
          {yard.ignored.length > 0 && (
            <div className="text-[12.5px] text-tt-ink-3">
              <span className="font-semibold">Ignored:</span>
              {yard.ignored.map((p) => (
                <span key={p.nodeId} className="ml-2 inline-flex items-center gap-1.5">
                  {p.name}
                  <IgnoreButton peer={p} ignored />
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {source === "ssh" && (
        <div className="mt-4 grid gap-x-3.5 gap-y-3 sm:grid-cols-2">
          <Field label="Name">
            <Input
              value={ssh.name}
              onChange={(e) => ssh.setName(e.target.value)}
              placeholder="Build box"
              autoComplete="off"
              required
            />
          </Field>
          <MachineFields
            sshTarget={ssh.sshTarget}
            setSshTarget={ssh.setSshTarget}
            transport={ssh.transport}
            setTransport={ssh.setTransport}
            expectedOs={ssh.expectedOs}
            setExpectedOs={ssh.setExpectedOs}
          />
        </div>
      )}
      <TtError className="mt-3" error={add.error} />
      <Foot>
        <TtButton
          type="submit"
          variant="primary"
          disabled={add.isPending || (source === "tailnet" && !peer)}
        >
          {add.isPending ? "Adding…" : "Add and continue"}
        </TtButton>
      </Foot>
    </form>
  );
}

function PeerRow({
  peer,
  first,
  selected,
  select,
}: {
  peer: PeerView;
  first: boolean;
  selected: boolean;
  select: () => void;
}) {
  const now = useNow();
  return (
    <div
      className={`flex items-center gap-3 px-3.5 py-2.5 ${first ? "" : "border-t border-tt-rule"} ${selected ? "bg-tt-hover" : ""}`}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={select}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span
          aria-hidden
          className={`grid size-[18px] flex-none place-items-center rounded-full border-[1.5px] ${selected ? "border-tt-ink" : "border-tt-rule-2"}`}
        >
          {selected && <i className="size-2 rounded-full bg-tt-ink" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <b className="truncate font-bold">{peer.name}</b>
            <Chip tone={peer.online ? "ok" : "neutral"}>
              {osLabel[peer.os]} · {peer.online ? "online" : "offline"}
            </Chip>
            {peer.tailscaleSsh && (
              <RowTip
                content={
                  <TipText what="This device lets you sign in through Tailscale, so Runyard can connect with no SSH keys to set up." />
                }
              >
                <span>
                  <Chip tone="plain">Tailscale SSH</Chip>
                </span>
              </RowTip>
            )}
          </span>
          {/* Cut to one line; the whole address on hover. */}
          <RowTip content={<TipText what={peer.address} />}>
            <small className="block truncate text-[12px] text-tt-ink-3">
              <span className="font-board">{peer.address}</span>
              {!peer.online && ` · last seen ${timeAgo(peer.lastSeen, now)}`}
            </small>
          </RowTip>
        </span>
      </button>
      <IgnoreButton peer={peer} />
    </div>
  );
}

/** Ignore a device you won't add, or show an ignored one again. */
function IgnoreButton({ peer, ignored = false }: { peer: PeerView; ignored?: boolean }) {
  const queryClient = useQueryClient();
  const ignore = useMutation({
    mutationFn: () =>
      ignored
        ? call(api.peers[":nodeId"].ignore.$delete({ param: { nodeId: peer.nodeId } }))
        : call(api.peers[":nodeId"].ignore.$post({ param: { nodeId: peer.nodeId } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });
  const button = (
    <button
      type="button"
      onClick={() => ignore.mutate()}
      disabled={ignore.isPending}
      aria-label={`${ignored ? "Show again" : "Ignore"} ${peer.name}`}
      className={
        ignored
          ? "font-semibold text-tt-ink-2 underline hover:text-tt-ink"
          : "flex-none text-[12.5px] font-semibold text-tt-ink-3 hover:text-tt-ink"
      }
    >
      {ignored ? "Show again" : "Ignore"}
    </button>
  );
  return (
    <>
      {ignored ? (
        button
      ) : (
        <RowTip
          content={
            <TipText what="Hides this device from the list. You can show it again from Machines, under Ignored." />
          }
        >
          {button}
        </RowTip>
      )}
      {ignore.error && <TtError error={ignore.error} />}
    </>
  );
}

/** Step two: the setup command, Runyard's key, each SSH step, and waiting for the first check. */
function RunSetup({ m, next }: { m: MachineView; next: () => void }) {
  const queryClient = useQueryClient();
  const check = useMutation({
    mutationFn: () => call(api.machines[":id"].check.$post({ param: { id: m.id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });
  const connected = m.connection.state === "connected";
  return (
    <>
      <Heading title={`Run this on ${m.name}`}>
        It authorizes Runyard's key and trusts the host. On a fresh Linux LXC or VPS, run the
        fresh-machine version as root: it also installs the SSH server and creates a runyard
        account.
      </Heading>
      <SetupCommand m={m} className="mt-4" />
      <div className="mt-3 overflow-hidden rounded-[10px] border border-tt-rule [&>details:first-child]:border-t-0">
        <Det summary="Runyard's SSH key" note="to authorize by hand">
          <div className="px-3 pb-2">
            <p className="mb-2 text-[12.5px] text-tt-ink-2">
              Add it to the SSH user's ~/.ssh/authorized_keys if you'd rather not run the command.
            </p>
            <SshKeyCard />
          </div>
        </Det>
        <Det summary="Each step" note={connected ? "all done" : "where the last check stopped"}>
          <div className="-mb-2 [&>ol]:border-t-0">
            <AccessSteps m={m} admin />
          </div>
        </Det>
      </div>
      <div
        role="status"
        className={`mt-3.5 flex flex-wrap items-center gap-2.5 font-semibold ${connected ? "text-tt-ok-ink" : "text-tt-ink-2"}`}
      >
        {connected ? (
          <>
            <Icon name="check" size={16} /> {m.name} called in
          </>
        ) : (
          <>
            <Pulse />
            Waiting for {m.name} to call in…
            <span className="font-normal text-tt-ink-3">Runyard checks every minute.</span>
            <TtButton onClick={() => check.mutate()} disabled={check.isPending}>
              {check.isPending ? "Checking…" : "Check now"}
            </TtButton>
          </>
        )}
      </div>
      <TtError className="mt-2" error={check.error} />
      <Foot>
        <Link to="/machines/$id" params={{ id: m.id }} className={ttButton.secondary}>
          Open its page
        </Link>
        <TtButton variant="primary" onClick={next} disabled={!connected}>
          Continue
        </TtButton>
      </Foot>
    </>
  );
}

/** More checks than this split into two columns on desktop. */
const LONG_CHECK = 6;

/** Step three: the readiness checks from its first SSH read, one by one. */
function Checks({ m, back, next }: { m: MachineView; back: () => void; next: () => void }) {
  const r = m.readiness;
  const list = useRef<HTMLDivElement>(null);
  const shown = r !== null;
  useLayoutEffect(() => {
    const rows = list.current?.children;
    if (!shown || !rows?.length || reducedMotion()) return;
    const tween = gsap.from(rows, {
      opacity: 0.35,
      x: -6,
      duration: 0.25,
      ease: "power2.out",
      stagger: 0.12,
    });
    return () => {
      tween.revert();
    };
  }, [shown]);
  const missing = notReady(m);
  const checked = r ? r.items.filter((i) => i.tier !== "label") : [];
  return (
    <>
      <Heading title={`Checking ${m.name}`}>
        Runyard checks that jobs will run here. This is read-only: what's missing installs with its
        pools' changes, after you review them.
      </Heading>
      {!r ? (
        <div role="status" className="mt-3.5 flex items-center gap-2.5 font-semibold text-tt-ink-2">
          <Pulse /> Waiting for the first check…
        </div>
      ) : (
        <div
          ref={list}
          // A long check reads as two columns on desktop rather than one tall list.
          className={`mt-3.5 border-t-2 border-tt-ink ${
            checked.length > LONG_CHECK ? "lg:grid lg:grid-cols-2 lg:gap-x-8" : ""
          }`}
        >
          {checked.map((i) => {
            const ok = i.status === "ok";
            return (
              <RowTip
                key={i.id}
                content={<TipText what={i.detail || i.title} details={i.value || undefined} />}
              >
                <div
                  // Focusable, so the row's tip opens from the keyboard as well as on hover.
                  tabIndex={0}
                  className="flex items-center gap-3 border-b border-tt-rule px-0.5 py-2.5 outline-none focus-visible:bg-tt-hover"
                >
                  <span
                    role="img"
                    aria-label={
                      ok
                        ? "Ready"
                        : i.status === "unknown"
                          ? "Not checked"
                          : i.status === "warn"
                            ? "Needs a look"
                            : "Missing"
                    }
                    className={`grid size-[22px] flex-none place-items-center rounded-full ${
                      ok
                        ? "bg-tt-ok-bg text-tt-ok-ink"
                        : i.status === "unknown"
                          ? "bg-tt-paper text-tt-ink-3"
                          : "bg-tt-warn-bg text-tt-warn-ink"
                    }`}
                  >
                    {ok ? <Icon name="check" size={12} /> : <WarnIcon size={12} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <small className="ml-auto min-w-0 truncate text-right text-[12.5px] text-tt-ink-3">
                    {i.value}
                  </small>
                </div>
              </RowTip>
            );
          })}
        </div>
      )}
      {missing.length > 0 && (
        <p className="mt-3 text-[12.5px] text-tt-ink-2">
          {missing.map((i) => i.title).join(", ")} {missing.length === 1 ? "isn't" : "aren't"}{" "}
          there. A pool's review installs the tools its jobs need; the fix for each is on its page.
        </p>
      )}
      <Foot>
        <TtButton onClick={back}>Back</TtButton>
        <TtButton variant="primary" onClick={next} disabled={!r}>
          Continue
        </TtButton>
      </Foot>
    </>
  );
}

/** What its first check didn't find, required or recommended. */
function notReady(m: MachineView) {
  return (m.readiness?.items ?? []).filter(
    (i) => i.tier !== "label" && (i.status === "missing" || i.status === "warn"),
  );
}

/** Step four: what was added, and a stamp. */
function Ready({ m }: { m: MachineView }) {
  const stamp = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!stamp.current || reducedMotion()) return;
    const tween = gsap.from(stamp.current, {
      scale: 2.4,
      opacity: 0,
      rotation: -18,
      duration: 0.5,
      ease: "back.out(1.6)",
      delay: 0.15,
    });
    return () => {
      tween.revert();
    };
  }, []);
  const items = m.readiness?.items.filter((i) => i.tier !== "label") ?? [];
  const passing = items.filter((i) => i.status === "ok").length;
  const missing = notReady(m);
  const lines: [string, string, string][] = [
    ["✓", "text-tt-ok-ink", `${m.name} · ${m.sshTarget}`],
    [
      passing === items.length ? "✓" : "~",
      passing === items.length ? "text-tt-ok-ink" : "text-tt-warn-ink",
      `${passing} of ${items.length} readiness checks pass`,
    ],
    ...(missing.length
      ? [
          ["~", "text-tt-warn-ink", `${missing.map((i) => i.title).join(", ")} not found yet`] as [
            string,
            string,
            string,
          ],
        ]
      : []),
  ];
  return (
    <>
      <Heading title={`${m.name} is ready`}>
        It's on your Machines page and Runyard checks it every minute. Put it in a pool to give it
        runners; you'll review exactly what changes first.
      </Heading>
      <div className="mt-4 max-w-[460px] rounded-lg border border-tt-rule bg-tt-paper font-board text-[12.5px] leading-normal">
        <div className="flex justify-between border-b border-dashed border-tt-rule-2 px-3.5 py-2.5 text-[11.5px] tracking-[.06em] text-tt-ink-3 uppercase">
          <span>Machine</span>
          <span>{m.os ? osLabel[m.os] : "Detected"}</span>
        </div>
        {lines.map(([op, color, text], i) => (
          <div
            key={i}
            className="grid grid-cols-[22px_18px_minmax(0,1fr)] items-start gap-2 border-b border-dashed border-tt-rule px-3.5 py-[9px] last:border-b-0"
          >
            <span className="text-tt-ink-3">{String(i + 1).padStart(2, "0")}</span>
            <span className={`font-bold ${color}`}>{op}</span>
            <span className="break-words">{text}</span>
          </div>
        ))}
      </div>
      <div
        ref={stamp}
        aria-hidden
        className="mt-[18px] -rotate-6 self-start rounded-[10px] border-4 border-tt-ok px-[18px] py-2 text-[34px] leading-none font-extrabold tracking-[.08em] text-tt-ok uppercase [font-stretch:75%]"
      >
        Ready
      </div>
      <Foot>
        <Link to="/machines/$id" params={{ id: m.id }} className={ttButton.secondary}>
          Done
        </Link>
        <Link to="/pools/new" className={ttButton.primary}>
          Put it in a pool
        </Link>
      </Foot>
    </>
  );
}
