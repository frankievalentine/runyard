import { describe, expect, test } from "bun:test";
import type { YardView } from "@runyard/core";
import { body, send, sessionCookie, testApp } from "../testing.ts";
import { secrets as secretsTable } from "../db/schema.ts";
import { listGithubApps } from "./store.ts";

const PASSWORD = "correct horse battery";

async function admin() {
  const t = await testApp();
  const res = await send(t.app, "POST", "/api/setup", {
    code: t.codes[0],
    username: "admin",
    password: PASSWORD,
  });
  return { ...t, cookie: sessionCookie(res) };
}

/** Runs the manifest flow end to end against the fake GitHub. */
async function createApp(t: Awaited<ReturnType<typeof admin>>, org: string | null = null) {
  const { action, manifest } = await body<{ action: string; manifest: string }>(
    send(t.app, "POST", "/api/github/manifest", { org }, { Cookie: t.cookie }),
  );
  const state = new URL(action).searchParams.get("state")!;
  const callback = await t.app.request(
    `/api/github/manifest/callback?code=good-code&state=${state}`,
  );
  return { action, manifest: JSON.parse(manifest) as Record<string, unknown>, callback, state };
}

const yard = async (t: Awaited<ReturnType<typeof admin>>) =>
  body<YardView>(send(t.app, "GET", "/api/yard", undefined, { Cookie: t.cookie }));

describe("GitHub App setup", () => {
  test("builds a manifest for the user's or an organization's settings", async () => {
    const t = await admin();
    const personal = await createApp(t);
    expect(personal.action).toStartWith("https://github.test/settings/apps/new?state=");
    expect(personal.manifest).toMatchObject({
      public: false,
      redirect_url: "http://localhost/api/github/manifest/callback",
      default_permissions: {
        administration: "write",
        organization_self_hosted_runners: "write",
        actions: "read",
      },
      hook_attributes: { active: false },
    });
    const org = await createApp(t, "acme");
    expect(org.action).toStartWith(
      "https://github.test/organizations/acme/settings/apps/new?state=",
    );
  });

  test("the callback stores the app with its key encrypted, and each state works once", async () => {
    const t = await admin();
    const { callback, state } = await createApp(t);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toStartWith("/settings/github?created=gh_");
    const [app] = listGithubApps(t.deps.db);
    expect(app).toMatchObject({
      appId: "424242",
      slug: "runyard-test",
      owner: "frankie",
      ownerType: "User",
    });
    const stored = t.deps.db.select().from(secretsTable).all();
    expect(stored.map((s) => s.id).sort()).toContain(`github.${app!.id}.pem`);
    expect(stored.every((s) => !Buffer.from(s.ciphertext).toString().includes("PRIVATE KEY"))).toBe(
      true,
    );

    const replay = await t.app.request(
      `/api/github/manifest/callback?code=good-code&state=${state}`,
    );
    expect(replay.headers.get("location")).toBe("/settings/github?error=expired");
  });

  test("only admins can start setup", async () => {
    const t = await admin();
    expect((await send(t.app, "POST", "/api/github/manifest", { org: null })).status).toBe(401);
  });
});

describe("GitHub monitoring", () => {
  test("an organization installation: org runners, a busy runner's job and the queue", async () => {
    const t = await admin();
    const gh = t.fakeGithub;
    gh.installations = [
      { id: 11, account: "acme", type: "Organization", repos: ["acme/app"], selection: "all" },
    ];
    gh.runners.set("acme", [
      {
        id: 1,
        name: "mini-01",
        os: "macOS",
        status: "online",
        busy: true,
        labels: ["self-hosted", "macOS", "xcode"],
      },
      {
        id: 2,
        name: "mini-02",
        os: "macOS",
        status: "online",
        busy: false,
        labels: ["self-hosted", "macOS", "xcode"],
      },
    ]);
    gh.runs.set("acme/app", [
      {
        id: 500,
        status: "in_progress",
        jobs: [
          {
            id: 9001,
            name: "build",
            status: "in_progress",
            labels: ["self-hosted", "xcode"],
            runner_id: 1,
            runner_name: "mini-01",
            created_at: new Date().toISOString(),
            started_at: new Date().toISOString(),
          },
        ],
      },
      {
        id: 501,
        status: "queued",
        jobs: [
          {
            id: 9002,
            name: "test",
            status: "queued",
            labels: ["self-hosted", "xcode"],
            created_at: new Date().toISOString(),
          },
        ],
      },
    ]);
    await createApp(t);
    await t.github.refreshAll();

    const view = await yard(t);
    expect(view.github.apps[0]?.installations[0]).toMatchObject({
      account: "acme",
      accountType: "Organization",
      repoCount: 1,
    });
    expect(view.github.runners.map((r) => [r.name, r.activity, r.scopeLabel])).toEqual([
      ["mini-01", "busy", "acme"],
      ["mini-02", "idle", "acme"],
    ]);
    expect(view.github.runners[0]?.job).toMatchObject({ id: 9001, repo: "acme/app" });
    // Busy runners with the labels count: they take the job once free.
    expect(view.github.queue.jobs.map((j) => [j.id, j.eligible.length])).toEqual([[9002, 2]]);
    expect(view.github.apps[0]?.rateLimit).toMatchObject({ limit: 5000 });
  });

  test("a personal installation reads runners per selected repository", async () => {
    const t = await admin();
    const gh = t.fakeGithub;
    gh.installations = [
      {
        id: 12,
        account: "frankie",
        type: "User",
        repos: ["frankie/app", "frankie/site"],
        selection: "selected",
      },
    ];
    gh.runners.set("frankie/app", [
      {
        id: 7,
        name: "box-01",
        os: "Linux",
        status: "online",
        busy: false,
        labels: ["self-hosted"],
      },
    ]);
    gh.runners.set("frankie/site", [
      {
        id: 8,
        name: "box-01",
        os: "Linux",
        status: "offline",
        busy: false,
        labels: ["self-hosted"],
      },
    ]);
    await createApp(t);
    await t.github.refreshAll();
    const view = await yard(t);
    expect(view.github.runners.map((r) => [r.scopeLabel, r.activity])).toEqual([
      ["frankie/app", "idle"],
      ["frankie/site", "offline"],
    ]);
  });

  test("reuses installation tokens and answers unchanged pages from the ETag cache", async () => {
    const t = await admin();
    const gh = t.fakeGithub;
    gh.installations = [
      { id: 11, account: "acme", type: "Organization", repos: ["acme/app"], selection: "all" },
    ];
    await createApp(t);
    await t.github.refreshAll();
    const reads = () =>
      gh.requests.filter((r) => r.startsWith("GET /orgs/acme/actions/runners")).length;
    const before = reads();
    await t.github.pollRunners();
    // However many refreshes ran, one installation token served them all.
    expect(gh.requests.filter((r) => r.includes("access_tokens"))).toHaveLength(1);
    expect(reads()).toBe(before + 1);
  });

  test("a revoked installation is reported, not thrown", async () => {
    const t = await admin();
    t.fakeGithub.installations = [
      { id: 11, account: "acme", type: "Organization", repos: [], selection: "all" },
    ];
    await createApp(t);
    await t.github.refreshAll();
    t.fakeGithub.tokens.clear();
    // The cached token is now unknown to GitHub.
    await t.github.pollRunners();
    const view = await yard(t);
    expect(view.github.apps[0]?.installations[0]?.runnersError).toContain("401");
  });
});
