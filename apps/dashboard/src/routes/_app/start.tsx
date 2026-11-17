import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import gsap from "gsap";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../../components/icons.tsx";
import { RouteLine } from "../../components/RouteLine.tsx";
import { useDismissed } from "../../components/SetupChecklist.tsx";
import { UseInWorkflow } from "../../components/UseInWorkflow.tsx";
import { useJobsSeen } from "../../lib/calendar.ts";
import { checksQuery, sessionQuery } from "../../lib/queries.ts";
import { machineToConnect, machineToReview, startStops } from "../../lib/setup.ts";
import { useYard } from "../../lib/yard.ts";

export const Route = createFileRoute("/_app/start")({
  component: GettingStarted,
});

const primary =
  "inline-flex h-10 items-center gap-2 rounded-lg bg-tt-inv px-4 text-[14px] font-semibold text-tt-on-inv hover:opacity-90";
const secondary =
  "inline-flex h-10 items-center gap-2 rounded-lg border border-tt-rule-2 bg-tt-card px-4 text-[14px] font-semibold hover:bg-tt-hover";

/**
 * Getting started: a route from connecting a forge to the first job on the board. Each stop says
 * what's next and opens the page that does it; stops tick off from what exists, so leaving and
 * coming back picks up where things stand.
 */
function GettingStarted() {
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const admin = session.user?.role === "admin";
  const jobsSeen = useJobsSeen();
  const { stops, current, finished } = startStops(view, jobsSeen);
  const [picked, setPicked] = useState<number | null>(null);
  const shown = picked ?? current;
  const navigate = useNavigate();
  const { setDismissed } = useDismissed();
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const tween = gsap.fromTo(
      el,
      { opacity: 0, x: 24 },
      { opacity: 1, x: 0, duration: 0.35, ease: "power3.out" },
    );
    return () => {
      tween.kill();
    };
  }, [shown, finished]);

  if (!admin) {
    return (
      <div className="mx-auto max-w-xl pt-6 text-tt-ink-2">
        An admin sets Runyard up. Once a pool is running, its jobs appear on the Board.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-ui text-[28px] leading-none font-extrabold [font-stretch:85%]">
            Getting started
          </h1>
          <p className="mt-1.5 text-[13px] text-tt-ink-2">
            {finished ? "Every stop is done." : `Stop ${current + 1} of ${stops.length}`}
          </p>
        </div>
        {!finished && (
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              void navigate({ to: "/" });
            }}
            className="text-[13px] font-semibold text-tt-ink-2 hover:text-tt-ink"
          >
            Skip for now
          </button>
        )}
      </header>

      <div className="rounded-xl border border-tt-board-edge bg-tt-board px-6 pt-5 pb-3 sm:px-10">
        <p className="mb-4 text-[11px] font-bold tracking-[.1em] text-[#9aa0a9] uppercase">
          Set up your yard
        </p>
        <RouteLine
          stops={stops}
          current={shown}
          onSelect={(i) => setPicked(i === current ? null : i)}
          dark
        />
      </div>

      <div
        ref={panel}
        className="mx-auto w-full max-w-[640px] rounded-xl border border-tt-rule bg-tt-card"
      >
        <div className="px-6 pt-6 pb-5">
          {finished && picked === null ? <Running /> : <StopPanel index={shown} />}
        </div>
        <footer className="border-t border-tt-rule px-6 py-3 text-[12.5px] text-tt-ink-3">
          You can leave and come back: the Board keeps this route until it's done.
        </footer>
      </div>
    </div>
  );

  function StopPanel({ index }: { index: number }) {
    const stop = stops[index]!;
    const Heading = ({ children }: { children: ReactNode }) => (
      <>
        <p className="text-[11px] font-bold tracking-[.1em] text-tt-ink-3 uppercase">
          Stop {index + 1}
          {stop.done ? " · done" : ""}
        </p>
        <h2 className="mt-1 text-[24px] font-extrabold [font-stretch:85%]">{children}</h2>
        <p className="mt-1.5 max-w-[60ch] text-[14px] text-tt-ink-2">{stop.detail}</p>
      </>
    );
    const actions = (children: ReactNode) => (
      <div className="mt-5 flex flex-wrap gap-2">{children}</div>
    );

    if (stop.id === "forge") {
      return (
        <>
          <Heading>Connect GitHub or Forgejo</Heading>
          <p className="mt-3 text-[13.5px] text-tt-ink-2">
            Runyard registers runners with your forge and watches it for queued jobs. You can add
            the other one later in Settings ▸ Connections.
          </p>
          {actions(
            <>
              <Link to="/settings/github" className={primary}>
                Connect GitHub
              </Link>
              <Link to="/settings/forgejo" className={secondary}>
                Connect Forgejo
              </Link>
            </>,
          )}
        </>
      );
    }
    if (stop.id === "machine") {
      const stuck = machineToConnect(view);
      return (
        <>
          <Heading>Add a machine</Heading>
          <p className="mt-3 text-[13.5px] text-tt-ink-2">
            Pick a device from your tailnet or enter any SSH target, then run the one-line setup
            command its page shows. Runyard checks it's ready to build; it changes nothing yet.
          </p>
          {view.discovered.length > 0 && !stuck && (
            <ul className="mt-4 overflow-hidden rounded-lg border border-tt-rule">
              {view.discovered.slice(0, 3).map((p) => (
                <li
                  key={p.nodeId}
                  className="flex items-center gap-3 border-b border-tt-rule px-3.5 py-2.5 last:border-b-0"
                >
                  <Icon name="machine" size={15} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.name}</span>
                    <span className="block truncate text-[12px] text-tt-ink-3">
                      Found on your tailnet · {p.address}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {actions(
            stuck ? (
              <Link
                to="/machines/$id"
                params={{ id: stuck.machine.id }}
                hash="setup"
                className={primary}
              >
                Open {stuck.machine.name}
              </Link>
            ) : (
              <Link to="/machines/add" className={primary}>
                Add a machine
              </Link>
            ),
          )}
        </>
      );
    }
    if (stop.id === "pool") {
      const machines = view.machines.length > 0;
      return (
        <>
          <Heading>Create a pool</Heading>
          <p className="mt-3 text-[13.5px] text-tt-ink-2">
            A pool's labels decide which jobs land on it. Runyard turns them into runners on the
            machines you pick, always on or one per job. Public repositories are refused unless you
            allow them.
          </p>
          {actions(
            machines ? (
              <Link to="/pools/new" className={primary}>
                Create a pool
              </Link>
            ) : (
              <span className="text-[13px] text-tt-ink-3">Add a machine first.</span>
            ),
          )}
        </>
      );
    }
    if (stop.id === "runners") {
      const machine = machineToReview(view);
      return (
        <>
          <Heading>Review and run</Heading>
          <p className="mt-3 text-[13.5px] text-tt-ink-2">
            Each machine lists what installing its runners will change. Nothing changes until you
            run it, and busy runners are never touched.
          </p>
          {actions(
            machine ? (
              <Link to="/machines/$id" params={{ id: machine }} hash="changes" className={primary}>
                Review changes
              </Link>
            ) : (
              <span className="text-[13px] text-tt-ink-3">
                Create a pool first; its machines' changes appear here.
              </span>
            ),
          )}
        </>
      );
    }
    const pool = view.pools.pools[0];
    return (
      <>
        <Heading>Send your first job</Heading>
        {pool ? (
          <div className="mt-2 [&_section]:mt-3">
            <UseInWorkflow pool={pool} />
          </div>
        ) : (
          <p className="mt-3 text-[13.5px] text-tt-ink-3">Create a pool first.</p>
        )}
        {actions(
          <Link to="/" className={secondary}>
            Watch the Board
          </Link>,
        )}
      </>
    );
  }
}

/** Every stop done: the yard is running, with anything this machine still needs. */
function Running() {
  const checks = useQuery(checksQuery);
  const problems = (checks.data ?? []).filter((c) => c.state === "warn" || c.state === "bad");
  return (
    <div className="text-center">
      <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-tt-ok-bg text-tt-ok-ink">
        <Icon name="check" size={30} />
      </span>
      <h2 className="mt-4 text-[26px] font-extrabold [font-stretch:85%]">Your yard is running</h2>
      <p className="mt-1.5 text-[14px] text-tt-ink-2">
        Jobs on your pools now show on the Board as they leave and arrive.
      </p>
      {problems.length > 0 && (
        <div className="mt-5 rounded-lg bg-tt-warn-bg px-4 py-3 text-left text-[13px] text-tt-warn-ink">
          <p className="font-bold">
            This machine still needs: {problems.map((p) => p.title).join(", ")}
          </p>
          <Link to="/settings/connections" className="mt-1 inline-block font-semibold underline">
            See the fixes
          </Link>
        </div>
      )}
      <div className="mt-6 flex justify-center gap-2">
        <Link to="/" className={primary}>
          Go to the Board
        </Link>
        {!problems.length && (
          <Link to="/boat" className={secondary}>
            Connect boat.dev · optional
          </Link>
        )}
      </div>
    </div>
  );
}
