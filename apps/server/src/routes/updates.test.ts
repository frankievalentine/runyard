import { expect, test } from "bun:test";
import { createUser } from "../auth/users.ts";
import { body, send, sessionCookie, testApp } from "../testing.ts";
import type { UpdateStatus } from "../updates/checker.ts";

const PASSWORD = "correct horse battery";
const RELEASE = {
  tag_name: "v0.4.0",
  html_url: "https://github.com/frankievalentine/runyard/releases/tag/v0.4.0",
  published_at: "2026-11-20T10:00:00Z",
};

async function signedIn() {
  const t = await testApp();
  const res = await send(t.app, "POST", "/api/setup", {
    code: t.codes[0],
    username: "admin",
    password: PASSWORD,
  });
  await createUser(t.deps.db, { username: "viewer", password: PASSWORD, role: "viewer" });
  const viewer = sessionCookie(
    await send(t.app, "POST", "/api/login", { username: "viewer", password: PASSWORD }),
  );
  return { ...t, admin: sessionCookie(res), viewer };
}

test("reports nothing to update until a check finds a newer release", async () => {
  const { app, admin, release } = await signedIn();
  const before = await body<UpdateStatus>(
    send(app, "GET", "/api/updates", undefined, { Cookie: admin }),
  );
  expect(before).toMatchObject({ current: "0.3.0", enabled: true, latest: null, available: false });

  release.latest = RELEASE;
  const after = await body<UpdateStatus>(
    send(app, "POST", "/api/updates/check", undefined, { Cookie: admin }),
  );
  expect(after.latest).toEqual({
    version: "0.4.0",
    url: RELEASE.html_url,
    publishedAt: RELEASE.published_at,
  });
  expect(after.available).toBe(true);
  expect(after.steps?.command).toContain("'/home/runner/.local/bin/runyard' service install");
});

test("the same release isn't an update", async () => {
  const { app, admin, release } = await signedIn();
  release.latest = { ...RELEASE, tag_name: "v0.3.0" };
  const status = await body<UpdateStatus>(
    send(app, "POST", "/api/updates/check", undefined, { Cookie: admin }),
  );
  expect(status).toMatchObject({ available: false, steps: null, error: null });
});

test("keeps the last answer when a check fails", async () => {
  const { app, admin, release } = await signedIn();
  release.latest = RELEASE;
  await send(app, "POST", "/api/updates/check", undefined, { Cookie: admin });
  release.latest = null;
  const status = await body<UpdateStatus>(
    send(app, "POST", "/api/updates/check", undefined, { Cookie: admin }),
  );
  expect(status.latest?.version).toBe("0.4.0");
  expect(status.error).toContain("no published Runyard release");
});

test("ignores a release link that isn't on GitHub", async () => {
  const { app, admin, release } = await signedIn();
  release.latest = { ...RELEASE, html_url: "https://example.com/runyard" };
  const status = await body<UpdateStatus>(
    send(app, "POST", "/api/updates/check", undefined, { Cookie: admin }),
  );
  expect(status.latest).toBeNull();
  expect(status.error).not.toBeNull();
});

test("the daily check stops when an admin turns it off", async () => {
  const { app, admin, release, updates, clock } = await signedIn();
  release.latest = RELEASE;
  const off = await body<UpdateStatus>(
    send(app, "PUT", "/api/updates/settings", { enabled: false }, { Cookie: admin }),
  );
  expect(off.enabled).toBe(false);
  await updates.tick();
  expect(updates.status().checkedAt).toBeNull();

  await send(app, "PUT", "/api/updates/settings", { enabled: true }, { Cookie: admin });
  await updates.tick();
  expect(updates.status().checkedAt).toBe(clock.now);
  // Not again within a day.
  release.latest = { ...RELEASE, tag_name: "v0.5.0" };
  clock.now += 60 * 60_000;
  await updates.tick();
  expect(updates.status().latest?.version).toBe("0.4.0");
  clock.now += 24 * 60 * 60_000;
  await updates.tick();
  expect(updates.status().latest?.version).toBe("0.5.0");
});

test("viewers can see the version but not check or change the setting", async () => {
  const { app, viewer } = await signedIn();
  expect((await send(app, "GET", "/api/updates")).status).toBe(401);
  expect((await send(app, "GET", "/api/updates", undefined, { Cookie: viewer })).status).toBe(200);
  expect(
    (await send(app, "POST", "/api/updates/check", undefined, { Cookie: viewer })).status,
  ).toBe(403);
  expect(
    (await send(app, "PUT", "/api/updates/settings", { enabled: false }, { Cookie: viewer }))
      .status,
  ).toBe(403);
});
