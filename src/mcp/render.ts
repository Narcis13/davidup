// Render helpers for the MCP server.
//
// Why a separate module?  The node driver already handles the video pipeline
// (skia + ffmpeg subprocess). The MCP-only operations are (a) single-frame
// PNG/JPEG snapshots for `render_preview_frame`, and (b) a uniformly-sampled
// strip of thumbnails for `render_thumbnail_strip`. Both reuse skia-canvas
// directly via the existing NodeAssetLoader; ffmpeg runs only when the
// composition has video items whose frames are not yet in the extraction cache.
//
// skia-canvas is lazy-loaded — same pattern the node driver uses — so this
// module can be imported safely in environments where the native build is
// missing. Tests inject a fake module.

import { NodeAssetLoader, type SkiaCanvasModule } from "../assets/index.js";
import {
  buildVideoFrameProvider,
  collectVideoExtractSpecs,
  compositionHasVideo,
  defaultFrameCacheRoot,
  preExtractVideoFrames,
  type FfmpegSpawn,
} from "../drivers/node/index.js";
import { indexTweens, prepareVideoFrames, renderFrame } from "../engine/index.js";
import type { Canvas2DContext, VideoFrameProvider } from "../engine/types.js";
import type { Asset, Composition } from "../schema/types.js";
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
  /**
   * Video frame extraction for compositions with video items — same contract
   * as `renderToFile`'s `preExtract` (shared cache, so a preview warms the
   * render and vice versa). `false` skips it and video items draw nothing.
   */
  preExtract?: false | PreviewPreExtractOptions;
}

export interface PreviewPreExtractOptions {
  /** Cache root. Default: `$DAVIDUP_CACHE/frames` or `~/.davidup/cache/frames`. */
  cacheRoot?: string;
  /** LRU byte budget. Default 5 GB. */
  maxBytes?: number;
  ffmpegPath?: string;
  spawn?: FfmpegSpawn;
}

export interface PreviewResult {
  image: string; // base64
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  /** Present only when non-empty — e.g. video frames had to be extracted. */
  warnings?: string[];
}

export interface ThumbnailStripOptions extends RenderPreviewOptions {
  count: number;
}

// R-18 — an agent (or a bad prompt) requesting `count: 500` would render 500
// frames serially and flood the tool response channel with base64 payloads.
// Cap it to a sane strip size; anything above this is almost certainly a
// mistake (a real contact sheet rarely needs more than a couple dozen
// frames) and callers who genuinely need finer coverage should page across
// multiple calls with different time ranges instead.
export const THUMBNAIL_STRIP_MAX_COUNT = 30;

export interface ThumbnailStripResult {
  images: string[]; // base64 frames, length === count
  times: number[]; // sample times in seconds, parallel to images
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  /** Present only when non-empty — e.g. video frames had to be extracted. */
  warnings?: string[];
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
  const loader = options.loader ?? getCachedLoader(skia, comp.assets);

  await loader.preloadAll(comp.assets);
  const warnings: string[] = [];
  const video = await getVideoProvider(comp, skia, options.preExtract, warnings);

  const meta = comp.composition;
  const canvas = new skia.Canvas(meta.width, meta.height);
  const ctx = canvas.getContext("2d");
  await prepareVideoFrames(comp, time, video);
  ctx.clearRect(0, 0, meta.width, meta.height);
  renderFrame(comp, time, ctx, {
    assets: loader,
    ...(video !== undefined ? { video } : {}),
  });

  const raw = await Promise.resolve(canvas.toBuffer(SKIA_FORMAT[format]));
  return {
    image: toBase64(raw),
    mimeType: MIME[format],
    width: meta.width,
    height: meta.height,
    ...(warnings.length > 0 ? { warnings } : {}),
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
  if (options.count > THUMBNAIL_STRIP_MAX_COUNT) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `thumbnail count ${options.count} exceeds the maximum of ${THUMBNAIL_STRIP_MAX_COUNT}.`,
      `Request at most ${THUMBNAIL_STRIP_MAX_COUNT} thumbnails per call — sample a narrower ` +
        "time range, or call render_thumbnail_strip again for the remaining span.",
    );
  }
  const format: PreviewFormat = options.format ?? "png";
  const skia = options.skiaCanvas ?? (await loadSkia());
  // Single loader, single canvas, single asset preload — important for clips
  // with many assets where reloading per frame would be wasteful. The loader
  // is also cached across MCP calls (see getCachedLoader) so agents iterating
  // on a 20-PNG comp don't re-decode every asset on each preview.
  const loader = options.loader ?? getCachedLoader(skia, comp.assets);
  await loader.preloadAll(comp.assets);
  // One provider for the whole strip — extraction + decode happen at most once.
  const warnings: string[] = [];
  const video = await getVideoProvider(comp, skia, options.preExtract, warnings);

  const meta = comp.composition;
  const canvas = new skia.Canvas(meta.width, meta.height);
  const ctx = canvas.getContext("2d");
  const tweenIndex = indexTweens(comp);

  const times = sampleTimes(meta.duration, options.count);
  const images: string[] = [];
  for (const t of times) {
    await prepareVideoFrames(comp, t, video);
    ctx.clearRect(0, 0, meta.width, meta.height);
    renderFrame(comp, t, ctx, {
      assets: loader,
      index: tweenIndex,
      ...(video !== undefined ? { video } : {}),
    });
    const raw = await Promise.resolve(canvas.toBuffer(SKIA_FORMAT[format]));
    images.push(toBase64(raw));
  }

  return {
    images,
    times,
    mimeType: MIME[format],
    width: meta.width,
    height: meta.height,
    ...(warnings.length > 0 ? { warnings } : {}),
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
    throw new MCPToolError(
      "E_INVALID_VALUE",
      "time must be a non-negative finite number.",
      "Pass seconds since composition start; must be ≥ 0 and finite (e.g. 0.5).",
    );
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

// Cross-call asset-loader cache. Without this, every render_preview_frame /
// render_thumbnail_strip call spun up a fresh NodeAssetLoader and re-decoded
// every image (and re-registered every font) — the dominant per-iteration
// latency cost when an agent renders the same comp repeatedly.
//
// Key strategy: WeakMap keyed by the skia module identity (so a different
// skia — e.g. a test fake — never reuses production loaders, and unused
// skias GC naturally), then by a content-hash of comp.assets so any change
// to the asset list (added/removed/re-pointed src) lands on a fresh loader.
//
// LRU-capped per skia to keep memory bounded when an agent iterates through
// many distinct asset configurations.
interface CachedLoader {
  loader: NodeAssetLoader;
}

const LOADER_CACHE_MAX = 8;
const loaderCache: WeakMap<SkiaCanvasModule, Map<string, CachedLoader>> =
  new WeakMap();

function getCachedLoader(
  skia: SkiaCanvasModule,
  assets: ReadonlyArray<Asset>,
): NodeAssetLoader {
  let inner = loaderCache.get(skia);
  if (!inner) {
    inner = new Map();
    loaderCache.set(skia, inner);
  }
  const key = assetsKey(assets);
  const hit = inner.get(key);
  if (hit) {
    // Touch for LRU ordering — Map preserves insertion order.
    inner.delete(key);
    inner.set(key, hit);
    return hit.loader;
  }
  const loader = new NodeAssetLoader({ skiaCanvas: skia });
  const entry: CachedLoader = { loader };
  inner.set(key, entry);
  while (inner.size > LOADER_CACHE_MAX) {
    const oldest = inner.keys().next().value;
    if (oldest === undefined) break;
    inner.delete(oldest);
  }
  return loader;
}

// Cross-call video frame provider cache (v1.1 S4). Extraction output already
// lives in the on-disk frame cache, but decoding a clip's PNGs into bitmaps is
// the expensive part of a preview — so the decoded provider is kept per skia
// module, keyed by cache root + every extraction spec (hash → item ids). The
// spec hash pins source path/mtime/size, trim, fps and resolution, so any edit
// that changes the pixels lands on a fresh key. Kept small: each entry holds
// every decoded frame of its clips in memory.
const PROVIDER_CACHE_MAX = 4;
const providerCache: WeakMap<
  SkiaCanvasModule,
  Map<string, Promise<VideoFrameProvider>>
> = new WeakMap();

async function getVideoProvider(
  comp: Composition,
  skia: SkiaCanvasModule,
  preExtract: RenderPreviewOptions["preExtract"],
  warnings: string[],
): Promise<VideoFrameProvider | undefined> {
  if (preExtract === false || !compositionHasVideo(comp)) return undefined;
  const pe = preExtract ?? {};
  const cacheRoot = pe.cacheRoot ?? defaultFrameCacheRoot();

  let key: string;
  try {
    const specs = collectVideoExtractSpecs(comp);
    key = JSON.stringify([cacheRoot, specs.map((s) => [s.hash, s.itemIds])]);
  } catch (err) {
    // Missing/unreadable source: the preview still renders the rest of the
    // frame; the agent learns why the footage is absent.
    warnings.push(`Video frames unavailable: ${errorMessage(err)}`);
    return undefined;
  }

  let inner = providerCache.get(skia);
  if (!inner) {
    inner = new Map();
    providerCache.set(skia, inner);
  }
  let pending = inner.get(key);
  if (pending) {
    inner.delete(key);
    inner.set(key, pending);
  } else {
    pending = (async () => {
      const result = await preExtractVideoFrames(comp, {
        cacheRoot,
        ...(pe.maxBytes !== undefined ? { maxBytes: pe.maxBytes } : {}),
        ...(pe.ffmpegPath !== undefined ? { ffmpegPath: pe.ffmpegPath } : {}),
        ...(pe.spawn !== undefined ? { spawn: pe.spawn } : {}),
      });
      const extracted = [...result.entries.values()].filter((e) => !e.cached);
      if (extracted.length > 0) {
        const frames = extracted.reduce((n, e) => n + e.frameCount, 0);
        warnings.push(
          `Extracted ${frames} video frame(s) for ${extracted.length} clip(s) before rendering; ` +
            "later previews and renders of the same clips reuse the frame cache.",
        );
      }
      return buildVideoFrameProvider(result, skia);
    })();
    inner.set(key, pending);
    while (inner.size > PROVIDER_CACHE_MAX) {
      const oldest = inner.keys().next().value;
      if (oldest === undefined) break;
      inner.delete(oldest);
    }
  }

  try {
    return await pending;
  } catch (err) {
    // Never cache a failure — the next call retries (e.g. after the agent
    // fixes the asset path or ffmpeg becomes available).
    if (inner.get(key) === pending) inner.delete(key);
    warnings.push(`Video frames unavailable: ${errorMessage(err)}`);
    return undefined;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function assetsKey(assets: ReadonlyArray<Asset>): string {
  // Sort by id so callers that pass the same logical asset set in different
  // orders still hit the same cache entry. JSON.stringify is canonical for
  // these flat shapes (image: {id,type,src}; font: {id,type,src,family}).
  const sorted = [...assets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(sorted);
}
