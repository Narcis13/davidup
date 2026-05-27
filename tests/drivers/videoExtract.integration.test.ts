// Real-ffmpeg integration for the video pre-extract pipeline (v0.2 §S7
// verification): one video, two consecutive runs — frames appear in the cache,
// the second run is a pure cache hit and is >5x faster than the first.
//
// Uses the bundled `ffmpeg-static` binary and the committed `small.mp4`
// fixture (320x240 h264, 1s @ 30fps). Cache lives in a throwaway temp dir.

import { fileURLToPath } from "node:url";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
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
