import { expect, test } from "vite-plus/test";
import {
  formatBytes,
  formatDollars,
  formatElapsed,
  formatUptime,
  plural,
  timeAgo,
} from "./format.ts";

test("timeAgo", () => {
  expect(timeAgo(null, 0)).toBe("never");
  expect(timeAgo(0, 3_000)).toBe("just now");
  expect(timeAgo(0, 42_000)).toBe("42s ago");
  expect(timeAgo(0, 5 * 60_000)).toBe("5m ago");
  expect(timeAgo(0, 3 * 3_600_000)).toBe("3h ago");
  expect(timeAgo(0, 72 * 3_600_000)).toBe("3d ago");
});

test("formatBytes uses decimal units", () => {
  expect(formatBytes(null)).toBe("—");
  expect(formatBytes(999)).toBe("999 B");
  expect(formatBytes(24_000_000_000)).toBe("24.0 GB");
  expect(formatBytes(512_000_000_000)).toBe("512 GB");
});

test("formatUptime and plural", () => {
  expect(formatUptime(90_061)).toBe("1d 1h");
  expect(formatUptime(3_660)).toBe("1h 1m");
  expect(plural(1, "machine")).toBe("1 machine");
  expect(plural(2, "machine")).toBe("2 machines");
});

test("formatElapsed is a steady timer", () => {
  expect(formatElapsed(42_000)).toBe("0:42");
  expect(formatElapsed(725_000)).toBe("12:05");
  expect(formatElapsed(3_729_000)).toBe("1:02:09");
});

test("formats list-price dollars", () => {
  expect(formatDollars(12.345)).toBe("$12.35");
  expect(formatDollars(0.0006)).toBe("$0.00060");
  expect(formatDollars(0)).toBe("$0.00");
});
