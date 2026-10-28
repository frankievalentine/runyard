import { expect, test } from "vite-plus/test";
import {
  canHostRunners,
  parseTailnetStatus,
  peerAddress,
  type TailnetSnapshot,
} from "../../src/index.ts";

const STATUS = JSON.stringify({
  BackendState: "Running",
  Self: { ID: "nSelf", HostName: "dev-laptop", OS: "macOS", Online: true },
  CurrentTailnet: { Name: "example.github" },
  Peer: {
    "nodekey:a": {
      ID: "nMini",
      HostName: "mac-mini",
      DNSName: "mac-mini.tail1.ts.net.",
      OS: "macOS",
      TailscaleIPs: ["100.64.0.2", "fd7a:115c:a1e0::2"],
      Online: true,
      LastSeen: "0001-01-01T00:00:00Z",
    },
    "nodekey:b": {
      ID: "nBox",
      HostName: "linux-box",
      DNSName: "linux-box.tail1.ts.net.",
      OS: "linux",
      TailscaleIPs: ["100.64.0.3"],
      Online: false,
      LastSeen: "2026-10-02T08:00:00Z",
      Tags: ["tag:runner"],
      sshHostKeys: ["ssh-ed25519 AAAA"],
    },
    "nodekey:c": {
      ID: "nPhone",
      HostName: "phone",
      OS: "iOS",
      TailscaleIPs: ["100.64.0.4"],
      Online: true,
    },
  },
});

test("parses peers, trimming DNS names and ignoring never-seen timestamps", () => {
  const snapshot = parseTailnetStatus(STATUS) as TailnetSnapshot;
  expect(snapshot.selfNodeId).toBe("nSelf");
  expect(snapshot.tailnetName).toBe("example.github");
  const [box, mini, phone] = snapshot.peers;
  expect(mini).toMatchObject({
    nodeId: "nMini",
    dnsName: "mac-mini.tail1.ts.net",
    lastSeen: null,
    online: true,
  });
  expect(box).toMatchObject({
    online: false,
    lastSeen: Date.parse("2026-10-02T08:00:00Z"),
    tags: ["tag:runner"],
  });
  expect(box?.sshHostKeys).toHaveLength(1);
  expect(canHostRunners(box!)).toBe(true);
  expect(canHostRunners(phone!)).toBe(false);
  expect(peerAddress(phone!)).toBe("100.64.0.4");
});

test("reports a disconnected or unreadable tailnet as an error", () => {
  expect(parseTailnetStatus(JSON.stringify({ BackendState: "NeedsLogin" }))).toBeInstanceOf(Error);
  expect(parseTailnetStatus("not json")).toBeInstanceOf(Error);
});
