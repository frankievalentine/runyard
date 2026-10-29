/**
 * Whether an app's webhook URL points at Runyard's public address. A new
 * app's manifest sets the dashboard's own address as a placeholder, which can
 * share the host and differ only in port, so the whole origin must match.
 */
export function pointsAt(hookUrl: string | null, publicUrl: string | null): boolean {
  if (!hookUrl || !URL.canParse(hookUrl)) return false;
  const hook = new URL(hookUrl);
  if (publicUrl) return URL.canParse(publicUrl) && hook.origin === new URL(publicUrl).origin;
  return hook.hostname !== "127.0.0.1" && hook.hostname !== "localhost";
}
