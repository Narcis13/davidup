// Renders the vertical showcase through the library API.
//
//   bun run examples/showcase-vertical/render.ts             # full: badge, Droste passes, final
//   bun run examples/showcase-vertical/render.ts --passes 3  # fewer recursion levels
//   bun run examples/showcase-vertical/render.ts --stills 1.2,4,27.5   # PNG frames only
//
// Why not `davidup render`: this film uses `global:` asset srcs (fonts and the
// profile picture from ~/.davidup/library) and an executable *user* behavior
// (`neonFlicker`). The CLI rewrites `global:` srcs as relative paths and has
// no way to register a user behavior, so the script drives
// precompile → validate → renderToFile itself.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { precompile, registerBehavior } from "../../src/compose/index.js";
import { renderToFile } from "../../src/drivers/node/index.js";
import { validateComposition } from "../../src/schema/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "output");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const PASSES = Number(flag("--passes") ?? 4);
const STILLS = flag("--stills");
const DROP2 = 24;

// An executable user behavior: a neon tube striking — N opacity flashes that
// settle on full, written as a `$repeat` tween body over the block's window.
registerBehavior({
  name: "neonFlicker",
  description: "Neon-tube strike: `flashes` hard opacity flickers settling on 1.",
  params: [{ name: "flashes", type: "number", default: 4 }],
  produces: "dynamic",
  tweens: [
    {
      $repeat: { count: "${params.flashes}", as: "i" },
      item: {
        suffix: "f${i}",
        property: "transform.opacity",
        from: "${0.1 + i * 0.12}",
        to: 1,
        start: "${$.start + i * $.duration / params.flashes}",
        duration: "${$.duration / params.flashes}",
        easing: { steps: 2 },
      },
    },
  ],
} as never);

type Comp = { items: Record<string, unknown>; tweens: unknown[]; assets: Array<{ src?: string }> };

async function compile(path: string): Promise<Comp> {
  const compiled = (await precompile(JSON.parse(readFileSync(path, "utf8")), {
    sourcePath: path,
  })) as unknown as Comp;
  const v = validateComposition(compiled as never);
  if (!v.valid) {
    console.error(JSON.stringify(v.errors, null, 1));
    process.exit(1);
  }
  for (const w of v.warnings ?? []) console.warn(`  warn ${w.code} ${w.path ?? ""}: ${w.message}`);
  // relative srcs resolve against the composition file; `scheme:` srcs
  // (global:, bundled:) are left to the asset loader
  for (const a of compiled.assets) {
    if (a.src && !isAbsolute(a.src) && !/^[a-z]+:/.test(a.src)) a.src = resolve(dirname(path), a.src);
  }
  return compiled;
}

async function render(path: string, out: string, opts: Record<string, unknown> = {}) {
  const comp = await compile(path);
  const t0 = performance.now();
  let last = 0;
  const r = await renderToFile(comp as never, out, {
    ...opts,
    onProgress: ({ frame, total }) => {
      if (frame === total || performance.now() - last > 2000) {
        last = performance.now();
        process.stdout.write(`\r  frame ${frame}/${total}`);
      }
    },
  });
  console.log(`\r  wrote ${out} (${r.frameCount} frames, ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}

const build = (...a: string[]) =>
  execFileSync("node", [join(HERE, "build.mjs"), ...a], { stdio: ["ignore", "ignore", "inherit"], env: process.env });

mkdirSync(OUT, { recursive: true });
build();

console.log("── alpha overlay → ProRes 4444");
await render(join(HERE, "alpha-badge.json"), join(OUT, "alpha-badge.mov"), { codec: "prores_ks" });

// the reveal's stats line: what the authored file compiles to
{
  const src = join(HERE, "composition.json");
  const text = readFileSync(src, "utf8");
  const c = await compile(src);
  const n = (x: number) => x.toLocaleString("en-US");
  process.env.SHOWCASE_STATS = [
    `${Math.round(text.length / 1024)} KB authored → compiled to`,
    `${n(Object.keys(c.items).length)} items · ${n(c.tweens.length)} tweens`,
    `900 frames · deterministic · written by an AI agent`,
  ].join("\n");
  console.log(process.env.SHOWCASE_STATS);
}

if (STILLS) {
  build();
  const dir = join(OUT, "stills");
  rmSync(dir, { recursive: true, force: true });
  for (const t of STILLS.split(",").map(Number)) {
    const sub = join(dir, `t${t.toFixed(2)}`);
    await render(join(HERE, "composition.json"), join(sub, "%03d.png"), {
      format: "png-sequence",
      range: { from: t, to: t + 1 / 30 },
    });
  }
  process.exit(0);
}

let prev = "../showcase-v1.1/assets/mandelbrot.mp4";
for (let k = 1; k <= PASSES; k++) {
  const out = join(OUT, "droste", `self-${k}.mp4`);
  mkdirSync(dirname(out), { recursive: true });
  console.log(`── Droste pass ${k}/${PASSES}`);
  build(prev, "droste-pass.json");
  await render(join(HERE, "droste-pass.json"), out, { range: { from: DROP2, to: 30 } });
  prev = `output/droste/self-${k}.mp4`;
}
rmSync(join(HERE, "droste-pass.json"), { force: true });

console.log("── final render");
build(prev);
await render(join(HERE, "composition.json"), join(OUT, "davidup-vertical-showcase.mp4"));
