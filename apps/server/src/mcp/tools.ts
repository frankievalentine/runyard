import {
  accessSteps,
  deriveIssues,
  nextAccessStep,
  readinessProblems,
  waitingReasons,
  type MachineView,
  type Pool,
  type Scope,
  type YardView,
} from "@runyard/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TokenScope } from "../auth/access-tokens.ts";
import type { User } from "../auth/users.ts";
import type { Db } from "../db/index.ts";
import type { MachineMonitor } from "../machines/monitor.ts";
import type { MachineSetupCodes } from "../machines/setup-codes.ts";
import { validateTarget } from "../machines/ssh.ts";
import { appendEvents, createMachine, listEvents } from "../machines/store.ts";
import type { PoolEngine } from "../pools/engine.ts";
import { savePool, type PoolInput } from "../pools/store.ts";
import type { TestJobs } from "../pools/test-jobs.ts";
import { setupCommands } from "../routes/machine-setup.ts";
import { testJobProblem } from "../routes/test-jobs.ts";

export type ToolDeps = {
  db: Db;
  monitor: MachineMonitor;
  engine: PoolEngine;
  testJobs: TestJobs;
  machineSetup: MachineSetupCodes;
  /** Validates a pool definition as the dashboard's pool routes do. */
  checkPool: (input: PoolInput, id?: string) => string | null;
};

/** Who is calling: a user, through one of their tokens, and the address they called. */
export type Caller = {
  user: User;
  token: { id: string; name: string; scope: TokenScope };
  /** The dashboard's address as the caller reached it, for links; HTTPS for setup commands. */
  origin: string;
};

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (value: unknown): Result => ({
  content: [
    { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
  ],
});
const fail = (message: string): Result => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const PREPARE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

/** Finds a machine by ID or (case-insensitively) by name. */
function findMachine(view: YardView, ref: string): MachineView | undefined {
  return (
    view.machines.find((m) => m.id === ref) ??
    view.machines.find((m) => m.name.toLowerCase() === ref.toLowerCase())
  );
}

function findPool(view: YardView, ref: string): Pool | undefined {
  return view.pools.pools.find((p) => p.id === ref || p.name === ref.toLowerCase());
}

/** A scope from what a person would type: an account or `owner/repo`, on GitHub or Forgejo. */
function resolveScope(
  view: YardView,
  target: string,
  forge?: "github" | "forgejo",
): Scope | string {
  const t = target.trim();
  const repo = t.includes("/");
  const owner = (repo ? t.split("/")[0]! : t).toLowerCase();
  if (forge !== "forgejo")
    for (const app of view.github.apps)
      for (const i of app.installations) {
        if (i.account.toLowerCase() !== owner) continue;
        if (repo) return { forgeId: app.forgeId, kind: "repo", target: t };
        if (i.accountType === "Organization")
          return { forgeId: app.forgeId, kind: "org", target: i.account };
        return `${t} is a personal GitHub account; name its repositories (owner/name) instead.`;
      }
  if (forge !== "github")
    for (const c of view.forgejo.connections)
      for (const s of c.scopes)
        if (s.target.toLowerCase() === owner && !repo)
          return { forgeId: c.forgeId, kind: s.kind, target: s.target };
  return `No connected GitHub App installation or Forgejo account covers ${t}.`;
}

const machineSummary = (m: MachineView) => ({
  id: m.id,
  name: m.name,
  os: m.os,
  sshTarget: m.sshTarget,
  connection: m.connection.state,
  connectionStep: nextAccessStep(m)?.title ?? null,
  readinessProblems: readinessProblems(m.readiness).map((i) => `${i.title}: ${i.value}`),
  alerts: m.alerts.map((a) => a.kind),
});

/**
 * Runyard's MCP tools. Read tools see what the dashboard shows. Prepare tools
 * (prepare tokens only) save settings and prepare reviews; none runs a review
 * or deletes anything.
 */
export function registerTools(server: McpServer, deps: ToolDeps, caller: Caller) {
  const view = () => deps.monitor.view;
  const canPrepare = caller.token.scope === "prepare";
  const by = `${caller.user.username ?? caller.user.tailscaleLogin ?? caller.user.id} via token "${caller.token.name}"`;
  /** Prepared changes go in the history of the machines they're about. */
  const record = (machineIds: string[], detail: string) =>
    appendEvents(
      deps.db,
      machineIds.map((machineId) => ({
        machineId,
        machineName: view().machines.find((m) => m.id === machineId)?.name ?? machineId,
        kind: "agentPrepared",
        detail: `${detail} (by ${by})`,
        at: Date.now(),
      })),
    );
  const prepare =
    <A>(fn: (args: A) => Promise<Result> | Result) =>
    async (args: A) =>
      canPrepare
        ? fn(args)
        : fail("This token is read only; changes need a token that can prepare them.");
  // Read-only callers still see the prepare tools, so they can say what a change would take,
  // but each one says up front that it's refused for them.
  const register = ((name, config, cb) =>
    server.registerTool(
      name,
      config.annotations === PREPARE && !canPrepare
        ? {
            ...config,
            description: `${config.description} Refused for this token, which is read only.`,
          }
        : config,
      cb,
    )) as typeof server.registerTool;

  register(
    "yard_summary",
    {
      title: "Yard summary",
      description:
        "An overview of Runyard: machines and their state, runners by activity, queued jobs, active alerts and everything listed under Needs attention.",
      annotations: READ,
    },
    () => {
      const v = view();
      return ok({
        machines: v.machines.map(machineSummary),
        runners: v.summary,
        queuedJobs: v.queue.jobs.length,
        alerts: v.alerts.map((a) => ({ machine: a.machineId, kind: a.kind })),
        needsAttention: deriveIssues(v).map((i) => `${i.title}: ${i.detail}`),
        pools: v.pools.pools.map((p) => p.name),
      });
    },
  );

  register(
    "list_machines",
    {
      title: "List machines",
      description:
        "Every machine Runyard checks, with its connection, the setup step it's stuck on if any, readiness problems and alerts.",
      annotations: READ,
    },
    () => ok(view().machines.map(machineSummary)),
  );

  register(
    "get_machine",
    {
      title: "Get a machine",
      description:
        "One machine in detail: health, runner readiness items, the steps to connect it (with commands), diagnostics warnings, its runners and recent history.",
      inputSchema: { machine: z.string().describe("The machine's name or ID.") },
      annotations: READ,
    },
    ({ machine }) => {
      const v = view();
      const m = findMachine(v, machine);
      if (!m) return fail(`No machine called ${machine}.`);
      return ok({
        ...machineSummary(m),
        health: m.health,
        readiness: m.readiness?.items ?? null,
        capabilities: m.readiness?.capabilities ?? [],
        connectionSteps: accessSteps(m, null).map((s) => ({
          step: s.title,
          state: s.state,
          detail: s.detail,
          commands: s.commands,
        })),
        diagnosticsWarnings: (m.diagnostics?.checks ?? [])
          .filter((c) => c.status === "warn")
          .map((c) => `${c.title}: ${c.value}`),
        runners: v.runners
          .filter((r) => r.machineId === m.id)
          .map((r) => `${r.name} (${r.activity})`),
        recentEvents: listEvents(deps.db, { machineId: m.id, limit: 15 }).map((e) => ({
          at: new Date(e.at).toISOString(),
          kind: e.kind,
          detail: e.detail,
        })),
      });
    },
  );

  register(
    "list_runners",
    {
      title: "List runners",
      description:
        "Runners on GitHub and Forgejo that Runyard sees, with their machine, scope, labels and activity.",
      inputSchema: {
        machine: z.string().optional().describe("Only runners on this machine (name or ID)."),
      },
      annotations: READ,
    },
    ({ machine }) => {
      const v = view();
      const m = machine ? findMachine(v, machine) : undefined;
      if (machine && !m) return fail(`No machine called ${machine}.`);
      return ok(
        v.runners
          .filter((r) => !m || r.machineId === m.id)
          .map((r) => ({
            name: r.name,
            forge: r.forge,
            scope: r.scopeLabel,
            machine: v.machines.find((x) => x.id === r.machineId)?.name ?? null,
            activity: r.activity,
            labels: r.labels,
            job: r.job ? `${r.job.repo}: ${r.job.name}` : null,
          })),
      );
    },
  );

  register(
    "list_queued_jobs",
    {
      title: "List queued jobs",
      description:
        "Self-hosted jobs waiting for a runner, with how long they've waited and why nothing has taken them yet.",
      annotations: READ,
    },
    () => {
      const v = view();
      return ok(
        v.queue.jobs.map((j) => ({
          repo: j.repo,
          job: j.name,
          workflow: j.workflowName,
          labels: j.labels,
          waitingSince: new Date(j.createdAt).toISOString(),
          url: j.htmlUrl,
          why: waitingReasons(j, v),
        })),
      );
    },
  );

  register(
    "list_pools",
    {
      title: "List pools",
      description:
        "Every pool: its labels, machines and slots, what it serves, whether it's persistent or on demand, tool profiles and cleanup.",
      annotations: READ,
    },
    () => {
      const v = view();
      return ok(
        v.pools.pools.map((p) => ({
          ...p,
          machines: p.machines.map((x) => ({
            machine: v.machines.find((m) => m.id === x.machineId)?.name ?? x.machineId,
            slots: x.slots,
          })),
          runners: v.pools.desired
            .filter((d) => d.poolId === p.id)
            .map((d) => ({
              name: d.name,
              installed: v.runners.some((r) => r.name.toLowerCase() === d.name.toLowerCase()),
            })),
        })),
      );
    },
  );

  register(
    "list_test_jobs",
    {
      title: "List test jobs",
      description:
        "The latest test job of each runner that ran one, with its result and a link to the run.",
      annotations: READ,
    },
    async () => ok(await deps.testJobs.list()),
  );

  register(
    "add_machine",
    {
      title: "Add a machine",
      description:
        "Adds a machine by SSH target. Runyard checks it over SSH, read-only; installing anything still needs a reviewed change. Use machine_setup_command next if it can't connect.",
      inputSchema: {
        name: z.string().trim().min(1).max(80),
        sshTarget: z
          .string()
          .trim()
          .describe("user@host, or a Host alias from Runyard's ~/.ssh/config."),
        transport: z.enum(["openssh", "tailscale"]).default("openssh"),
        os: z.enum(["macos", "linux", "windows"]).optional(),
      },
      annotations: PREPARE,
    },
    prepare(
      ({
        name,
        sshTarget,
        transport,
        os,
      }: {
        name: string;
        sshTarget: string;
        transport: "openssh" | "tailscale";
        os?: "macos" | "linux" | "windows";
      }) => {
        const problem = validateTarget(sshTarget);
        if (problem) return fail(problem);
        const machine = createMachine(deps.db, {
          name,
          sshTarget,
          transport,
          expectedOs: os ?? null,
        });
        deps.monitor.configChanged();
        void deps.monitor.checkNow(machine.id);
        record([machine.id], `Added ${name}`);
        return ok({ id: machine.id, name, link: `${caller.origin}/machines/${machine.id}` });
      },
    ),
  );

  register(
    "save_pool",
    {
      title: "Create or edit a pool",
      description:
        "Creates a pool, or replaces an existing one's settings when `pool` names it. Saving changes nothing on machines: each machine's review installs what it calls for.",
      inputSchema: {
        pool: z.string().optional().describe("An existing pool's name or ID, to edit it."),
        name: z.string().trim().describe("Lowercase letters, digits and dashes."),
        labels: z.array(z.string().trim().min(1)).default([]),
        machines: z.array(
          z.object({ machine: z.string(), slots: z.number().int().min(1).max(16).default(1) }),
        ),
        serves: z
          .array(
            z.object({
              target: z.string().describe("An organization or account, or owner/repo."),
              forge: z.enum(["github", "forgejo"]).optional(),
            }),
          )
          .min(1),
        mode: z.enum(["persistent", "onDemand"]).default("persistent"),
        toolProfiles: z.array(z.enum(["essentials", "build", "docker"])).default([]),
        cleanup: z.enum(["off", "workspace", "docker"]).default("off"),
      },
      annotations: PREPARE,
    },
    prepare(
      (args: {
        pool?: string;
        name: string;
        labels: string[];
        machines: { machine: string; slots: number }[];
        serves: { target: string; forge?: "github" | "forgejo" }[];
        mode: "persistent" | "onDemand";
        toolProfiles: ("essentials" | "build" | "docker")[];
        cleanup: "off" | "workspace" | "docker";
      }) => {
        const v = view();
        const existing = args.pool ? findPool(v, args.pool) : undefined;
        if (args.pool && !existing) return fail(`No pool called ${args.pool}.`);
        const machines: PoolInput["machines"] = [];
        for (const x of args.machines) {
          const m = findMachine(v, x.machine);
          if (!m) return fail(`No machine called ${x.machine}.`);
          machines.push({ machineId: m.id, slots: x.slots });
        }
        const scopes: PoolInput["scopes"] = [];
        for (const s of args.serves) {
          const scope = resolveScope(v, s.target, s.forge);
          if (typeof scope === "string") return fail(scope);
          scopes.push({ ...scope, kind: scope.kind as "user" | "org" | "repo" });
        }
        const input: PoolInput = {
          name: args.name,
          labels: args.labels,
          machines,
          scopes,
          forgejoMode: existing?.forgejoMode ?? { kind: "host" },
          mode: args.mode,
          toolProfiles: args.toolProfiles,
          cleanup: args.mode === "persistent" ? args.cleanup : "off",
        };
        const problem = deps.checkPool(input, existing?.id);
        if (problem) return fail(problem);
        const id = savePool(deps.db, input, existing?.id);
        deps.monitor.configChanged();
        record(
          machines.map((m) => m.machineId),
          `${existing ? "Edited" : "Created"} pool ${args.name}`,
        );
        return ok({
          id,
          link: `${caller.origin}/pools/${id}`,
          next: "Prepare each machine's review (prepare_review) for a person to run.",
        });
      },
    ),
  );

  register(
    "prepare_review",
    {
      title: "Prepare a machine's review",
      description:
        "Reads the machine and its forges and returns the plan, exactly as the dashboard's Review changes shows it, with a link for a person to check and run it. Nothing changes until they run it; it expires in 15 minutes.",
      inputSchema: { machine: z.string().describe("The machine's name or ID.") },
      annotations: PREPARE,
    },
    prepare(async ({ machine }: { machine: string }) => {
      const m = findMachine(view(), machine);
      if (!m) return fail(`No machine called ${machine}.`);
      try {
        const review = await deps.engine.review(m.id, caller.token.name);
        record(
          [m.id],
          `Prepared a review of ${review.items.length} change${review.items.length === 1 ? "" : "s"}`,
        );
        return ok({
          link: `${caller.origin}/machines/${m.id}?review=${review.id}#changes`,
          expiresAt: new Date(review.expiresAt).toISOString(),
          changes: review.items.map((i) => ({
            action: i.action,
            runner: i.runnerName,
            reason: i.reason,
            needsAPerson: i.blocked,
          })),
          note: "A person opens the link and runs it; agents can't.",
        });
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }),
  );

  register(
    "machine_setup_command",
    {
      title: "Get a machine's setup command",
      description:
        "A one-line command to run on the machine: it authorizes Runyard's key and reports the account and host keys back. Works once, for 15 minutes; only when Runyard is reached over HTTPS.",
      inputSchema: { machine: z.string().describe("The machine's name or ID.") },
      annotations: PREPARE,
    },
    prepare(({ machine }: { machine: string }) => {
      const m = findMachine(view(), machine);
      if (!m) return fail(`No machine called ${machine}.`);
      if (!caller.origin.startsWith("https://"))
        return fail(
          "The setup command needs Runyard's HTTPS address; connect to the MCP server at its tailnet URL.",
        );
      record([m.id], "Issued a setup command");
      return ok(setupCommands(caller.origin, deps.machineSetup.issue(m.id)));
    }),
  );

  register(
    "start_test_job",
    {
      title: "Start a runner's test job",
      description:
        "Runs Runyard's short check workflow on exactly one GitHub runner Runyard installed, from a repository it serves. The repository needs .github/workflows/runyard-runner-check.yml; follow it with list_test_jobs.",
      inputSchema: {
        runner: z.string().describe("The runner's name."),
        repo: z.string().describe("owner/name of a repository the runner serves."),
        docker: z.boolean().default(false),
      },
      annotations: PREPARE,
    },
    prepare(async ({ runner, repo, docker }: { runner: string; repo: string; docker: boolean }) => {
      const r = view().runners.find((x) => x.name.toLowerCase() === runner.toLowerCase());
      if (!r) return fail(`No runner called ${runner}.`);
      const problem = testJobProblem(deps.db, r.scope, r.name, repo);
      if (problem) return fail(problem);
      try {
        const job = await deps.testJobs.start({ scope: r.scope, runnerName: r.name, repo, docker });
        if (r.machineId) record([r.machineId], `Started a test job for ${r.name} in ${repo}`);
        return ok(job);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }),
  );
}

/** What the MCP server tells an agent first: what Runyard is, and what this token allows. */
export function instructionsFor(scope: TokenScope): string {
  const base =
    "Runyard manages self-hosted CI runners on the user's machines. Read tools show what its dashboard shows. No tool runs a review: prepared reviews are links a person opens, checks and runs.";
  return scope === "prepare"
    ? `${base} This token can also prepare changes: save pools, add machines and prepare reviews.`
    : `${base} This token is read only: don't offer to save pools, add machines or prepare reviews; tell the user those need a Read and prepare token, or the dashboard.`;
}
