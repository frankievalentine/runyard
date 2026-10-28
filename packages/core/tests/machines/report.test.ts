import { describe, expect, test } from "vite-plus/test";
import { parseReport, ReportError } from "../../src/index.ts";

const MAC =
  "RFM\tos\tmacos\nRFM\tos_version\t15.6\nRFM\tcores\t12\nRFM\tcpu\t23.50\nRFM\tload\t1.5 2.0 0.8\n" +
  "RFM\tmemory_total\t24000000000\nRFM\tmemory_available\t8000000000\nRFM\tuptime\t86400\n" +
  "RFM\tdisk\t/\t500000000000\t300000000000\nRFM_END\n";

describe("parseReport", () => {
  test("parses health, ignoring login banners", () => {
    expect(parseReport(`Welcome to the build box\n${MAC}`, "macos")).toEqual({
      os: "macos",
      osVersion: "15.6",
      cpuPercent: 23.5,
      loadAverage: [1.5, 2, 0.8],
      logicalCores: 12,
      memoryTotalBytes: 24_000_000_000,
      memoryAvailableBytes: 8_000_000_000,
      uptimeSecs: 86400,
      bootId: null,
      disks: [{ mountPoint: "/", totalBytes: 500_000_000_000, availableBytes: 300_000_000_000 }],
      diagnostics: {},
      warnings: [],
    });
  });

  test("unavailable metrics stay unknown, with a warning", () => {
    const report = parseReport("RFM\tos\tmacos\nRFM\tcpu\t\nRFM_END\n", "macos");
    expect(report.cpuPercent).toBeNull();
    expect(report.disks).toEqual([]);
    expect(report.warnings).toEqual(["Some health metrics could not be read over SSH."]);
  });

  test("keeps the boot session identity", () => {
    expect(parseReport(MAC.replace("RFM_END", "RFM\tboot_id\tB-1\nRFM_END"), "macos").bootId).toBe(
      "B-1",
    );
  });

  test("reads Windows CRLF output and drive letters", () => {
    const output =
      "RFM\tos\twindows\r\nRFM\tos_version\tWindows 11 Pro\r\nRFM\tcpu\t12\r\nRFM\tmemory_total\t32000000000\r\n" +
      "RFM\tmemory_available\t16000000000\r\nRFM\tdisk\tC:\\\t512000000000\t140000000000\r\nRFM_END\r\n";
    const report = parseReport(output, "windows");
    expect(report.os).toBe("windows");
    expect(report.disks[0]?.mountPoint).toBe("C:\\");
  });

  test("keeps diagnostics only when the section completed", () => {
    const facts = "RFM\tdiag:identity\tci\nRFM\tdiag:architecture\tarm64\n";
    const done = parseReport(
      MAC.replace("RFM_END", `${facts}RFM\tdiag:complete\t1\nRFM_END`),
      "macos",
    );
    expect(done.diagnostics).toEqual({ identity: "ci", architecture: "arm64" });
    expect(parseReport(MAC.replace("RFM_END", `${facts}RFM_END`), "macos").diagnostics).toEqual({});
  });

  test("any OS is accepted when none is expected", () => {
    expect(parseReport(MAC.replace("macos", "linux"), "other").os).toBe("linux");
  });

  test("partial or invalid responses are errors, never healthy zeros", () => {
    for (const output of [
      MAC.replace("RFM_END\n", ""),
      MAC.replace("23.50", "NaN"),
      MAC.replace("23.50", "101"),
      MAC.replace("8000000000", "25000000000"),
      MAC.replace("1.5 2.0 0.8", "1.5"),
      MAC.replace("300000000000", "600000000000"),
      MAC.replace("RFM\tos\tmacos\n", ""),
      MAC.replace("RFM\tuptime\t86400", "RFM\tuptime"),
    ]) {
      expect(() => parseReport(output, "macos"), output).toThrow(ReportError);
    }
    expect(() => parseReport(MAC, "windows")).toThrow("doesn't match");
  });
});
