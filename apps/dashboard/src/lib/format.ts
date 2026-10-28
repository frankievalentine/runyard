/** Ported from aarondfrancis/fleet's dashboard; timestamps are epoch milliseconds. */

/** Elapsed time as a steady timer: `0:42`, `12:05`, `1:02:09`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Wall-clock time without seconds: `3:07 PM`. */
export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Relative age for "as of" labels: `just now`, `42s ago`, `5m ago`, `3h ago`, `2d ago`. */
export function timeAgo(at: number | null | undefined, now: number): string {
  if (at == null) return "never";
  const secs = Math.round((now - at) / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** How long until a time ahead: "in 14 minutes", or "now" once it's past. */
export function timeUntil(at: number, now: number): string {
  const secs = Math.round((at - now) / 1000);
  if (secs <= 0) return "now";
  if (secs < 60) return `in ${secs} seconds`;
  const mins = Math.ceil(secs / 60);
  return `in ${mins} minute${mins === 1 ? "" : "s"}`;
}

/** Decimal units, like Finder. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatPercent(p: number): string {
  return `${Math.round(p)}%`;
}

export function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** List-price dollars: cents once there are any, otherwise enough digits to see a fraction of a cent. */
export function formatDollars(dollars: number): string {
  if (dollars >= 0.01) return `$${dollars.toFixed(2)}`;
  if (dollars === 0) return "$0.00";
  return `$${dollars.toPrecision(2)}`;
}
