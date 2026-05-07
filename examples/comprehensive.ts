/**
 * MotionForge — comprehensive 20-second feature demo (Node renderer).
 * ===================================================================
 *
 * Exercises every v0.1 feature in one composition: every item type, every
 * easing in EASING_NAMES, multiple layers including a `screen` blend layer,
 * a group transform, color tweens, anchor tweens, and tweenable size /
 * stroke / cornerRadius / fontSize props.
 *
 * The composition itself lives in `comprehensive-composition.ts` so the
 * browser preview demo (`examples/comprehensive-browser/`) can build the
 * exact same scene with browser-served asset URLs. Only the asset paths
 * differ between hosts.
 *
 * Run:  bun run examples/comprehensive.ts
 * Out:  examples/output/comprehensive.mp4
 */

import { mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validate } from "../src/schema/index.js";
import { renderToFile } from "../src/drivers/node/index.js";
import { EASING_NAMES } from "../src/easings/names.js";
import { buildCompositionAndCoverage } from "./comprehensive-composition.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(HERE, "output");
const VIDEO_PATH = join(OUTPUT_DIR, "comprehensive.mp4");
const BALL_PNG_PATH = resolve(HERE, "ball.png");
const FONT_DISPLAY_PATH = resolve(HERE, "fonts", "BebasNeue-Regular.ttf");
const FONT_MONO_PATH = resolve(HERE, "fonts", "JetBrainsMono-Bold.ttf");

async function main(): Promise<void> {
  // 0) Pre-flight on assets. Fail fast if anything's missing on disk —
  //    skia-canvas's failure modes for missing files are unhelpful.
  for (const path of [BALL_PNG_PATH, FONT_DISPLAY_PATH, FONT_MONO_PATH]) {
    if (!existsSync(path)) {
      console.error(`[motionforge] missing asset: ${path}`);
      process.exit(1);
    }
  }

  const { composition, usedEasings } = buildCompositionAndCoverage({
    ball: BALL_PNG_PATH,
    fontDisplay: FONT_DISPLAY_PATH,
    fontMono: FONT_MONO_PATH,
  });

  const missingEasings = EASING_NAMES.filter((e) => !usedEasings.has(e));
  if (missingEasings.length > 0) {
    console.error(`[motionforge] easing coverage incomplete — missing: ${missingEasings.join(", ")}`);
    process.exit(1);
  }
  console.log(
    `[motionforge] using all ${EASING_NAMES.length} easings across ${composition.tweens.length} tweens`,
  );

  // 1) Validate.
  console.log("[motionforge] validating composition...");
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
    `[motionforge] valid: ${Object.keys(composition.items).length} items, ` +
      `${composition.layers.length} layers, ${composition.tweens.length} tweens, ` +
      `${composition.assets.length} assets`,
  );

  // 2) Render.
  await mkdir(OUTPUT_DIR, { recursive: true });
  const ffmpegPath = await resolveFfmpegPath();
  if (ffmpegPath) console.log(`[motionforge] using ffmpeg at ${ffmpegPath}`);
  console.log(
    `[motionforge] rendering ${composition.composition.duration}s @ ${composition.composition.fps}fps → ${VIDEO_PATH}`,
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
    `[motionforge] ${out.frameCount} frames in ${out.durationMs.toFixed(0)}ms ` +
      `(wall ${wallMs.toFixed(0)}ms; ${(out.frameCount / (out.durationMs / 1000)).toFixed(1)} fps)`,
  );

  const fileSize = await stat(VIDEO_PATH).then((s) => s.size).catch(() => 0);
  if (fileSize === 0) {
    console.error(
      `[motionforge] WARNING: ffmpeg reported success but ${VIDEO_PATH} is missing or empty.`,
    );
    process.exit(2);
  }
  console.log(`[motionforge] done — ${humanBytes(fileSize)}`);
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
  console.error("[motionforge] fatal:", err);
  process.exit(1);
});
