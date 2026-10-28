/**
 * Cross-compiles runyard for every published platform into dist/release, with
 * SHA256SUMS beside the binaries. Nothing is uploaded: the install scripts take
 * the base URL these files end up at.
 */
import { $ } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { root, writeEntry } from "./entry.ts";

/** Bun's compile target, and the name the install scripts ask for. */
export const TARGETS = [
  { bun: "bun-darwin-arm64", name: "darwin-arm64" },
  { bun: "bun-linux-x64", name: "linux-x64" },
  { bun: "bun-linux-arm64", name: "linux-arm64" },
  { bun: "bun-windows-x64", name: "windows-x64" },
] as const;

const version = process.env.RUNYARD_VERSION ?? pkg.version;
const out = join(root, "dist", "release");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const { entry } = await writeEntry();

const sums: string[] = [];
for (const target of TARGETS) {
  const file = `runyard-${version}-${target.name}${target.name.startsWith("windows") ? ".exe" : ""}`;
  console.log(`Building ${file}`);
  await $`bun build --compile --minify --target=${target.bun} ${entry} --outfile ${join(out, file)}`
    .cwd(root)
    .quiet();
  const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(join(out, file)).arrayBuffer());
  sums.push(`${hash.digest("hex")}  ${file}`);
}
await Bun.write(join(out, "SHA256SUMS"), `${sums.join("\n")}\n`);
await Bun.write(join(out, "VERSION"), `${version}\n`);
// The installers ship beside the binaries, so the directory is a complete release.
for (const script of ["install.sh", "install.ps1"]) {
  await Bun.write(join(out, script), Bun.file(join(root, "../../install", script)));
}
console.log(`Release ${version} in ${out}`);
