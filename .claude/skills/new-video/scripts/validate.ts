// validate: what davidup's validator says about a project's composition (the precompiled form, as render
// sees it), plus library pins that no shelf holds. Exit 1 on an error. Used by `nv build`.
import { openComposition } from "./lib/comp.ts";

const dir = process.argv[2] ?? ".";
try {
  const o = await openComposition(dir);
  const c = o.comp;
  const tw = c.tweens.length, items = Object.keys(c.items).length;
  for (const e of o.errors) process.stdout.write(`error    ${e.code} ${e.path ?? ""}: ${e.message}\n`);
  for (const w of o.warnings) process.stdout.write(`warning  ${w.code} ${w.path ?? ""}: ${String(w.message).slice(0, 220)}\n`);
  process.stdout.write(`${o.errors.length ? "INVALID" : "valid"}: ${c.composition.width}x${c.composition.height} ${c.composition.duration}s at ${c.composition.fps} fps; `
    + `${items} items, ${tw} tweens after precompile, ${c.assets.length} assets, ${(c.audio ?? []).length} audio tracks, ${o.markers.length} markers; `
    + `${o.errors.length} errors, ${o.warnings.length} warnings\n`);
  process.exit(o.errors.length ? 1 : 0);
} catch (e: any) {
  process.stdout.write(`INVALID: ${e.message}\n`);
  process.exit(1);
}
