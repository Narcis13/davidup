/**
 * Davidup — comprehensive 20-second feature demo, split-file edition.
 * ==========================================================================
 *
 * Same composition the canonical `comprehensive.ts` script renders, but the
 * JSON is split across multiple files (`comprehensive-split/`) using v0.2's
 * `$ref` import primitive (COMPOSITION_PRIMITIVES.md §5):
 *
 *   comprehensive-split/
 *     comprehensive.json     ← entry; $ref to meta + 6 acts
 *     meta.json              ← composition + assets + layers + items
 *     acts/act-1-title.json  ← tween bundle for the title act
 *     acts/act-2-shapes.json
 *     acts/act-3-ball-bounce.json
 *     acts/act-4-orbit.json
 *     acts/act-5-glow.json
 *     acts/act-6-outro.json
 *
 * The renderer's only special handling: pass `sourcePath` so the precompile
 * pass knows where to anchor relative refs. Everything else — validation,
 * frame walk, ffmpeg pipe — is identical to the canonical path.
 *
 * Run:  bun run examples/comprehensive-split.ts
 * Out:  examples/output/comprehensive-split.mp4
 */

import { mkdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { precompile } from "../src/compose/index.js";
import { validate } from "../src/schema/index.js";
import { renderToFile } from "../src/drivers/node/index.js";
import { EASING_NAMES, type EasingName } from "../src/easings/names.js";
import type { Composition } from "../src/schema/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(HERE, "output");
const VIDEO_PATH = join(OUTPUT_DIR, "comprehensive-split.mp4");
const SPLIT_DIR = resolve(HERE, "comprehensive-split");
const ENTRY_JSON = join(SPLIT_DIR, "comprehensive.json");

const ASSET_PATHS: Record<string, string> = {
  ball: resolve(HERE, "ball.png"),
  "font-display": resolve(HERE, "fonts", "BebasNeue-Regular.ttf"),
  "font-mono": resolve(HERE, "fonts", "JetBrainsMono-Bold.ttf"),
};

async function main(): Promise<void> {
  for (const path of Object.values(ASSET_PATHS)) {
    if (!existsSync(path)) {
      console.error(`[davidup] missing asset: ${path}`);
      process.exit(1);
    }
  }

  // 1) Load entry + precompile (resolves all $ref imports).
  console.log(`[davidup] loading split composition from ${ENTRY_JSON}`);
  const entryRaw = await readFile(ENTRY_JSON, "utf8");
  const entryJson = JSON.parse(entryRaw) as unknown;
  const compiled = (await precompile(entryJson, { sourcePath: ENTRY_JSON })) as Composition;

  // The split composition's asset.src fields are portable relative paths
  // ("./ball.png") that meta.json declares. Patch them to absolute filesystem
  // paths skia-canvas / FontLibrary can open — same trick comprehensive.ts uses.
  for (const asset of compiled.assets) {
    const abs = ASSET_PATHS[asset.id];
    if (!abs) {
      console.error(`[davidup] no filesystem mapping for asset id "${asset.id}"`);
      process.exit(1);
    }
    asset.src = abs;
  }

  const usedEasings = new Set<EasingName>(
    compiled.tweens
      .map((t) => t.easing)
      .filter((e): e is EasingName => e !== undefined),
  );
  const missingEasings = EASING_NAMES.filter((e) => !usedEasings.has(e));
  if (missingEasings.length > 0) {
    console.error(`[davidup] easing coverage incomplete — missing: ${missingEasings.join(", ")}`);
    process.exit(1);
  }
  console.log(
    `[davidup] using all ${EASING_NAMES.length} easings across ${compiled.tweens.length} tweens`,
  );

  // 2) Validate the post-compile JSON.
  console.log("[davidup] validating compiled composition...");
  const result = validate(compiled);
  if (!result.valid) {
    console.error("validation failed:");
    for (const err of result.errors) {
      console.error(`  [${err.code}] ${err.message}${err.path ? ` (${err.path})` : ""}`);
    }
    process.exit(1);
  }
  for (const w of result.warnings) {
    console.warn(`  warning [${w.code}] ${w.message}`);
  }
  console.log(
    `[davidup] valid: ${Object.keys(compiled.items).length} items, ` +
      `${compiled.layers.length} layers, ${compiled.tweens.length} tweens, ` +
      `${compiled.assets.length} assets`,
  );

  // 3) Render. We pass `sourcePath` for completeness — precompile() inside
  //    renderToFile is a no-op since `compiled` no longer contains $refs, but
  //    keeping it makes the call site honest about where the JSON came from.
  await mkdir(OUTPUT_DIR, { recursive: true });
  const ffmpegPath = await resolveFfmpegPath();
  if (ffmpegPath) console.log(`[davidup] using ffmpeg at ${ffmpegPath}`);
  console.log(
    `[davidup] rendering ${compiled.composition.duration}s @ ${compiled.composition.fps}fps → ${VIDEO_PATH}`,
  );

  const startedAt = performance.now();
  const out = await renderToFile(compiled, VIDEO_PATH, {
    codec: "libx264",
    crf: 20,
    preset: "medium",
    movflagsFaststart: true,
    sourcePath: ENTRY_JSON,
    ...(ffmpegPath ? { ffmpegPath } : {}),
  });
  const wallMs = performance.now() - startedAt;
  console.log(
    `[davidup] ${out.frameCount} frames in ${out.durationMs.toFixed(0)}ms ` +
      `(wall ${wallMs.toFixed(0)}ms; ${(out.frameCount / (out.durationMs / 1000)).toFixed(1)} fps)`,
  );

  const fileSize = await stat(VIDEO_PATH).then((s) => s.size).catch(() => 0);
  if (fileSize === 0) {
    console.error(
      `[davidup] WARNING: ffmpeg reported success but ${VIDEO_PATH} is missing or empty.`,
    );
    process.exit(2);
  }
  console.log(`[davidup] done — ${humanBytes(fileSize)}`);
}

async function resolveFfmpegPath(): Promise<string | undefined> {
  try {
    const mod = (await import("ffmpeg-static")) as { default?: string | null };
    return mod.default ?? undefined;
  } catch {
    return undefined;
  }
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

main().catch((err) => {
  console.error("[davidup] fatal:", err);
  process.exit(1);
});
