import { expect, test } from "vite-plus/test";
import { pointsAt } from "./webhooks.ts";

const funnel = "https://mini.tail1.ts.net";

test("the manifest's placeholder on the dashboard's port isn't the public address", () => {
  expect(pointsAt("https://mini.tail1.ts.net:7443/webhooks/github", funnel)).toBe(false);
  expect(pointsAt("https://mini.tail1.ts.net/webhooks/github", funnel)).toBe(true);
  expect(pointsAt("https://mini.tail1.ts.net:443/webhooks/github", funnel)).toBe(true);
});

test("without a known public address, anything but loopback counts", () => {
  expect(pointsAt("https://ci.example.com/webhooks/github", null)).toBe(true);
  expect(pointsAt("http://127.0.0.1:7420/webhooks/github", null)).toBe(false);
  expect(pointsAt(null, funnel)).toBe(false);
});
