// Real-ffmpeg integration for the video pre-extract pipeline (v0.2 §S7
// verification): one video, two consecutive runs — frames appear in the cache,
// the second run is a pure cache hit and is >5x faster than the first.
//
// Uses the bundled `ffmpeg-static` binary and the committed `small.mp4`
// fixture (320x240 h264, 1s @ 30fps). Cache lives in a throwaway temp dir.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  preExtractVideoFrames,
  renderToFile,
} from "../../src/drivers/node/index.js";
import type { Composition } from "../../src/schema/types.js";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "video",
  "small.mp4",
);

let ffmpegPath: string | undefined;
let cacheRoot: string;

beforeAll(async () => {
  const ffmpegStatic = (await import("ffmpeg-static")).default as unknown as
    | string
    | null;
  ffmpegPath = ffmpegStatic ?? undefined;
  cacheRoot = mkdtempSync(join(tmpdir(), "davidup-s7-cache-"));
});

afterAll(() => {
  rmSync(cacheRoot, { recursive: true, force: true });
});

function oneVideoComp(): Composition {
  return {
    version: "0.1",
    composition: {
      width: 640,
      height: 360,
      fps: 30,
      duration: 1,
      background: "#000000",
    },
    assets: [
      {
        id: "clip",
        type: "video",
        src: FIXTURE,
        duration: 1,
        width: 320,
        height: 240,
        fps: 30,
      },
    ],
    layers: [{ id: "l", z: 0, opacity: 1, blendMode: "normal", items: ["v"] }],
    items: {
      v: {
        type: "video",
        asset: "clip",
        width: 320,
        height: 240,
        start: 0,
        trimIn: 0,
        trimOut: 1,
        fit: "contain",
        loop: false,
        transform: {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
    },
    tweens: [],
  };
}

const pngCount = (dir: string) =>
  readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".png")).length;

describe("preExtractVideoFrames — real ffmpeg, consecutive runs", () => {
  it("extracts to cache, then the second run hits cache and is >5x faster", async () => {
    const comp = oneVideoComp();

    const t0 = performance.now();
    const first = await preExtractVideoFrames(comp, { cacheRoot, ffmpegPath });
    const firstMs = performance.now() - t0;

    expect(first.entries.size).toBe(1);
    const entry1 = [...first.entries.values()][0]!;
    expect(entry1.cached).toBe(false);
    expect(entry1.frameCount).toBeGreaterThan(0);
    // Frames really landed on disk in the published cache dir.
    expect(pngCount(entry1.dir)).toBe(entry1.frameCount);
    expect(statSync(join(entry1.dir, "meta.json")).size).toBeGreaterThan(0);

    const t1 = performance.now();
    const second = await preExtractVideoFrames(comp, { cacheRoot, ffmpegPath });
    const secondMs = performance.now() - t1;

    const entry2 = [...second.entries.values()][0]!;
    expect(entry2.cached).toBe(true);
    expect(entry2.frameCount).toBe(entry1.frameCount);
    expect(entry2.hash).toBe(entry1.hash);

    // The §S7 acceptance bar: the cached run must be >5x faster than the
    // extracting run. (Hard correctness guarantee is the `cached` flag above;
    // this asserts the performance promise the cache exists to deliver.)
    expect(firstMs).toBeGreaterThan(secondMs * 5);
  }, 30_000);

  it("renderToFile populates the frame cache as a side effect", async () => {
    const comp = oneVideoComp();
    // Keep the encode tiny — the point is that running the render leaves a
    // populated cache entry (drawing the frames is §S8).
    comp.composition.duration = 0.1; // ~3 encoded frames @ 30fps

    const workDir = mkdtempSync(join(tmpdir(), "davidup-s7-render-"));
    const renderCacheRoot = mkdtempSync(join(tmpdir(), "davidup-s7-rcache-"));
    const outPath = join(workDir, "out.mp4");
    try {
      await renderToFile(comp, outPath, {
        ffmpegPath,
        preset: "ultrafast",
        preExtract: { cacheRoot: renderCacheRoot },
      });
      const entries = readdirSync(renderCacheRoot).filter(
        (n) => !n.startsWith(".tmp-"),
      );
      expect(entries.length).toBe(1);
      expect(pngCount(join(renderCacheRoot, entries[0]!))).toBeGreaterThan(0);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
      rmSync(renderCacheRoot, { recursive: true, force: true });
    }
  }, 30_000);
});

// B-1 repro: 320×240 `small.mp4` in a 640×320 box. Before the fix every `fit`
// produced a byte-identical, stretched MP4 because frames were extracted at
// the box size.
describe("video fit — real ffmpeg (B-1)", () => {
  const FITS = ["contain", "cover", "fill", "none"] as const;
  // Pure blue: far from anything in the testsrc2 fixture's letterbox-band area
  // after a yuv420p round-trip.
  const BG = [0, 0, 255] as const;

  function fitComp(fit: (typeof FITS)[number]): Composition {
    const comp = oneVideoComp();
    comp.composition = { width: 640, height: 320, fps: 30, duration: 0.1, background: "#0000ff" };
    const v = comp.items.v as Extract<Composition["items"][string], { type: "video" }>;
    v.width = 640;
    v.height = 320;
    v.fit = fit;
    return comp;
  }

  // Decode the first frame of an MP4 to raw rgb24.
  function firstFrameRgb(file: string): Buffer {
    return execFileSync(
      ffmpegPath ?? "ffmpeg",
      ["-v", "error", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
      { maxBuffer: 64 * 1024 * 1024 },
    );
  }

  // True when every probe in the left letterbox band (contain: x < ~106) is
  // within tolerance of the background colour.
  function leftBandIsBackground(rgb: Buffer): boolean {
    for (const x of [8, 40, 90]) {
      for (const y of [20, 160, 300]) {
        const i = (y * 640 + x) * 3;
        const dist =
          Math.abs(rgb[i]! - BG[0]) + Math.abs(rgb[i + 1]! - BG[1]) + Math.abs(rgb[i + 2]! - BG[2]);
        if (dist > 60) return false;
      }
    }
    return true;
  }

  it("renders four different files; contain letterboxes, cover fills", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "davidup-b1-"));
    const fitCache = mkdtempSync(join(tmpdir(), "davidup-b1-cache-"));
    try {
      const hashes = new Map<string, string>();
      const frames = new Map<string, Buffer>();
      for (const fit of FITS) {
        const out = join(workDir, `${fit}.mp4`);
        await renderToFile(fitComp(fit), out, {
          ffmpegPath,
          preset: "ultrafast",
          preExtract: { cacheRoot: fitCache },
        });
        hashes.set(fit, createHash("sha256").update(readFileSync(out)).digest("hex"));
        frames.set(fit, firstFrameRgb(out));
      }
      expect(new Set(hashes.values()).size).toBe(FITS.length);

      expect(leftBandIsBackground(frames.get("contain")!)).toBe(true);
      expect(leftBandIsBackground(frames.get("cover")!)).toBe(false);
      expect(leftBandIsBackground(frames.get("fill")!)).toBe(false);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
      rmSync(fitCache, { recursive: true, force: true });
    }
  }, 60_000);

  it("extracts at the source aspect, not the box", async () => {
    const fitCache = mkdtempSync(join(tmpdir(), "davidup-b1-dims-"));
    try {
      const result = await preExtractVideoFrames(fitComp("contain"), { cacheRoot: fitCache, ffmpegPath });
      const entry = [...result.entries.values()][0]!;
      // 320×240 is under the 640px cap → native size, 4:3 preserved.
      expect({ width: entry.width, height: entry.height }).toEqual({ width: 320, height: 240 });
    } finally {
      rmSync(fitCache, { recursive: true, force: true });
    }
  }, 30_000);
});
