import { expect, test } from "vite-plus/test";
import { formatSetupCode, passwordStrength } from "./claim.ts";
import { suggestedPasskeyName } from "./passkeys.ts";

test("groups a setup code in fours as it's typed", () => {
  expect(formatSetupCode("q481")).toBe("Q481");
  expect(formatSetupCode("q481t")).toBe("Q481-T");
  expect(formatSetupCode("Q481 TKXH-ypqv")).toBe("Q481-TKXH-YPQV");
  // Pasted with extra characters or too long: only the twelve symbols stay.
  expect(formatSetupCode(" Q481-TKXH-YPQV-EXTRA ")).toBe("Q481-TKXH-YPQV");
  expect(formatSetupCode("")).toBe("");
});

test("rates a password against the 12-character minimum", () => {
  expect(passwordStrength("short1A!")).toBe(0);
  expect(passwordStrength("abcdefghijkl")).toBe(1);
  expect(passwordStrength("abcdefghijK1")).toBe(2);
  expect(passwordStrength("correct horse battery staple")).toBe(3);
});

test("names a passkey after the device it's made on", () => {
  expect(suggestedPasskeyName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Mac");
  expect(suggestedPasskeyName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(
    "iPhone",
  );
  expect(suggestedPasskeyName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows PC");
  expect(suggestedPasskeyName("")).toBe("This device");
});
