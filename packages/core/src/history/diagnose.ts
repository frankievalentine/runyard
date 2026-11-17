import type { MachineView } from "../machines/derive.ts";
import { readinessProblems } from "../machines/readiness.ts";
import { isLost, type JobRecord } from "./jobs.ts";

/*
 * What an agent needs to fix a failed job: the part of its log that failed, with anything that
 * looks like a secret masked, and whether the failure was the code's, the machine's, or a fluke.
 * Logs are written by whatever the job ran, so callers treat them as data, never instructions.
 */

/** Tokens and keys that a job can print by mistake, beside the forge's own masking (`***`). */
const SECRETS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bryd_[A-Za-z0-9_-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /(?<=\b(?:authorization|bearer|token|password|passwd|secret|api[_-]?key)["']?\s*[:=]\s*["']?(?:bearer\s+|basic\s+)?)[^\s"']{8,}/gi,
];

/** The text with anything that looks like a secret replaced by `[masked]`, and how many were. */
export function maskSecrets(text: string): { text: string; masked: number } {
  let masked = 0;
  let out = text;
  for (const pattern of SECRETS)
    out = out.replace(pattern, () => {
      masked++;
      return "[masked]";
    });
  return { text: out, masked };
}

/** GitHub prefixes each line with its time; Forgejo's logs may too. */
const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;
/** Where a step starts: GitHub's `##[group]Run …`, or forgejo-runner's `⭐ Run …`. */
const STEP_START = /^(?:##\[group\]|::group::)?(?:⭐\s*)?Run (.+)$/;
/** A failure: GitHub's `##[error]`, the `::error` command, or forgejo-runner's `❌  Failure`. */
const FAILURE = /^(?:##\[error\]|::error\b)|❌|^\s*Failure - |exitcode '\d+': failure/;

export type LogExcerpt = {
  /** The step that failed, as the log names it; null when the log doesn't say. */
  step: string | null;
  lines: string[];
  /** Lines were left out above the excerpt. */
  truncated: boolean;
  /** How many secrets were masked. */
  masked: number;
};

/**
 * The failing step of a job's log, from where it starts to just past its last error, at most
 * `max` lines (the end of it, where errors are). Without an error marker, the log's last lines.
 * Masks secrets. Pure.
 */
export function failingExcerpt(log: string, max = 150): LogExcerpt {
  const { text, masked } = maskSecrets(log);
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(TIMESTAMP, ""));
  while (lines.length && lines.at(-1) === "") lines.pop();
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--)
    if (FAILURE.test(lines[i]!)) {
      last = i;
      break;
    }
  if (last < 0) {
    const from = Math.max(0, lines.length - max);
    return { step: null, lines: lines.slice(from), truncated: from > 0, masked };
  }
  let start = 0;
  let step: string | null = null;
  for (let i = last; i >= 0; i--) {
    const m = STEP_START.exec(lines[i]!);
    if (m) {
      start = i;
      step = m[1]!.trim();
      break;
    }
  }
  const end = Math.min(lines.length, last + 4);
  const from = Math.max(start, end - max);
  return { step, lines: lines.slice(from, end), truncated: from > start || start > 0, masked };
}

/** Whose failure it was: the machine's, a fluke a rerun fixed, the code's, or unclear. */
export type Verdict = "machine" | "flaky" | "code" | "unknown";

export type JobDiagnosis = {
  verdict: Verdict;
  /** Why, from the job and its log, most telling first. */
  reasons: string[];
  /** What's wrong with the job's machine or runner now, which may or may not be why. */
  machineNow: string[];
};

/** Lines in a log that point at the machine rather than the code. */
const MACHINE_SIGNS: readonly [RegExp, string][] = [
  [/No space left on device|ENOSPC|not enough space on the disk/i, "The machine ran out of disk."],
  [
    /exit code 137|\bOOMKilled\b|Out of memory: Killed process|Killed\s*$/im,
    "The job was killed, usually because the machine ran out of memory.",
  ],
  [
    /The runner has received a shutdown signal|lost communication with the server|The self-hosted runner .* lost/i,
    "The runner stopped during the job: the machine restarted, slept or lost its network.",
  ],
  [
    /Cannot connect to the Docker daemon|docker: command not found/i,
    "Docker isn't running or isn't installed on the machine.",
  ],
  [
    /(?:^|\s)([\w.+-]+): (?:command )?not found$|is not recognized as an internal or external command/im,
    "A command the job runs isn't installed on the machine.",
  ],
  [
    /Could not resolve host|Temporary failure in name resolution|getaddrinfo E(?:AI_AGAIN|NOTFOUND)/i,
    "The machine couldn't resolve a host name: its network or DNS failed.",
  ],
];

export type DiagnoseInput = {
  job: JobRecord;
  now: number;
  /** The job's machine as the dashboard sees it now. */
  machine?: MachineView;
  /** The job's runner now: offline, or gone from the forge. */
  runner?: { status: string } | null;
  /** The job's log, when the forge still has it. */
  log?: string;
  /** A later attempt of the same job in the same run passed. */
  passedOnRerun?: boolean;
};

/**
 * Whether a failed job was the machine's fault, a fluke, or the code's, from the job's record,
 * its log and its machine now. The machine's signs in the job itself decide first; the machine's
 * state now is reported beside, since it may have changed since the job ran. Pure.
 */
export function diagnoseJob({
  job,
  now,
  machine,
  runner,
  log,
  passedOnRerun,
}: DiagnoseInput): JobDiagnosis {
  const reasons: string[] = [];
  const machineNow: string[] = [];

  if (machine) {
    const c = machine.connection;
    if (c.state === "offline") machineNow.push(`${machine.name} is offline.`);
    if (c.state === "error") machineNow.push(`Runyard can't reach ${machine.name}: ${c.detail}`);
    for (const a of machine.alerts)
      if (!a.muted && a.kind === "lowDisk") machineNow.push(`${machine.name}: ${a.detail}`);
    for (const p of readinessProblems(machine.readiness))
      machineNow.push(`${machine.name} readiness: ${p.title}: ${p.value}`);
  }
  if (runner === null)
    machineNow.push(`The runner ${job.runnerName ?? ""} is gone from the forge.`);
  else if (runner?.status === "offline")
    machineNow.push(`The runner ${job.runnerName ?? ""} is offline.`);

  if (isLost(job, now))
    reasons.push("The runner went away mid-job: its machine stopped, slept or lost its network.");
  if (job.conclusion === "startup_failure") reasons.push("The job failed to start on the runner.");
  const excerpt = log ? failingExcerpt(log, 400).lines.join("\n") : "";
  for (const [pattern, why] of MACHINE_SIGNS) if (pattern.test(excerpt)) reasons.push(why);
  if (reasons.length) return { verdict: "machine", reasons, machineNow };

  if (passedOnRerun)
    return {
      verdict: "flaky",
      reasons: ["A rerun of the same job passed without a change."],
      machineNow,
    };
  if (job.conclusion === "timed_out")
    return {
      verdict: "unknown",
      reasons: [
        "The job hit its time limit: a hang in the code, or a slow or busy machine. Compare its time with earlier runs.",
      ],
      machineNow,
    };
  if (log?.split(/\r?\n/).some((l) => FAILURE.test(l.replace(TIMESTAMP, ""))))
    return {
      verdict: "code",
      reasons: [
        "A step failed with no sign of a machine problem: the log's error is the place to start.",
      ],
      machineNow,
    };
  return {
    verdict: "unknown",
    reasons: [log ? "The log doesn't show why." : "The forge no longer has the log."],
    machineNow,
  };
}
