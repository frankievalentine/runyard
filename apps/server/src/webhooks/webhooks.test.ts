import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { setup, type Setup } from "../pools/test-helpers.ts";

const sign = (secret: string, body: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

function deliver(s: Setup, body: string, headers: Record<string, string>) {
  return s.receiver.handle(
    new Request("http://127.0.0.1:7444/webhooks/github", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-github-event": "workflow_job",
        "x-github-hook-installation-target-id": s.fakeGithub.appId,
        ...headers,
      },
    }),
  );
}

const jobReads = (s: Setup) =>
  s.fakeGithub.requests.filter((r) => r.includes("/actions/runs")).length;

/** An app whose hook Runyard set up, with the secret GitHub now has. */
async function configured() {
  const s = await setup({ account: "acme", type: "Organization", repos: ["acme/app"] });
  s.fakeGithub.runs.set("acme/app", []);
  const res = await s.raw("POST", `/api/webhooks/github/${s.forgeId}`, {
    url: "https://mini.tail1.ts.net/",
  });
  expect(res.status).toBe(200);
  return { s, secret: s.fakeGithub.hook.secret! };
}

describe("GitHub webhooks", () => {
  test("setup points the app's hook at Runyard's public URL with a fresh secret", async () => {
    const { s, secret } = await configured();
    expect(s.fakeGithub.hook.url).toBe("https://mini.tail1.ts.net/webhooks/github");
    expect(secret.length).toBeGreaterThan(30);
    s.funnel.url = "https://mini.tail1.ts.net";
    const status = await s.call<{
      funnelUrl: string;
      apps: { hookUrl: string; subscribed: boolean; secretSet: boolean; settingsUrl: string }[];
    }>("GET", "/api/webhooks/status");
    expect(status.funnelUrl).toBe("https://mini.tail1.ts.net");
    expect(status.apps[0]).toMatchObject({
      hookUrl: "https://mini.tail1.ts.net/webhooks/github",
      subscribed: false,
      secretSet: true,
      settingsUrl: expect.stringContaining("/settings/apps/"),
    });
    expect(
      (await s.raw("POST", `/api/webhooks/github/${s.forgeId}`, { url: "http://insecure.example" }))
        .status,
    ).toBe(400);
  });

  test("a signed workflow_job delivery re-reads jobs once; replays and bad signatures do nothing", async () => {
    const { s, secret } = await configured();
    const body = JSON.stringify({ action: "queued", workflow_job: { id: 1 } });
    const before = jobReads(s);
    expect(
      (
        await deliver(s, body, {
          "x-github-delivery": "d1",
          "x-hub-signature-256": sign(secret, body),
        })
      ).status,
    ).toBe(202);
    await s.receiver.settled();
    const after = jobReads(s);
    expect(after).toBeGreaterThan(before);

    expect(
      (
        await deliver(s, body, {
          "x-github-delivery": "d1",
          "x-hub-signature-256": sign(secret, body),
        })
      ).status,
    ).toBe(202);
    await s.receiver.settled();
    expect(jobReads(s)).toBe(after);

    expect(
      (
        await deliver(s, body, {
          "x-github-delivery": "d2",
          "x-hub-signature-256": sign("wrong", body),
        })
      ).status,
    ).toBe(401);
    expect((await deliver(s, body, { "x-github-delivery": "d3" })).status).toBe(401);
    expect(
      (
        await deliver(s, body, {
          "x-github-delivery": "d4",
          "x-hub-signature-256": sign(secret, body),
          "x-github-hook-installation-target-id": "999",
        })
      ).status,
    ).toBe(401);
    await s.receiver.settled();
    expect(jobReads(s)).toBe(after);
  });

  test("only signed POSTs to the webhook path are answered", async () => {
    const { s } = await configured();
    expect((await s.receiver.handle(new Request("http://127.0.0.1:7444/api/yard"))).status).toBe(
      404,
    );
    expect(
      (await s.receiver.handle(new Request("http://127.0.0.1:7444/webhooks/github"))).status,
    ).toBe(404);
  });
});
