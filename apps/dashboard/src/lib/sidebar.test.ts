import { expect, test } from "vite-plus/test";
import { isCollapsed, parseSidebar } from "./sidebar.ts";

test("parseSidebar keeps a saved choice and drops anything else", () => {
  expect(parseSidebar("expanded")).toBe("expanded");
  expect(parseSidebar("collapsed")).toBe("collapsed");
  expect(parseSidebar(null)).toBe(null);
  expect(parseSidebar("open")).toBe(null);
});

test("the sidebar follows the window's width until someone chooses", () => {
  expect(isCollapsed(null, true)).toBe(false);
  expect(isCollapsed(null, false)).toBe(true);
});

test("a saved choice wins over the window's width", () => {
  expect(isCollapsed("expanded", false)).toBe(false);
  expect(isCollapsed("collapsed", true)).toBe(true);
});
