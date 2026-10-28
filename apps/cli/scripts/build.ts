/** Compiles dist/runyard for this machine. */
import { $ } from "bun";
import { join } from "node:path";
import { root, writeEntry } from "./entry.ts";

const { entry, files } = await writeEntry();
await $`bun build --compile --minify --sourcemap ${entry} --outfile ${join(root, "dist", "runyard")}`.cwd(
  root,
);
console.log(`Embedded ${files} dashboard files.`);
