import { expect, test } from "bun:test";
import { parseSelf, parseWhois, TailscaleCli, WhoisCache } from "./tailscale.ts";

const status = (over: object = {}) =>
  JSON.stringify({
    BackendState: "Running",
    Self: { DNSName: "box.tail1234.ts.net.", TailscaleIPs: ["100.64.0.1", "fd7a:115c:a1e0::1"] },
    CertDomains: ["box.tail1234.ts.net"],
    ...over,
  });

test("parseSelf reads the name, addresses and certificate support", () => {
  expect(parseSelf(status())).toEqual({
    dnsName: "box.tail1234.ts.net",
    ips: ["100.64.0.1", "fd7a:115c:a1e0::1"],
    canCert: true,
  });
  expect(parseSelf(status({ CertDomains: null }))).toMatchObject({ canCert: false });
});

test("parseSelf explains why Tailscale isn't usable", () => {
  expect(parseSelf(status({ BackendState: "NeedsLogin" }))).toBeInstanceOf(Error);
  expect((parseSelf(status({ Self: { DNSName: "" } })) as Error).message).toContain("MagicDNS");
  expect((parseSelf("The Tailscale CLI failed to start") as Error).message).toContain(
    "other than JSON",
  );
  expect(parseWhois("not json")).toBeNull();
});

test("parseWhois returns the person, never a tagged device's placeholder", () => {
  expect(
    parseWhois(JSON.stringify({ Node: {}, UserProfile: { LoginName: "Frankie@Example.com" } })),
  ).toBe("frankie@example.com");
  expect(
    parseWhois(
      JSON.stringify({ Node: { Tags: ["tag:ci"] }, UserProfile: { LoginName: "tagged-devices" } }),
    ),
  ).toBeNull();
});

test("the CLI wrapper passes arguments as an array and reports failures", async () => {
  const calls: string[][] = [];
  const cli = new TailscaleCli(async (argv) => {
    calls.push([...argv]);
    return argv[1] === "whois"
      ? { code: 1, stdout: "", stderr: "no match" }
      : { code: 0, stdout: status(), stderr: "" };
  }, "tailscale");
  expect(await cli.self()).toMatchObject({ dnsName: "box.tail1234.ts.net" });
  expect(await cli.whois("100.64.0.9")).toBeNull();
  expect(calls[1]).toEqual(["tailscale", "whois", "--json", "100.64.0.9"]);
});

test("WhoisCache asks once per address until the entry expires", async () => {
  let lookups = 0;
  const cache = new WhoisCache(async () => (lookups++, "a@example.com"), 1000);
  await cache.login("100.64.0.2", 0);
  await cache.login("100.64.0.2", 999);
  expect(lookups).toBe(1);
  await cache.login("100.64.0.2", 1000);
  expect(lookups).toBe(2);
});
