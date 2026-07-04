// Shared harness for the determinism golden-frame tests (v1 plan Session 23,
// R-16). Renders individual frames straight from the engine — skia-canvas's
// raw RGBA buffer, no ffmpeg encode round-trip — so the hash tests the
// engine + renderer's own determinism, not libx264/container reproducibility
// (that claim is scoped separately, see bitexact.integration.test.ts).
//
// This intentionally duplicates a slice of `src/drivers/node/index.ts`'s
// per-frame loop (precompile → preload → optional video pre-extract → paint)
// rather than reusing `renderToFile`, because `renderToFile` only exposes an
// encoded file, not the pre-encode buffer for an arbitrary frame index.

import { createHash } from "node:crypto";

import { NodeAssetLoader, type SkiaCanvasModule } from "../../../src/assets/index.js";
import { precompile } from "../../../src/compose/index.js";
import type { ReadFile } from "../../../src/compose/imports.js";
import { indexTweens, renderFrame } from "../../../src/engine/index.js";
import type { OffscreenSurface, VideoFrameProvider } from "../../../src/engine/types.js";
import {
  buildVideoFrameProvider,
  compositionHasVideo,
  frameCount,
  preExtractVideoFrames,
} from "../../../src/drivers/node/index.js";
import type { Composition } from "../../../src/schema/types.js";

export interface SkiaDriverModule extends SkiaCanvasModule {
  Canvas: new (width: number, height: number) => {
    getContext(kind: "2d"): import("../../../src/engine/types.js").Canvas2DContext;
    toBuffer(format: "raw"): Promise<Uint8Array> | Uint8Array;
  };
}

let cachedSkia: SkiaDriverModule | undefined;

async function importSkiaCanvas(): Promise<SkiaDriverModule> {
  if (cachedSkia) return cachedSkia;
  const specifier = "skia-canvas";
  cachedSkia = (await import(/* @vite-ignore */ specifier)) as SkiaDriverModule;
  return cachedSkia;
}

export interface FrameRenderOptions {
  sourcePath?: string;
  readFile?: ReadFile;
}

/**
 * Render a composition to raw RGBA buffers at the given fractional points of
 * its duration (0 = first frame, 1 = last frame), frame-index-snapped the
 * same way `renderToFile`'s loop computes `t` (`t = frameIndex / fps`) so the
 * hashed instant matches a real encoded frame exactly.
 */
export async function renderFractionalFrames(
  comp: Composition,
  fractions: readonly number[],
  opts: FrameRenderOptions = {},
): Promise<Uint8Array[]> {
  const skia = await importSkiaCanvas();
  const compiled = (await precompile(comp, {
    ...(opts.sourcePath !== undefined ? { sourcePath: opts.sourcePath } : {}),
    ...(opts.readFile !== undefined ? { readFile: opts.readFile } : {}),
  })) as Composition;

  const loader = new NodeAssetLoader({ skiaCanvas: skia });
  await loader.preloadAll(compiled.assets);

  let videoProvider: VideoFrameProvider | undefined;
  if (compositionHasVideo(compiled)) {
    const peResult = await preExtractVideoFrames(compiled, {});
    videoProvider = await buildVideoFrameProvider(peResult, skia);
  }

  const meta = compiled.composition;
  const canvas = new skia.Canvas(meta.width, meta.height);
  const ctx = canvas.getContext("2d");
  const tweenIndex = indexTweens(compiled);
  const createOffscreen = (w: number, h: number): OffscreenSurface => {
    const off = new skia.Canvas(w, h);
    return { context: off.getContext("2d"), source: off };
  };

  const totalFrames = frameCount(compiled);
  const buffers: Uint8Array[] = [];
  for (const frac of fractions) {
    const idx = Math.min(
      totalFrames - 1,
      Math.max(0, Math.round(frac * (totalFrames - 1))),
    );
    const t = idx / meta.fps;
    ctx.clearRect(0, 0, meta.width, meta.height);
    renderFrame(compiled, t, ctx, {
      assets: loader,
      index: tweenIndex,
      createOffscreen,
      ...(videoProvider !== undefined ? { video: videoProvider } : {}),
    });
    const raw = await Promise.resolve(canvas.toBuffer("raw"));
    buffers.push(raw);
  }
  return buffers;
}

/**
 * Render a single frame at an exact (not frame-snapped) time `t`, raw RGBA.
 * Used by the node↔browser parity test, which compares against a browser
 * paint at the same continuous `t` (the browser driver isn't frame-quantized
 * — it paints at wall-clock time). No video support: video pre-extraction
 * is frame-indexed and has no meaning for an arbitrary continuous `t`.
 */
export async function renderFrameRawAt(
  comp: Composition,
  t: number,
  opts: FrameRenderOptions = {},
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const skia = await importSkiaCanvas();
  const compiled = (await precompile(comp, {
    ...(opts.sourcePath !== undefined ? { sourcePath: opts.sourcePath } : {}),
    ...(opts.readFile !== undefined ? { readFile: opts.readFile } : {}),
  })) as Composition;

  const loader = new NodeAssetLoader({ skiaCanvas: skia });
  await loader.preloadAll(compiled.assets);

  const meta = compiled.composition;
  const canvas = new skia.Canvas(meta.width, meta.height);
  const ctx = canvas.getContext("2d");
  const tweenIndex = indexTweens(compiled);
  const createOffscreen = (w: number, h: number): OffscreenSurface => {
    const off = new skia.Canvas(w, h);
    return { context: off.getContext("2d"), source: off };
  };

  ctx.clearRect(0, 0, meta.width, meta.height);
  renderFrame(compiled, t, ctx, {
    assets: loader,
    index: tweenIndex,
    createOffscreen,
  });
  const raw = await Promise.resolve(canvas.toBuffer("raw"));
  return { data: raw, width: meta.width, height: meta.height };
}

export function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Render at the given fractions and return the sha256 hash of each raw frame. */
export async function renderFractionalFrameHashes(
  comp: Composition,
  fractions: readonly number[],
  opts: FrameRenderOptions = {},
): Promise<string[]> {
  const frames = await renderFractionalFrames(comp, fractions, opts);
  return frames.map(sha256);
}

/** The three sample points every golden-frame example is hashed at. */
export const GOLDEN_FRACTIONS = [0.1, 0.5, 0.9] as const;
