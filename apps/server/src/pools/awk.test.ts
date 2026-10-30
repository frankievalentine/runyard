import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Names awk reserves: built-in functions and keywords, POSIX's and gawk's.
 * macOS's awk lets a script use some of them as variables, but Debian's mawk
 * refuses (`-v log=…` once broke Record jobs there), and the tests here run
 * macOS's awk only.
 */
const RESERVED = new Set([
  "BEGIN",
  "END",
  "function",
  "func",
  "if",
  "else",
  "while",
  "for",
  "do",
  "break",
  "continue",
  "next",
  "nextfile",
  "exit",
  "return",
  "delete",
  "in",
  "getline",
  "print",
  "printf",
  "length",
  "substr",
  "index",
  "split",
  "sub",
  "gsub",
  "match",
  "sprintf",
  "sin",
  "cos",
  "atan2",
  "exp",
  "log",
  "sqrt",
  "int",
  "rand",
  "srand",
  "tolower",
  "toupper",
  "system",
  "close",
  "fflush",
  "and",
  "or",
  "xor",
  "compl",
  "lshift",
  "rshift",
  "strftime",
  "systime",
  "mktime",
  "gensub",
  "asort",
  "asorti",
  "patsplit",
  "isarray",
  "typeof",
]);

const SCRIPTS = join(import.meta.dir, "../../scripts");

/** Each awk call in a script: its `-v` names and its single-quoted program. */
function awkCalls(text: string): { vars: string[]; program: string }[] {
  return [...text.matchAll(/\bawk\b([^'\n]*)'([^']*)'/g)].map((m) => ({
    vars: [...m[1]!.matchAll(/-v\s+([A-Za-z_]\w*)=/g)].map((v) => v[1]!),
    program: m[2]!,
  }));
}

/** Variables a program assigns or splits into. */
function assigned(program: string): string[] {
  const names = [...program.matchAll(/(?<![\w$])([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*=(?!=)/g)].map(
    (m) => m[1]!,
  );
  const arrays = [...program.matchAll(/split\([^,]+,\s*([A-Za-z_]\w*)/g)].map((m) => m[1]!);
  return [...names, ...arrays];
}

describe("awk programs in Runyard's scripts", () => {
  test("name no variable after an awk built-in", async () => {
    const files = (await readdir(SCRIPTS)).filter((f) => f.endsWith(".sh"));
    const clashes: string[] = [];
    let programs = 0;
    for (const file of files) {
      for (const call of awkCalls(await Bun.file(join(SCRIPTS, file)).text())) {
        programs++;
        for (const name of [...call.vars, ...assigned(call.program)])
          if (RESERVED.has(name)) clashes.push(`${file}: ${name}`);
      }
    }
    expect(programs).toBeGreaterThan(5);
    expect(clashes).toEqual([]);
  });

  test("catch the clash that broke Record jobs", () => {
    const [call] = awkCalls(`awk -v log="$f" '{ print } /x/ { print "a" log }' u`);
    expect(call!.vars).toEqual(["log"]);
    expect(assigned('t = $0; split(s, length, " "); x[1] = 2; if (a == b) {}')).toEqual([
      "t",
      "x",
      "length",
    ]);
  });
});
