// v1.1 S12 integration: a ranged render through real skia + the bundled ffmpeg.
//
//   1. `range` renders exactly ceil((to − from) × fps) frames (ffprobe
//      -count_frames), and the audio is the window's audio: a voiceover placed
//      at [0.5, 1.0) on the timeline is audible at the start of a render from
//      0.5 s and silent after it ends.
//   2. A PNG sequence of the same window writes that many real PNGs whose
//      first frame is painted at `from`, not at 0.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderToFile } from "../../src/drivers/node/index.js";
import type { Composition } from "../../src/schema/types.js";

const VOICEOVER = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "audio",
  "tone-mono.wav",
);

let ffmpegPath: string | undefined;
let ffprobePath: string | undefined;

beforeAll(async () => {
  ffmpegPath = ((await import("ffmpeg-static")).default as unknown as string | null) ?? undefined;
  ffprobePath = ((await import("ffprobe-static")).default as { path?: string })?.path;
});

// 2 s @ 12 fps. The box is invisible until 1 s, then fully opaque (a 1-frame
// step tween), so a frame's pixels say which side of 1 s it was painted at.
function rangeComposition(): Composition {
  return {
    version: "0.1",
    composition: { width: 32, height: 32, fps: 12, duration: 2, background: "#000000" },
    assets: [
      { id: "vo", type: "audio", src: VOICEOVER, duration: 0.5, sampleRate: 48000, channels: 1 },
    ],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["box"] }],
    items: {
      box: {
        type: "shape",
        kind: "rect",
        width: 32,
        height: 32,
        fillColor: "#ffffff",
        transform: {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 0,
        },
      },
    },
    tweens: [
      {
        id: "show",
        target: "box",
        property: "transform.opacity",
        from: 0,
        to: 1,
        start: 0.95,
        duration: 0.05,
      },
    ],
    audio: [{ id: "vo", asset: "vo", start: 0.5 }],
  };
}

function countVideoFrames(path: string): number {
  const r = spawnSync(
    ffprobePath!,
    [
      "-v", "error",
      "-count_frames",
      "-select_streams", "v:0",
      "-show_entries", "stream=nb_read_frames",
      "-of", "csv=p=0",
      path,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return Number(r.stdout.trim());
}

function meanVolumeDb(path: string, start: number, dur: number): number {
  const r = spawnSync(
    ffmpegPath!,
    ["-v", "info", "-ss", String(start), "-t", String(dur), "-i", path,
      "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const m = /mean_volume:\s*(-?inf|-?[\d.]+)\s*dB/i.exec(r.stderr);
  if (!m) throw new Error(`could not parse mean_volume from:\n${r.stderr}`);
  return /inf/i.test(m[1]!) ? -Infinity : Number(m[1]);
}

describe("renderToFile — time range + PNG sequence (v1.1 S12, integration)", () => {
  let workDir: string;
  let haveBins = false;
  const from = 0.5;
  const to = 1.5;
  const expectedFrames = Math.ceil((to - from) * 12); // 12

  beforeAll(() => {
    haveBins = ffmpegPath !== undefined && ffprobePath !== undefined && existsSync(VOICEOVER);
    if (haveBins) workDir = mkdtempSync(join(tmpdir(), "davidup-s12-int-"));
  });

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it("range render frame count = ceil((to − from) × fps), audio cut to the window", async () => {
    if (!haveBins) return;
    const out = join(workDir, "beat.mp4");
    const result = await renderToFile(rangeComposition(), out, {
      ffmpegPath,
      preset: "ultrafast",
      crf: 28,
      range: { from, to },
    });
    expect(result.frameCount).toBe(expectedFrames);
    expect(countVideoFrames(out)).toBe(expectedFrames);

    // Output 0–0.5 s is timeline 0.5–1.0 s (voiceover); output 0.6–0.9 s is
    // timeline 1.1–1.4 s (after it ended).
    expect(meanVolumeDb(out, 0.05, 0.3)).toBeGreaterThan(-50);
    expect(meanVolumeDb(out, 0.6, 0.3)).toBeLessThan(-60);
  }, 60_000);

  it("PNG sequence count matches and frame 1 is painted at `from`", async () => {
    if (!haveBins) return;
    const skia = (await import("skia-canvas")) as unknown as {
      Canvas: new (w: number, h: number) => {
        getContext(k: "2d"): {
          drawImage(img: unknown, x: number, y: number): void;
          getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
        };
      };
      loadImage(src: string): Promise<unknown>;
    };
    const brightness = async (file: string): Promise<number> => {
      const canvas = new skia.Canvas(32, 32);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(await skia.loadImage(file), 0, 0);
      return ctx.getImageData(16, 16, 1, 1).data[0]!;
    };

    const dir = join(workDir, "frames");
    const result = await renderToFile(rangeComposition(), join(dir, "%05d.png"), {
      ffmpegPath,
      range: { from: 1, to },
    });
    const files = readdirSync(dir).sort();
    expect(result.frameCount).toBe(Math.ceil((to - 1) * 12));
    expect(files).toHaveLength(result.frameCount);
    // Frame 1 is t = 1 s: the box is already showing.
    expect(await brightness(join(dir, files[0]!))).toBeGreaterThan(200);

    // Control: a window before the step shows black.
    const early = join(workDir, "early");
    await renderToFile(rangeComposition(), early, {
      format: "png-sequence",
      range: { from: 0.25, to: 0.5 },
    });
    const earlyFiles = readdirSync(early).sort();
    expect(earlyFiles).toHaveLength(3);
    expect(await brightness(join(early, earlyFiles[0]!))).toBeLessThan(10);
  }, 60_000);
});
