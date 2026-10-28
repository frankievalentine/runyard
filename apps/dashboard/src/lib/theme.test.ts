import { expect, test } from "vite-plus/test";
import { parseTheme } from "./theme.ts";

test("parseTheme falls back to system for missing or unknown values", () => {
  expect(parseTheme("dark")).toBe("dark");
  expect(parseTheme("light")).toBe("light");
  expect(parseTheme(null)).toBe("system");
  expect(parseTheme("sepia")).toBe("system");
});
