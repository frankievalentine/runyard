import { randomToken } from "../auth/tokens.ts";
import { API_VERSION, GithubError, type Fetch } from "./client.ts";
import type { ManifestConversion } from "./store.ts";

/**
 * The permissions Runyard asks for. Runner registration (runner management)
 * needs write; asking now saves re-approving every installation later.
 * Actions write starts a runner's test job (workflow_dispatch).
 */
export const APP_PERMISSIONS = {
  actions: "write",
  administration: "write",
  metadata: "read",
  organization_self_hosted_runners: "write",
} as const;

const STATE_MS = 60 * 60_000;

/** GitHub's app manifest, for a Runyard reachable at `origin`. */
export function buildManifest(name: string, origin: string) {
  return {
    name,
    url: origin,
    description: "Monitors and manages this account's self-hosted runners for Runyard.",
    redirect_url: `${origin}/api/github/manifest/callback`,
    setup_url: `${origin}/settings/github`,
    setup_on_update: true,
    public: false,
    default_permissions: APP_PERMISSIONS,
    // Subscribed from the start, but inactive: polling works without webhooks, and
    // GitHub's API can't switch a hook on, so that's one checkbox once a public URL exists.
    default_events: ["workflow_job"],
    hook_attributes: { url: `${origin}/webhooks/github`, active: false },
  };
}

/** Where the browser posts the manifest: the user's settings, or an organization's. */
export function manifestUrl(webBase: string, org: string | null, state: string) {
  const path = org
    ? `/organizations/${encodeURIComponent(org)}/settings/apps/new`
    : "/settings/apps/new";
  return `${webBase}${path}?state=${encodeURIComponent(state)}`;
}

/**
 * Single-use states for the manifest flow. GitHub's redirect back is a
 * cross-site navigation, so SameSite=Strict session cookies don't arrive; the
 * state, issued to the admin who started the flow, authorizes the callback.
 */
export class ManifestStates {
  private states = new Map<string, number>();

  issue(now = Date.now()): string {
    for (const [s, at] of this.states) if (now - at > STATE_MS) this.states.delete(s);
    const state = randomToken(24);
    this.states.set(state, now);
    return state;
  }

  consume(state: string, now = Date.now()): boolean {
    const at = this.states.get(state);
    this.states.delete(state);
    return at !== undefined && now - at <= STATE_MS;
  }
}

/** Exchanges the one-time code GitHub returns for the new app's credentials. */
export async function convertManifest(
  fetch: Fetch,
  apiBase: string,
  code: string,
): Promise<ManifestConversion> {
  const res = await fetch(
    new Request(`${apiBase}/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "runyard",
      },
    }),
  );
  if (!res.ok) {
    throw new GithubError(
      `GitHub didn't accept the app setup code (${res.status}). Start again from Settings ▸ GitHub.`,
      res.status,
    );
  }
  return (await res.json()) as ManifestConversion;
}
