import { describe, expect, test } from "vite-plus/test";
import { isValidScopeTarget, scopeKey } from "../src/index.ts";

describe("scopeKey", () => {
  test("treats logins case-insensitively", () => {
    expect(scopeKey({ forgeId: "gh", kind: "repo", target: "Frankie/Runyard" })).toBe(
      scopeKey({ forgeId: "gh", kind: "repo", target: "frankie/runyard" }),
    );
  });

  test("keeps forges and kinds apart", () => {
    const a = scopeKey({ forgeId: "gh", kind: "user", target: "acme" });
    const b = scopeKey({ forgeId: "gh", kind: "org", target: "acme" });
    const c = scopeKey({ forgeId: "fj", kind: "user", target: "acme" });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("isValidScopeTarget", () => {
  test.each([
    ["repo", "acme/app", true],
    ["repo", "acme", false],
    ["repo", "acme/app/extra", false],
    ["org", "acme", true],
    ["org", "acme/app", false],
    ["instance", "", true],
    ["instance", "acme", false],
  ] as const)("%s %j -> %s", (kind, target, valid) => {
    expect(isValidScopeTarget(kind, target)).toBe(valid);
  });
});
