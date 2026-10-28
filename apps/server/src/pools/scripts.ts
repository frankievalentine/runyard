import type { LocalRunner, ServiceMode } from "@runyard/core";
import nixosHelper from "../../scripts/runner-nixos-service.py" with { type: "text" };
import installPs1 from "../../scripts/runner-install.ps1" with { type: "text" };
import installSh from "../../scripts/runner-install.sh" with { type: "text" };
import removePs1 from "../../scripts/runner-remove.ps1" with { type: "text" };
import removeSh from "../../scripts/runner-remove.sh" with { type: "text" };
import startPs1 from "../../scripts/runner-start.ps1" with { type: "text" };
import startSh from "../../scripts/runner-start.sh" with { type: "text" };
import runAsRoot from "../../scripts/run-as-root.sh" with { type: "text" };

export type Operation = "install" | "start" | "remove";

const SCRIPTS: Record<Operation, { posix: string; windows: string }> = {
  install: { posix: installSh, windows: installPs1 },
  start: { posix: startSh, windows: startPs1 },
  remove: { posix: removeSh, windows: removePs1 },
};

/** A POSIX single-quoted string. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A remote path: `~/x` becomes `"$HOME"/'x'` so the machine expands its own home. */
export function shPath(path: string): string {
  return path.startsWith("~/") ? `"$HOME"/${shQuote(path.slice(2))}` : shQuote(path);
}

export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The full script for an operation: RF_* values first (secrets included, so
 * they travel only on SSH stdin), then run_as_root, then the script.
 */
export function operationScript(
  op: Operation,
  windows: boolean,
  values: Record<string, string | undefined>,
): string {
  const entries = Object.entries(values).filter((e): e is [string, string] => e[1] !== undefined);
  if (windows) {
    const env = entries.map(([k, v]) => `$env:${k} = ${psQuote(v)}`).join("\n");
    return `${env}\n${SCRIPTS[op].windows}`;
  }
  const env = entries
    .map(([k, v]) => `export ${k}=${k === "RF_ROOT" ? shPath(v) : shQuote(v)}`)
    .join("\n");
  const nixos = `export RF_NIXOS_SERVICE_HELPER=${shQuote(nixosHelper)}`;
  return `${env}\n${nixos}\n${runAsRoot}\n${SCRIPTS[op].posix}`;
}

/**
 * Read-only: for each exact directory, whether it's configured, its service
 * state, runner version and the name in its `.runner`. Rows are tagged by
 * index, since the machine expands `~` and the path it prints differs.
 */
export function probeScript(
  windows: boolean,
  targets: { path: string; serviceMode: ServiceMode }[],
): string {
  if (windows) {
    const rows = targets.map(
      (t, i) => `$path = ${psQuote(t.path)}
$configured = Test-Path -LiteralPath (Join-Path $path '.runner')
$state = if ($configured) { 'uninstalled' } else { 'missing' }
$version = $null; $agent = $null
if ($configured) {
  $agent = (Get-Content -LiteralPath (Join-Path $path '.runner') -Raw | ConvertFrom-Json).agentName
  $needle = $path.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $service = Get-CimInstance Win32_Service | Where-Object { $_.PathName.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.Name -like 'actions.runner.*' } | Select-Object -First 1
  if ($service) { $state = $service.State.ToLowerInvariant() }
  $listener = Join-Path $path 'bin\\Runner.Listener.exe'
  if (Test-Path -LiteralPath $listener) { $version = (& $listener --version 2>$null | Select-Object -Last 1) }
}
$rows += [pscustomobject]@{ index = ${i}; configured = $configured; service = $state; version = $version; agent = $agent }`,
    );
    return [
      "$ErrorActionPreference = 'Stop'",
      "$rows = @()",
      ...rows,
      "ConvertTo-Json -Compress -Depth 3 -InputObject @($rows)",
      "Write-Output 'RF_PROBE_END'",
    ].join("\n");
  }
  const blocks = targets.map((t, i) => {
    const service =
      t.serviceMode === "launchagent"
        ? `label="$(cat "$path/.service" 2>/dev/null || true)"
  if [ -z "$label" ]; then service=uninstalled
  elif launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then service=active
  else service=inactive; fi`
        : `label="$(cat "$path/.service" 2>/dev/null || true)"
  if [ -z "$label" ]; then service=uninstalled
  else service="$(systemctl is-active "$label" 2>/dev/null || true)"; [ -n "$service" ] || service=unknown; fi`;
    return `path=${shPath(t.path)}
configured=false; service=missing; version=''; agent=''
if [ -f "$path/.runner" ]; then
  configured=true
  ${service}
  agent="$(tr -d '[:space:]' < "$path/.runner" | sed -n 's/.*"agentName":"\\([^"]*\\)".*/\\1/p')"
  if [ -x "$path/bin/Runner.Listener" ]; then
    version="$("$path/bin/Runner.Listener" --version 2>/dev/null | tail -n 1 | tr '\\t\\r\\n' '   ')"
  fi
fi
printf 'RF1\\t%s\\t%s\\t%s\\t%s\\t%s\\n' ${i} "$configured" "$service" "$version" "$agent"`;
  });
  return ["set -u", ...blocks, "printf 'RF_PROBE_END\\n'"].join("\n");
}

export class ProbeError extends Error {}

/** Decodes probe output back onto the requested paths, rejecting incomplete answers. */
export function parseProbe(
  output: string,
  windows: boolean,
  targets: { path: string }[],
): Map<string, LocalRunner> {
  if (!/(^|\n)RF_PROBE_END\r?\n?$/.test(output.trimEnd() + "\n")) {
    throw new ProbeError("The runner check didn't finish.");
  }
  const rows: {
    index: number;
    configured: boolean;
    service: string;
    version: string | null;
    agent: string | null;
  }[] = [];
  if (windows) {
    const json = output.slice(0, output.lastIndexOf("RF_PROBE_END")).trim();
    const parsed = (json ? JSON.parse(json) : []) as unknown;
    for (const r of Array.isArray(parsed) ? parsed : [parsed]) {
      const row = r as {
        index: number;
        configured: boolean;
        service: string;
        version: string | null;
        agent: string | null;
      };
      rows.push({ ...row, version: row.version || null, agent: row.agent || null });
    }
  } else {
    for (const line of output.split(/\r?\n/)) {
      if (!line.startsWith("RF1\t")) continue;
      const [, index, configured, service, version, agent] = line.split("\t");
      if (index === undefined || configured === undefined || service === undefined) {
        throw new ProbeError(`Malformed runner check row: ${line}`);
      }
      rows.push({
        index: Number(index),
        configured: configured === "true",
        service,
        version: version?.trim() || null,
        agent: agent?.trim() || null,
      });
    }
  }
  const result = new Map<string, LocalRunner>();
  for (const row of rows) {
    const target = targets[row.index];
    if (!target)
      throw new ProbeError("The runner check answered for a directory it wasn't asked about.");
    result.set(target.path, {
      path: target.path,
      configured: row.configured,
      service: row.service,
      version: row.version,
      agentName: row.agent,
    });
  }
  if (result.size !== targets.length)
    throw new ProbeError("The runner check skipped some directories.");
  return result;
}
