/**
 * Davidup — comprehensive 20-second feature demo (Node renderer).
 * ===================================================================
 *
 * The composition is the canonical JSON in `comprehensive-composition.json`
 * (per design-doc §3 — "the composition is data, not code"). The only thing
 * this script does on top of that JSON is:
 *
 *   1. Patch each asset's `src` from the JSON's portable relative path to
 *      an absolute filesystem path skia-canvas / FontLibrary can open.
 *   2. Validate, then render to MP4.
 *
 * The browser preview demo (`examples/comprehensive-browser/`) loads the
 * same JSON and patches `src` to dev-server URLs instead.
 *
 * Run:  bun run examples/comprehensive.ts
 * Out:  examples/output/comprehensive.mp4
 */

import { mkdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validate } from "../src/schema/index.js";
import { renderToFile } from "../src/drivers/node/index.js";
import { EASING_NAMES, type EasingName } from "../src/easings/names.js";
import type { Composition } from "../src/schema/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(HERE, "output");
const VIDEO_PATH = join(OUTPUT_DIR, "comprehensive.mp4");
const COMPOSITION_JSON = resolve(HERE, "comprehensive-composition.json");
const ASSET_PATHS: Record<string, string> = {
  ball: resolve(HERE, "ball.png"),
  "font-display": resolve(HERE, "fonts", "BebasNeue-Regular.ttf"),
  "font-mono": resolve(HERE, "fonts", "JetBrainsMono-Bold.ttf"),
};

async function main(): Promise<void> {
  // 0) Pre-flight on assets. Fail fast if anything's missing on disk —
  //    skia-canvas's failure modes for missing files are unhelpful.
  for (const path of Object.values(ASSET_PATHS)) {
    if (!existsSync(path)) {
      console.error(`[davidup] missing asset: ${path}`);
      process.exit(1);
    }
  }

  const composition = await loadComposition();

  const usedEasings = new Set<EasingName>(
    composition.tweens
      .map((t) => t.easing)
      .filter((e): e is EasingName => e !== undefined),
  );
  const missingEasings = EASING_NAMES.filter((e) => !usedEasings.has(e));
  if (missingEasings.length > 0) {
    console.error(`[davidup] easing coverage incomplete — missing: ${missingEasings.join(", ")}`);
    process.exit(1);
  }
  console.log(
    `[davidup] using all ${EASING_NAMES.length} easings across ${composition.tweens.length} tweens`,
  );

  // 1) Validate.
  console.log("[davidup] validating composition...");
  const result = validate(composition);
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
    `[davidup] valid: ${Object.keys(composition.items).length} items, ` +
      `${composition.layers.length} layers, ${composition.tweens.length} tweens, ` +
      `${composition.assets.length} assets`,
  );

  // 2) Render.
  await mkdir(OUTPUT_DIR, { recursive: true });
  const ffmpegPath = await resolveFfmpegPath();
  if (ffmpegPath) console.log(`[davidup] using ffmpeg at ${ffmpegPath}`);
  console.log(
    `[davidup] rendering ${composition.composition.duration}s @ ${composition.composition.fps}fps → ${VIDEO_PATH}`,
  );

  const startedAt = performance.now();
  const out = await renderToFile(composition, VIDEO_PATH, {
    codec: "libx264",
    crf: 20,
    preset: "medium",
    movflagsFaststart: true,
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

async function loadComposition(): Promise<Composition> {
  const text = await readFile(COMPOSITION_JSON, "utf8");
  const json = JSON.parse(text) as Composition;
  for (const asset of json.assets) {
    const abs = ASSET_PATHS[asset.id];
    if (!abs) {
      console.error(`[davidup] no filesystem mapping for asset id "${asset.id}"`);
      process.exit(1);
    }
    asset.src = abs;
  }
  return json;
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
