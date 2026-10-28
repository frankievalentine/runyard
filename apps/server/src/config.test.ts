import { expect, test } from "bun:test";
import { dataDir } from "./config.ts";

test("RUNYARD_DATA_DIR wins on every platform", () => {
  expect(dataDir({ RUNYARD_DATA_DIR: "/srv/runyard" }, "darwin", "/Users/a")).toBe("/srv/runyard");
});

test("platform defaults", () => {
  expect(dataDir({}, "darwin", "/Users/a")).toBe("/Users/a/Library/Application Support/Runyard");
  expect(dataDir({}, "linux", "/home/a")).toBe("/home/a/.local/share/runyard");
  expect(dataDir({ XDG_DATA_HOME: "/data" }, "linux", "/home/a")).toBe("/data/runyard");
});
