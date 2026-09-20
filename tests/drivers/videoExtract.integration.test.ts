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
  probeVideo,
  probeVideoSync,
  renderToFile,
} from "../../src/drivers/node/index.js";
import type { VideoMetadata } from "../../src/drivers/node/index.js";
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

// B-7 repro: davidup exports an overlay with alpha, then uses its own export as
// a video item. ffmpeg's native vp9 decoder ignores WebM's alpha side channel,
// so the transparent area came back opaque black instead of the background.
// ProRes 4444 (alpha in the pixel format) always worked and is the control.
describe("video alpha round-trip — real ffmpeg (B-7)", () => {
  const W = 64;
  const H = 48;
  const BG = [0, 0, 255] as const; // pure blue, nowhere near the red patch
  const PATCH = "#ff0000";

  const listing = (flag: "-encoders" | "-decoders") =>
    execFileSync(ffmpegPath ?? "ffmpeg", ["-hide_banner", flag], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });

  /** An overlay to export: transparent everywhere but a centred red square. */
  function overlayComp(): Composition {
    return {
      version: "0.1",
      composition: { width: W, height: H, fps: 12, duration: 0.25, background: "transparent" },
      assets: [],
      layers: [{ id: "fg", z: 0, opacity: 1, blendMode: "normal", items: ["box"] }],
      items: {
        box: {
          type: "shape",
          kind: "rect",
          width: 20,
          height: 20,
          fillColor: PATCH,
          transform: {
            x: W / 2,
            y: H / 2,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            anchorX: 0.5,
            anchorY: 0.5,
            opacity: 1,
          },
        },
      },
      tweens: [],
    };
  }

  /** The same overlay played back as a full-frame video item over blue. */
  function consumerComp(src: string, meta: VideoMetadata): Composition {
    return {
      version: "0.1",
      composition: { width: W, height: H, fps: 12, duration: 0.09, background: "#0000ff" },
      assets: [
        {
          id: "overlay",
          type: "video",
          src,
          duration: 0.25,
          width: W,
          height: H,
          fps: 12,
          ...(meta.codec !== undefined ? { codec: meta.codec } : {}),
          ...(meta.hasAlpha !== undefined ? { hasAlpha: meta.hasAlpha } : {}),
        },
      ],
      layers: [{ id: "l", z: 0, opacity: 1, blendMode: "normal", items: ["v"] }],
      items: {
        v: {
          type: "video",
          asset: "overlay",
          width: W,
          height: H,
          start: 0,
          trimIn: 0,
          fit: "fill",
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

  /** Decode a rendered PNG frame to raw rgb24 and read one pixel. */
  function pixel(png: string, x: number, y: number): [number, number, number] {
    const raw = execFileSync(
      ffmpegPath ?? "ffmpeg",
      ["-v", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const i = (y * W + x) * 3;
    return [raw[i]!, raw[i + 1]!, raw[i + 2]!];
  }

  const near = (px: readonly number[], to: readonly number[]) =>
    Math.abs(px[0]! - to[0]!) + Math.abs(px[1]! - to[1]!) + Math.abs(px[2]! - to[2]!) < 40;

  /** Export the overlay with `codec`, play it back, return frame 1's pixels. */
  async function roundTrip(
    ext: string,
    codec: string,
  ): Promise<{ corner: [number, number, number]; centre: [number, number, number] }> {
    const dir = mkdtempSync(join(tmpdir(), "davidup-b7-"));
    const extractCache = mkdtempSync(join(tmpdir(), "davidup-b7-cache-"));
    try {
      const overlay = join(dir, `overlay.${ext}`);
      await renderToFile(overlayComp(), overlay, { ffmpegPath, codec });

      // What `register_asset` would record for this file — and the sync probe
      // the extractor falls back on must agree with it.
      const meta = await probeVideo(overlay);
      expect(meta.hasAlpha).toBe(true);
      expect(probeVideoSync(overlay)?.hasAlpha).toBe(true);

      const frames = join(dir, "frames");
      await renderToFile(consumerComp(overlay, meta), frames, {
        ffmpegPath,
        format: "png-sequence",
        preExtract: { cacheRoot: extractCache },
      });
      const frame = join(frames, "00001.png");
      return { corner: pixel(frame, 2, 2), centre: pixel(frame, W / 2, H / 2) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(extractCache, { recursive: true, force: true });
    }
  }

  // The bundled ffmpeg needs both halves: libvpx-vp9 to write the alpha channel
  // and to read it back (the native vp9 decoder can only write).
  const HAS_VP9 =
    /\blibvpx-vp9\b/.test(listing("-encoders")) && /\blibvpx-vp9\b/.test(listing("-decoders"));
  const HAS_PRORES = /\bprores_ks\b/.test(listing("-encoders"));

  it.skipIf(!HAS_VP9)("shows the background through a VP9 .webm overlay", async () => {
    const { corner, centre } = await roundTrip("webm", "libvpx-vp9");
    // Before the fix this corner was [0, 0, 0] — alpha dropped, black kept.
    expect(near(corner, BG)).toBe(true);
    expect(near(centre, [255, 0, 0])).toBe(true);
  }, 120_000);

  it.skipIf(!HAS_PRORES)("still shows it through a ProRes 4444 .mov overlay", async () => {
    const { corner, centre } = await roundTrip("mov", "prores_ks");
    expect(near(corner, BG)).toBe(true);
    expect(near(centre, [255, 0, 0])).toBe(true);
  }, 120_000);
});
