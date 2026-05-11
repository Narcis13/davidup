/**
 * Davidup ball-showcase — 60-second clip, Node MP4 path.
 *
 *   bun run examples/ball-showcase-60s/render.ts
 *
 * Compiles `composition.json` (which $refs 5 scene files in `./scenes/` and
 * one snippet in `./snippets/`), validates the post-precompile canonical
 * output, prints a quick stats line, writes a preview PNG at t=30s, then
 * renders the full clip to `output/ball-showcase-60s.mp4`.
 *
 * `renderToFile` would call `precompile()` internally, but we run it
 * up-front here so the patched asset paths land in the canonical output
 * before either the validator or the renderer touches the data.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { precompile } from "../../src/compose/index.js";
import { renderToFile } from "../../src/drivers/node/index.js";
import { renderPreviewFrame } from "../../src/mcp/render.js";
import { validate } from "../../src/schema/index.js";
import type { Composition } from "../../src/schema/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, "composition.json");
const OUTPUT_DIR = resolve(HERE, "output");
const PREVIEW_PNG = join(OUTPUT_DIR, "ball-showcase-60s.frame-30s.png");
const VIDEO_MP4 = join(OUTPUT_DIR, "ball-showcase-60s.mp4");

// Asset src strings in the JSON are authored as portable relative paths
// ("../fonts/...", "../ball.png"). skia-canvas resolves them against
// process.cwd, which is fragile, so we rewrite each asset src to an absolute
// path keyed by id after precompile.
const ASSET_PATHS: Record<string, string> = {
  "font-display": resolve(HERE, "..", "fonts", "BebasNeue-Regular.ttf"),
  "font-mono":    resolve(HERE, "..", "fonts", "JetBrainsMono-Bold.ttf"),
  "ball":         resolve(HERE, "..", "ball.png"),
};

async function main(): Promise<void> {
  const raw = await readFile(SOURCE, "utf8");
  const authored = JSON.parse(raw) as unknown;

  const compiled = (await precompile(authored, { sourcePath: SOURCE })) as Composition;

  for (const asset of compiled.assets) {
    const abs = ASSET_PATHS[asset.id];
    if (!abs) throw new Error(`[davidup] no path mapping for asset "${asset.id}"`);
    asset.src = abs;
  }

  const result = validate(compiled);
  if (!result.valid) {
    console.error("[davidup] validation failed:");
    for (const e of result.errors) console.error(`  [${e.code}] ${e.message}`);
    process.exit(1);
  }

  const itemCount = Object.keys(compiled.items).length;
  console.log(
    `[davidup] precompile + validate ok: ${itemCount} items, ` +
      `${compiled.tweens.length} tweens (5 scenes + templates + behaviors lowered), ` +
      `${compiled.assets.length} assets, ` +
      `${compiled.composition.duration}s @ ${compiled.composition.fps}fps`,
  );
  if (result.warnings.length > 0) {
    for (const w of result.warnings) console.log(`  ⚠ [${w.code}] ${w.message}`);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log(`[davidup] preview frame at t=30.0s → ${PREVIEW_PNG}`);
  const preview = await renderPreviewFrame(compiled, 30.0, { format: "png" });
  await writeFile(PREVIEW_PNG, Buffer.from(preview.image, "base64"));

  const ffmpegPath = await resolveFfmpegPath();
  console.log(`[davidup] rendering MP4 → ${VIDEO_MP4}`);
  const startedAt = performance.now();
  const out = await renderToFile(compiled, VIDEO_MP4, {
    codec: "libx264",
    crf: 20,
    preset: "medium",
    movflagsFaststart: true,
    ...(ffmpegPath ? { ffmpegPath } : {}),
  });
  const wallMs = performance.now() - startedAt;
  const size = await stat(VIDEO_MP4).then((s) => s.size).catch(() => 0);
  if (size === 0) {
    console.error(`[davidup] MP4 missing or empty — check your local ffmpeg.`);
    process.exit(2);
  }
  console.log(
    `[davidup] done. ${out.frameCount} frames in ${wallMs.toFixed(0)}ms wall ` +
      `(${(out.frameCount / (wallMs / 1000)).toFixed(1)} fps), ${(size / 1_048_576).toFixed(2)}MB`,
  );
}

async function resolveFfmpegPath(): Promise<string | undefined> {
  try {
    const mod = (await import("ffmpeg-static")) as { default?: string | null };
    return mod.default ?? undefined;
  } catch {
    return undefined;
  }
}

main().catch((err) => {
  console.error("[davidup] fatal:", err);
  process.exit(1);
});
