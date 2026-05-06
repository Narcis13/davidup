// Render helpers for the MCP server.
//
// Why a separate module?  The node driver already handles the video pipeline
// (skia + ffmpeg subprocess). The MCP-only operations are (a) single-frame
// PNG/JPEG snapshots for `render_preview_frame`, and (b) a uniformly-sampled
// strip of thumbnails for `render_thumbnail_strip`. Both reuse skia-canvas
// directly via the existing NodeAssetLoader; neither needs ffmpeg.
//
// skia-canvas is lazy-loaded — same pattern the node driver uses — so this
// module can be imported safely in environments where the native build is
// missing. Tests inject a fake module.

import { NodeAssetLoader, type SkiaCanvasModule } from "../assets/index.js";
import { indexTweens, renderFrame } from "../engine/index.js";
import type { Canvas2DContext } from "../engine/types.js";
import type { Composition } from "../schema/types.js";
import { MCPToolError } from "./errors.js";

export type PreviewFormat = "png" | "jpeg";

export interface PreviewSkiaCanvas {
  getContext(kind: "2d"): Canvas2DContext;
  toBuffer(
    format: "png" | "jpg",
    options?: Record<string, unknown>,
  ): Promise<Uint8Array> | Uint8Array;
  // Optional reset-between-frames primitive. We always clearRect via the
  // context, but expose this so a future cache layer can use it.
}

export interface PreviewSkiaModule extends SkiaCanvasModule {
  Canvas: new (width: number, height: number) => PreviewSkiaCanvas;
}

export interface RenderPreviewOptions {
  format?: PreviewFormat;
  skiaCanvas?: PreviewSkiaModule;
  loader?: NodeAssetLoader;
}

export interface PreviewResult {
  image: string; // base64
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

export interface ThumbnailStripOptions extends RenderPreviewOptions {
  count: number;
}

export interface ThumbnailStripResult {
  images: string[]; // base64 frames, length === count
  times: number[]; // sample times in seconds, parallel to images
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

const SKIA_FORMAT: Record<PreviewFormat, "png" | "jpg"> = {
  png: "png",
  jpeg: "jpg",
};

const MIME: Record<PreviewFormat, "image/png" | "image/jpeg"> = {
  png: "image/png",
  jpeg: "image/jpeg",
};

export async function renderPreviewFrame(
  comp: Composition,
  time: number,
  options: RenderPreviewOptions = {},
): Promise<PreviewResult> {
  ensureFiniteTime(time);
  const format: PreviewFormat = options.format ?? "png";
  const skia = options.skiaCanvas ?? (await loadSkia());
  const loader = options.loader ?? new NodeAssetLoader({ skiaCanvas: skia });

  await loader.preloadAll(comp.assets);

  const meta = comp.composition;
  const canvas = new skia.Canvas(meta.width, meta.height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, meta.width, meta.height);
  renderFrame(comp, time, ctx, { assets: loader });

  const raw = await Promise.resolve(canvas.toBuffer(SKIA_FORMAT[format]));
  return {
    image: toBase64(raw),
    mimeType: MIME[format],
    width: meta.width,
    height: meta.height,
  };
}

export async function renderThumbnailStrip(
  comp: Composition,
  options: ThumbnailStripOptions,
): Promise<ThumbnailStripResult> {
  if (!Number.isInteger(options.count) || options.count <= 0) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      "thumbnail count must be a positive integer.",
    );
  }
  const format: PreviewFormat = options.format ?? "png";
  const skia = options.skiaCanvas ?? (await loadSkia());
  // Single loader, single canvas, single asset preload — important for clips
  // with many assets where reloading per frame would be wasteful.
  const loader = options.loader ?? new NodeAssetLoader({ skiaCanvas: skia });
  await loader.preloadAll(comp.assets);

  const meta = comp.composition;
  const canvas = new skia.Canvas(meta.width, meta.height);
  const ctx = canvas.getContext("2d");
  const tweenIndex = indexTweens(comp);

  const times = sampleTimes(meta.duration, options.count);
  const images: string[] = [];
  for (const t of times) {
    ctx.clearRect(0, 0, meta.width, meta.height);
    renderFrame(comp, t, ctx, { assets: loader, index: tweenIndex });
    const raw = await Promise.resolve(canvas.toBuffer(SKIA_FORMAT[format]));
    images.push(toBase64(raw));
  }

  return {
    images,
    times,
    mimeType: MIME[format],
    width: meta.width,
    height: meta.height,
  };
}

// Uniformly sample [0, duration]. count=1 → midpoint (duration/2 — feels
// natural as a single thumbnail). count≥2 → endpoints included plus equal
// spacing (linspace), so the strip spans the whole timeline.
export function sampleTimes(duration: number, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [duration / 2];
  const step = duration / (count - 1);
  const out: number[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = i * step;
  return out;
}

function ensureFiniteTime(t: number): void {
  if (!Number.isFinite(t) || t < 0) {
    throw new MCPToolError("E_INVALID_VALUE", "time must be a non-negative finite number.");
  }
}

function toBase64(raw: Uint8Array | Buffer): string {
  if (Buffer.isBuffer(raw)) return raw.toString("base64");
  return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("base64");
}

async function loadSkia(): Promise<PreviewSkiaModule> {
  // Indirect import so Vite/bundlers don't try to resolve the native module
  // at transform time. Same trick the node driver uses.
  const specifier = "skia-canvas";
  const mod = await (
    Function("s", "return import(s)") as (s: string) => Promise<PreviewSkiaModule>
  )(specifier);
  return mod;
}
