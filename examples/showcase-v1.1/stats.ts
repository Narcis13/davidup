// Prints the on-screen stats line for the reveal: the authored file's size and
// what it compiles to. Used by render.sh (SHOWCASE_STATS).
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { precompile } from "../../src/compose/index.js";
import { validateComposition } from "../../src/schema/index.js";

const sourcePath = resolve(process.argv[2] ?? "composition.json");
const text = await readFile(sourcePath, "utf8");
const compiled = (await precompile(JSON.parse(text), {
  sourcePath,
  readFile: (p: string) => readFile(p, "utf8"),
})) as { items: Record<string, unknown>; tweens: unknown[] };
const v = validateComposition(compiled as never);
if (!v.valid) {
  console.error(JSON.stringify(v.errors, null, 1));
  process.exit(1);
}
const n = (x: number) => x.toLocaleString("en-US");
const kb = Math.round(text.length / 1024);
console.log(
  [
    `→ ${kb} KB authored, compiled to`,
    `   ${n(Object.keys(compiled.items).length)} items · ${n(compiled.tweens.length)} tweens`,
    `→ 900 frames, deterministic`,
    `→ written by an AI agent`,
  ].join("\n"),
);
