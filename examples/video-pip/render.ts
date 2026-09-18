/**
 * Davidup — picture-in-picture sample (v0.2 S10).
 *
 *   bun run examples/video-pip/render.ts
 *
 * Renders composition.ts (a looping full-frame background clip + a smaller
 * inset clip in a white frame, top-right) to output/video-pip.mp4 via
 * skia-canvas + ffmpeg. See composition.ts for the composition itself.
 */

import { mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validate } from "../../src/schema/index.js";
import { renderToFile } from "../../src/drivers/node/index.js";
import { buildVideoPipComposition } from "./composition.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(HERE, "output");
const VIDEO_MP4 = join(OUTPUT_DIR, "video-pip.mp4");

async function main(): Promise<void> {
  const comp = buildVideoPipComposition();

  const result = validate(comp);
  if (!result.valid) {
    console.error("[davidup] validation failed:");
    for (const e of result.errors) console.error(`  [${e.code}] ${e.message}`);
    process.exit(1);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  const ffmpegPath = await resolveFfmpegPath();
  console.log(`[davidup] rendering MP4 → ${VIDEO_MP4}`);
  const startedAt = performance.now();
  const out = await renderToFile(comp, VIDEO_MP4, {
    codec: "libx264",
    crf: 20,
    preset: "medium",
    movflagsFaststart: true,
    ...(ffmpegPath ? { ffmpegPath } : {}),
  });
  const wallMs = performance.now() - startedAt;
  const size = await stat(VIDEO_MP4).then((s) => s.size).catch(() => 0);
  if (size === 0) {
    console.error("[davidup] MP4 missing or empty — check your local ffmpeg.");
    process.exit(2);
  }
  console.log(
    `[davidup] done. ${out.frameCount} frames in ${wallMs.toFixed(0)}ms wall, ` +
      `${(size / 1024).toFixed(1)}KB`,
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
