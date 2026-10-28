import { describe, expect, test } from "bun:test";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_FINGERPRINT, FIXTURE_KEY } from "./key-fixture.ts";
import { ensureRunyardKey, parsePublicKey, runyardPublicKey, runyardSshPaths } from "./keys.ts";
import { scriptCommand } from "./ssh.ts";

describe("Runyard's SSH key", () => {
  test("fingerprints match ssh-keygen's, and anything else isn't a key", () => {
    expect(parsePublicKey(FIXTURE_KEY)?.fingerprint).toBe(FIXTURE_FINGERPRINT);
    expect(
      parsePublicKey(
        "ssh-rsa AAAAC3NzaC1lZDI1NTE5AAAAIEhWT6AYd6Wo9Z9uMu9PpNogMM0rdjDjyJ0bWkoJkn2W",
      ),
    ).toBeNull();
    expect(parsePublicKey("not a key")).toBeNull();
    expect(parsePublicKey("ssh-ed25519 $(reboot)")).toBeNull();
  });

  test("is created once with ssh-keygen, private and beside an empty known_hosts", async () => {
    const paths = runyardSshPaths(await mkdtemp(join(tmpdir(), "runyard-keys-")));
    const calls: (readonly string[])[] = [];
    const run = async (argv: readonly string[]) => {
      calls.push(argv);
      await Bun.write(argv.at(-1)!, "private");
      await Bun.write(`${argv.at(-1)}.pub`, `${FIXTURE_KEY}\n`);
      return { code: 0, stdout: "", stderr: "" };
    };
    expect(await ensureRunyardKey(run, "/usr/bin/ssh-keygen", paths)).toBeNull();
    expect(await ensureRunyardKey(run, "/usr/bin/ssh-keygen", paths)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("ed25519");
    expect((await stat(paths.identity)).mode & 0o777).toBe(0o600);
    expect((await stat(paths.dir)).mode & 0o777).toBe(0o700);
    expect(await Bun.file(paths.knownHosts).text()).toBe("");
    expect(await runyardPublicKey(paths)).toMatchObject({
      fingerprint: FIXTURE_FINGERPRINT,
      line: FIXTURE_KEY,
    });
  });

  test("a failed ssh-keygen is reported, not thrown", async () => {
    const paths = runyardSshPaths(await mkdtemp(join(tmpdir(), "runyard-keys-")));
    const error = await ensureRunyardKey(
      async () => ({ code: 127, stdout: "", stderr: "not found" }),
      "ssh-keygen",
      paths,
    );
    expect(error).toContain("not found");
  });

  test("OpenSSH offers it and checks Runyard's known_hosts with the user's", () => {
    const { argv } = scriptCommand(
      {
        ssh: "/usr/bin/ssh",
        tailscale: "tailscale",
        identity: "/data dir/ssh/id_ed25519",
        knownHosts: "/data dir/ssh/known_hosts",
      },
      { sshTarget: "ci@box", transport: "openssh" },
      false,
      "true",
    );
    expect(argv).toContain("/data dir/ssh/id_ed25519");
    expect(argv).toContain(
      'UserKnownHostsFile="/data dir/ssh/known_hosts" ~/.ssh/known_hosts ~/.ssh/known_hosts2',
    );
    expect(argv.indexOf("--")).toBe(argv.length - 3);
  });
});
