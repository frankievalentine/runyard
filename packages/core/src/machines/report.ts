import type { DiskStats, MachineReport, OsFamily } from "./model.ts";

export class ReportError extends Error {}

const OS_NAMES: Record<string, OsFamily> = {
  macos: "macos",
  linux: "linux",
  windows: "windows",
  other: "other",
};

/**
 * Decodes the health and diagnostics script output (`RFM\tname\tvalue` rows
 * ending in `RFM_END`), rejecting truncated or inconsistent reports. Ported
 * from fleet's `parse_inspection`, without the runner probe.
 *
 * `expectedOs` is the OS the machine should report; `other` accepts any.
 */
export function parseReport(output: string, expectedOs: OsFamily): MachineReport {
  const fields = new Map<string, string>();
  const disks = new Map<string, DiskStats>();
  let complete = false;

  for (const line of output.split(/\r?\n/)) {
    if (line === "RFM_END") {
      complete = true;
      continue;
    }
    if (!line.startsWith("RFM\t")) continue;
    const row = line.slice(4);
    const tab = row.indexOf("\t");
    if (tab < 0) throw new ReportError("Malformed machine health row.");
    const name = row.slice(0, tab);
    const value = row.slice(tab + 1);
    if (name === "disk") {
      const parts = value.split("\t");
      if (parts.length !== 3) throw new ReportError("Malformed disk health row.");
      const [mountPoint, total, available] = parts as [string, string, string];
      const totalBytes = integer("disk capacity", total);
      const availableBytes = integer("available disk space", available);
      if (totalBytes === 0 || availableBytes > totalBytes) {
        throw new ReportError("Invalid disk capacity in the SSH report.");
      }
      disks.set(mountPoint, { mountPoint, totalBytes, availableBytes });
    } else {
      fields.set(name, value);
    }
  }
  if (!complete) throw new ReportError("The SSH health check was interrupted.");

  const os = OS_NAMES[fields.get("os") ?? ""];
  if (!os) throw new ReportError("The SSH check did not identify the operating system.");
  if (expectedOs !== "other" && os !== expectedOs) {
    throw new ReportError(
      "The machine's operating system doesn't match the one Runyard expects for it.",
    );
  }

  const get = (name: string) => {
    const value = fields.get(name);
    return value ? value : null;
  };
  const cpuPercent = optional(get("cpu"), (v) => decimal("CPU usage", v));
  if (cpuPercent !== null && (cpuPercent < 0 || cpuPercent > 100)) {
    throw new ReportError("Invalid CPU usage in the SSH report.");
  }
  const loadAverage = optional(get("load"), (v) => {
    const values = v
      .trim()
      .split(/\s+/)
      .map((n) => decimal("load average", n));
    if (values.length !== 3 || values.some((n) => n < 0)) {
      throw new ReportError("Invalid load average in the SSH report.");
    }
    return values as [number, number, number];
  });
  const memoryTotalBytes = optional(get("memory_total"), (v) => integer("total memory", v));
  const memoryAvailableBytes = optional(get("memory_available"), (v) =>
    integer("available memory", v),
  );
  if (
    memoryTotalBytes !== null &&
    memoryAvailableBytes !== null &&
    (memoryTotalBytes === 0 || memoryAvailableBytes > memoryTotalBytes)
  ) {
    throw new ReportError("Invalid memory capacity in the SSH report.");
  }

  const diagnostics: Record<string, string> = {};
  if (get("diag:complete") === "1") {
    for (const [key, value] of fields) {
      if (key.startsWith("diag:") && key !== "diag:complete") diagnostics[key.slice(5)] = value;
    }
  }

  return {
    os,
    osVersion: get("os_version"),
    cpuPercent,
    loadAverage,
    logicalCores: optional(get("cores"), (v) => integer("CPU count", v)),
    memoryTotalBytes,
    memoryAvailableBytes,
    uptimeSecs: optional(get("uptime"), (v) => integer("uptime", v)),
    bootId: get("boot_id"),
    disks: [...disks.values()].sort((a, b) => a.mountPoint.localeCompare(b.mountPoint)),
    diagnostics,
    warnings:
      cpuPercent === null || memoryTotalBytes === null || memoryAvailableBytes === null
        ? ["Some health metrics could not be read over SSH."]
        : [],
  };
}

function optional<T>(value: string | null, parse: (v: string) => T): T | null {
  return value === null ? null : parse(value);
}

function integer(name: string, value: string): number {
  if (!/^\d+$/.test(value)) throw new ReportError(`Invalid ${name} in the SSH report.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new ReportError(`Invalid ${name} in the SSH report.`);
  return n;
}

function decimal(name: string, value: string): number {
  const n = Number(value);
  if (value.trim() === "" || !Number.isFinite(n))
    throw new ReportError(`Invalid ${name} in the SSH report.`);
  return n;
}
