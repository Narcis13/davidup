// Pre-extract pipeline for video frames (v0.2 §S7).
//
// Video clips render as textures: a `VideoItem` is drawn from a PNG sequence
// pre-extracted from its source asset (drawing itself lands in §S8). This
// module is the extraction half — before any frame is encoded, the render
// driver asks it to materialise, for every distinct video clip in the
// composition, a directory of numbered PNGs ffmpeg produced with:
//
//   ffmpeg -ss <trimIn> -i <asset> -t <trimOut-trimIn>
//          -vf "fps=<compFps>,scale=<W>:-2" cache/<hash>/%05d.png
//
// (Frames keep the source aspect ratio — see resolveExtractDimensions; the
// item's `fit` is applied at draw time. A source that carries transparency is
// written `-pix_fmt rgba` so it keeps it — see resolveAlphaExtract for the
// VP8/VP9 side-channel case, which additionally needs a non-default decoder.)
//
// (The plan writes `-to <trimOut>`; we use `-t <duration>` instead — after an
// input `-ss` it is the version-stable way to express the same [trimIn,trimOut)
// window, since `-to` semantics relative to input seeking have varied across
// ffmpeg releases and determinism is a project invariant.)
//
// Caching: the cache directory name is a deterministic hash of everything that
// changes the pixels — the resolved source path, the file's mtime + size (so a
// re-encoded asset at the same path misses), the trim window, the composition
// fps, and the target resolution. Two items that share those params share one
// cache entry, and a second render of the same project is a pure cache hit:
// no ffmpeg runs, the extraction cost collapses to a few stat calls.
//
// Entries are published atomically (extract into a `.tmp-*` dir, then rename)
// so an interrupted extraction never leaves a half-written entry that a later
// run mistakes for a hit. After each run the cache is pruned LRU to a byte
// budget (default 5 GB) using each entry's `accessedAt`, touched on every hit.
//
// The pure pieces (spec collection, hashing, arg building, prune) are exported
// for unit testing; only `preExtractVideoFrames` / `pruneCache` touch the
// filesystem or spawn ffmpeg, and both accept an injectable `spawn` so tests
// run without the native binary.

import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { statSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import * as nodeOs from "node:os";
import { join } from "node:path";

import { resolveGlobalSrc } from "../../assets/node.js";
import { fpsRational, fpsValue, type Fps } from "../../schema/fps.js";
import type { Composition, VideoAsset, VideoItem } from "../../schema/types.js";
import { resolveFfmpeg, sweepOrphanExtractDirs } from "./ffmpeg.js";
import { probeVideoSync } from "./ffprobe.js";
import type { FfmpegSpawn } from "./index.js";

/**
 * Version of the extraction resolution policy, folded into every cache hash.
 * Bump when extracted pixels change for identical inputs.
 *   1 — frames stretched to the item box (`scale=W:H`); `fit` was a no-op.
 *   2 — frames keep the source aspect, capped by the box (B-1). ⚠ pixel-changing
 *   3 — sources with alpha extract to RGBA PNGs, and VP8/VP9 alpha is decoded
 *       with libvpx instead of ffmpeg's native decoder (B-7). ⚠ pixel-changing
 *       for alpha sources only; opaque sources are untouched (forcing RGBA on
 *       them shifts swscale's rounding by up to 3/255 for nothing).
 */
export const VIDEO_EXTRACTION_VERSION = 3;

/** Default LRU byte budget for the frame cache: 5 GB. Overridable per call. */
export const DEFAULT_CACHE_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/** Marker file written into a published cache entry; its presence ⇒ complete. */
const META_FILENAME = "meta.json";

const STDERR_TAIL_BYTES = 4096;

// ───────────────────────────── spec collection ─────────────────────────────

/**
 * A distinct extraction job. Items sharing the same source + trim window + fps
 * + target resolution collapse to one spec (and one cache entry); `itemIds`
 * lists every video item the spec covers, sorted for deterministic reporting.
 */
export interface VideoExtractSpec {
  /** Deterministic cache key (sha256 hex of the pixel-affecting params). */
  hash: string;
  /** Composition item ids that resolve to this spec, sorted. */
  itemIds: string[];
  /** Source video asset id. */
  assetId: string;
  /** Filesystem path handed to ffmpeg (`global:` already resolved). */
  srcPath: string;
  /** Seconds into the source where extraction starts (default 0). */
  trimIn: number;
  /** Seconds into the source where extraction stops; undefined ⇒ to EOF. */
  trimOut: number | undefined;
  /** `trimOut - trimIn` when both are known, else undefined (extract to EOF). */
  duration: number | undefined;
  /** Target output frame rate (the composition fps; number or "N/D"). */
  fps: Fps;
  /** Expected frame width in pixels (source aspect; see {@link resolveExtractDimensions}). */
  width: number;
  /** Expected frame height in pixels. */
  height: number;
  /** Aspect-preserving ffmpeg scale filter, or `""` for native size. */
  scale: string;
  /**
   * True when the source carries transparency the extraction must preserve
   * (B-7): frames are written as RGBA instead of ffmpeg's default RGB.
   */
  alpha: boolean;
  /**
   * Decoder to force with `-c:v` before `-i`, or undefined to let ffmpeg
   * choose. Set only for VP8/VP9 sources carrying alpha (B-7); see
   * {@link alphaDecoderFor}.
   */
  decoder: string | undefined;
}

/** Minimal `fs.stat` shape the hash needs; injectable so tests skip real files. */
export interface FileStat {
  mtimeMs: number;
  size: number;
}

export interface CollectSpecsOptions {
  /** Override the global library root for `global:` srcs (tests). */
  globalLibraryRoot?: string;
  /**
   * Stat a resolved source path. Default: `fs.statSync`. Injected by tests so
   * spec collection (and its hashing) runs without touching the disk.
   */
  statFile?: (path: string) => FileStat;
  /**
   * Probe a WebM/Matroska source whose asset entry records no `codec` /
   * `hasAlpha` (B-7). Default: a memoised, best-effort `ffprobe` run. Injected
   * by tests; returning undefined just means "unknown", never an error.
   */
  probeVideoFile?: (path: string) => VideoProbeHint | undefined;
}

/** The two probe fields {@link resolveDecoder} needs from a source file. */
export interface VideoProbeHint {
  /** ffprobe `codec_name`, e.g. "vp9". */
  codec?: string | undefined;
  /** True when the stream carries alpha (pixel format or `alpha_mode` tag). */
  hasAlpha?: boolean | undefined;
}

/** True when the composition places at least one video item. */
export function compositionHasVideo(comp: Composition): boolean {
  return Object.values(comp.items).some((it) => it.type === "video");
}

/**
 * Walk the composition's items, resolve every `VideoItem` to an extraction
 * spec, and dedupe by hash. Returned sorted by hash so the processing order
 * (and therefore progress reporting) is deterministic regardless of item
 * insertion order.
 *
 * @throws {Error} when a video item references a missing or non-video asset,
 *   the source file cannot be stat'd, or its box + asset dimensions are both
 *   unusable — the schema validator does not cross-check these, so this is the
 *   last guard before ffmpeg would fail opaquely (mirrors resolveAudioInputs).
 */
export function collectVideoExtractSpecs(
  comp: Composition,
  opts: CollectSpecsOptions = {},
): VideoExtractSpec[] {
  const fps = comp.composition.fps;
  const statFile = opts.statFile ?? defaultStatFile;
  const assetById = new Map(comp.assets.map((a) => [a.id, a] as const));
  const byHash = new Map<string, VideoExtractSpec>();

  for (const [id, item] of Object.entries(comp.items)) {
    if (item.type !== "video") continue;
    const video = item as VideoItem;

    const asset = assetById.get(video.asset);
    if (!asset) {
      throw new Error(
        `Video item "${id}" references unknown asset "${video.asset}".`,
      );
    }
    if (asset.type !== "video") {
      throw new Error(
        `Video item "${id}" references asset "${video.asset}" which is type "${asset.type}", not "video".`,
      );
    }
    const videoAsset = asset as VideoAsset;
    const srcPath = resolveGlobalSrc(videoAsset.src, opts.globalLibraryRoot);

    let fileStat: FileStat;
    try {
      fileStat = statFile(srcPath);
    } catch (err) {
      throw new Error(
        `Cannot stat video asset "${srcPath}" for item "${id}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const trimIn = video.trimIn ?? 0;
    // trimOut defaults to the asset's natural duration when known; otherwise it
    // stays undefined and ffmpeg extracts to EOF (freeze/loop is §S8's job).
    const trimOut = video.trimOut ?? videoAsset.duration;
    const duration =
      trimOut !== undefined ? Math.max(0, trimOut - trimIn) : undefined;

    const { width, height, scale } = resolveExtractDimensions(video, videoAsset, id);
    const { alpha, decoder } = resolveAlphaExtract(
      videoAsset,
      srcPath,
      fileStat,
      opts.probeVideoFile,
    );

    const hash = computeSpecHash({
      src: srcPath,
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      trimIn,
      trimOut: trimOut ?? null,
      fps,
      width,
      height,
      scale,
      alpha,
      decoder: decoder ?? null,
    });

    const existing = byHash.get(hash);
    if (existing) {
      existing.itemIds.push(id);
      existing.itemIds.sort();
      continue;
    }
    byHash.set(hash, {
      hash,
      itemIds: [id],
      assetId: asset.id,
      srcPath,
      trimIn,
      trimOut,
      duration,
      fps,
      width,
      height,
      scale,
      alpha,
      decoder,
    });
  }

  return [...byHash.values()].sort((a, b) =>
    a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0,
  );
}

/** Resolved extraction resolution for one video item (see {@link resolveExtractDimensions}). */
export interface ExtractDimensions {
  /** Expected frame width. Exact when the asset's dimensions are known. */
  width: number;
  /** Expected frame height. Exact when the asset's dimensions are known. */
  height: number;
  /**
   * The ffmpeg `scale` filter (without the leading comma), or `""` when frames
   * are extracted at native size. Always aspect-preserving — never `W:H`.
   */
  scale: string;
}

/**
 * The resolution to extract a video item's frames at (B-1). Frames keep the
 * SOURCE aspect ratio so the draw-time `fit` (`computeFitRects`) has something
 * to letterbox / crop; a stretched `W:H` extraction made every `fit` identical.
 *
 * Policy: native size, capped so the longest side does not exceed the box's
 * longest side × `max(|scaleX|, |scaleY|)` (rounded up) — a 4K source placed
 * as a 320px inset extracts at 320px, not 3840px. Sources already under the cap
 * are never upscaled. The capped side is fixed and the other uses ffmpeg's
 * `-2` (aspect-preserving, rounded to even), predicted here with the same
 * nearest-even rounding. When the asset was never probed (no width/height) the
 * cap is expressed as an ffmpeg expression on `iw`/`ih` and `width`/`height`
 * are the cap only — the true size is read back from the extracted PNG.
 *
 * Width/height tweens are not factored in (the cache is per static resolution).
 *
 * Pure and exported for unit testing.
 */
export function resolveExtractDimensions(
  item: VideoItem,
  asset: VideoAsset,
  itemId: string,
): ExtractDimensions {
  const scaleFactor = Math.max(
    Math.abs(item.transform.scaleX),
    Math.abs(item.transform.scaleY),
  );
  const boxLongest = Math.max(item.width, item.height) * scaleFactor;
  // A degenerate box (zero area or zero scale) imposes no cap: extract native.
  const cap =
    item.width > 0 && item.height > 0 && boxLongest > 0
      ? Math.max(2, Math.ceil(boxLongest - 1e-9))
      : undefined;

  const iw = asset.width;
  const ih = asset.height;
  if (iw && ih) {
    const longest = Math.max(iw, ih);
    if (cap === undefined || longest <= cap) {
      return { width: iw, height: ih, scale: "" };
    }
    if (iw >= ih) {
      return { width: cap, height: evenRescale(cap, ih, iw), scale: `scale=${cap}:-2` };
    }
    return { width: evenRescale(cap, iw, ih), height: cap, scale: `scale=-2:${cap}` };
  }

  if (cap === undefined) {
    throw new Error(
      `Video item "${itemId}" has a degenerate box (${item.width}x${item.height}) ` +
        `and asset "${asset.id}" has unknown dimensions; cannot determine extract resolution.`,
    );
  }
  return {
    width: cap,
    height: cap,
    scale:
      `scale=w='if(gte(iw,ih),min(iw,${cap}),-2)'` +
      `:h='if(gte(iw,ih),-2,min(ih,${cap}))'`,
  };
}

// ffmpeg's `-2` side: av_rescale (round-to-nearest) of the fixed side into the
// source aspect, in units of 2. Mirrors libavfilter/scale_eval.c.
function evenRescale(fixed: number, other: number, fixedIn: number): number {
  return Math.max(2, Math.round((fixed * other) / (fixedIn * 2)) * 2);
}

// ───────────────────────────── decoder choice ──────────────────────────────

/**
 * The decoder that can actually see a source's alpha, or undefined to let
 * ffmpeg pick (B-7).
 *
 * WebM/Matroska carry VP8/VP9 alpha in an out-of-band side channel (the
 * `alpha_mode` stream tag, pixel format still yuv420p). ffmpeg's *native* vp9
 * decoder ignores that channel, so extracting davidup's own alpha .webm export
 * produced opaque black where it should have been transparent; only the libvpx
 * decoders read it. Nothing else needs an override — every other container
 * states its alpha in the pixel format, which any decoder honours.
 *
 * Pure and exported for unit testing.
 */
export function alphaDecoderFor(
  codec: string | undefined,
  hasAlpha: boolean | undefined,
): string | undefined {
  if (hasAlpha !== true) return undefined;
  switch (codec?.toLowerCase()) {
    case "vp9":
      return "libvpx-vp9";
    case "vp8":
      return "libvpx";
    default:
      return undefined;
  }
}

/** Containers that can hide alpha outside the pixel format (see above). */
const SIDE_CHANNEL_ALPHA_EXTENSIONS = [".webm", ".mkv"];

/**
 * Resolve a spec's alpha handling from the asset's recorded metadata, probing
 * the file only when that metadata is missing *and* the container is one that
 * can hide alpha (`register_asset` fills both fields, so this is the
 * hand-written-composition path). The probe is memoised on path + mtime + size
 * so the three callers that recompute a spec hash agree without re-spawning
 * ffprobe.
 *
 * An asset that never says whether it has alpha (and isn't worth probing)
 * extracts exactly as it did before B-7: ffmpeg negotiates the PNG pixel
 * format from the decoded frames, which already keeps in-pixel-format alpha.
 */
function resolveAlphaExtract(
  asset: VideoAsset,
  srcPath: string,
  fileStat: FileStat,
  probeFile: ((path: string) => VideoProbeHint | undefined) | undefined,
): { alpha: boolean; decoder: string | undefined } {
  let codec = asset.codec;
  let hasAlpha = asset.hasAlpha;
  if (
    (codec === undefined || hasAlpha === undefined) &&
    SIDE_CHANNEL_ALPHA_EXTENSIONS.some((ext) => srcPath.toLowerCase().endsWith(ext))
  ) {
    const probe = memoisedProbe(srcPath, fileStat, probeFile ?? defaultProbeVideoFile);
    codec ??= probe?.codec;
    hasAlpha ??= probe?.hasAlpha;
  }
  return { alpha: hasAlpha === true, decoder: alphaDecoderFor(codec, hasAlpha) };
}

const probeMemo = new Map<string, VideoProbeHint | undefined>();

function memoisedProbe(
  srcPath: string,
  fileStat: FileStat,
  probeFile: (path: string) => VideoProbeHint | undefined,
): VideoProbeHint | undefined {
  const key = `${srcPath}\0${fileStat.mtimeMs}\0${fileStat.size}`;
  if (probeMemo.has(key)) return probeMemo.get(key);
  let hint: VideoProbeHint | undefined;
  try {
    hint = probeFile(srcPath);
  } catch {
    hint = undefined; // Best effort: unknown metadata just means no override.
  }
  probeMemo.set(key, hint);
  return hint;
}

function defaultProbeVideoFile(path: string): VideoProbeHint | undefined {
  const meta = probeVideoSync(path);
  if (!meta) return undefined;
  return { codec: meta.codec, hasAlpha: meta.hasAlpha };
}

interface SpecHashInput {
  src: string;
  mtimeMs: number;
  size: number;
  trimIn: number;
  trimOut: number | null;
  fps: Fps;
  width: number;
  height: number;
  /** ffmpeg scale filter; see {@link ExtractDimensions.scale}. */
  scale: string;
  /** Whether frames are extracted with an alpha channel. */
  alpha: boolean;
  /** Forced `-c:v` decoder, or null for ffmpeg's default. */
  decoder: string | null;
}

/**
 * Deterministic cache key for an extraction. sha256 over a canonical JSON of
 * every pixel-affecting parameter; the asset's mtime + size are included so a
 * file replaced at the same path produces a fresh key (cache miss).
 */
export function computeSpecHash(input: SpecHashInput): string {
  const canonical = JSON.stringify({
    v: VIDEO_EXTRACTION_VERSION,
    src: input.src,
    mtimeMs: input.mtimeMs,
    size: input.size,
    trimIn: input.trimIn,
    trimOut: input.trimOut,
    fps: input.fps,
    width: input.width,
    height: input.height,
    scale: input.scale,
    alpha: input.alpha,
    decoder: input.decoder,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// ───────────────────────────── ffmpeg argv ─────────────────────────────────

/**
 * Build the ffmpeg argv that extracts `spec` into `outputPattern`
 * (e.g. `/cache/.tmp-xyz/%05d.png`). Pure — exported for unit testing.
 *
 * Input seek (`-ss` before `-i`) is fast and keyframe-accurate enough for a
 * texture; `-t duration` then caps the window. `-progress pipe:1 -nostats`
 * emits machine-readable `frame=N` lines on stdout for progress reporting.
 *
 * `spec.decoder` (B-7) is an *input* option, so it goes before `-i` — that is
 * the half that actually recovers VP8/VP9 alpha. An alpha spec then pins the
 * output to `-pix_fmt rgba`: ffmpeg negotiates the same format from decoded
 * yuva frames today, so this states the requirement rather than relying on
 * that. Opaque specs leave the PNG format alone — pinning RGBA there changes
 * nothing but swscale's rounding (±3/255, and every cached frame).
 */
export function buildExtractArgs(
  spec: VideoExtractSpec,
  outputPattern: string,
): string[] {
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-progress",
    "pipe:1",
    "-nostats",
    "-ss",
    fmtSeconds(spec.trimIn),
  ];
  if (spec.decoder !== undefined) {
    args.push("-c:v", spec.decoder);
  }
  args.push("-i", spec.srcPath);
  if (spec.duration !== undefined) {
    args.push("-t", fmtSeconds(spec.duration));
  }
  const filters = [`fps=${fmtFps(spec.fps)}`];
  if (spec.scale) filters.push(spec.scale);
  args.push("-vf", filters.join(","));
  if (spec.alpha) args.push("-pix_fmt", "rgba");
  args.push(outputPattern);
  return args;
}

// ───────────────────────────── orchestration ───────────────────────────────

/** A single cache entry's status after a pre-extract run. */
export interface FrameCacheEntry {
  hash: string;
  /** Absolute path of the published cache directory holding the PNG sequence. */
  dir: string;
  /** Number of PNG frames in the entry. */
  frameCount: number;
  /** Intrinsic pixel width of each extracted frame (drives §S8 `fit`). */
  width: number;
  /** Intrinsic pixel height of each extracted frame. */
  height: number;
  /** Total bytes of the PNG frames (excludes the meta marker). */
  bytes: number;
  /** Composition item ids served by this entry. */
  itemIds: string[];
  /** True when the entry was already present (no ffmpeg ran this round). */
  cached: boolean;
}

/** Progress event emitted while pre-extracting. */
export interface FrameExtractProgress {
  /** 1-based index of the current spec among `totalSpecs`. */
  spec: number;
  /** Total number of distinct extractions this run. */
  totalSpecs: number;
  hash: string;
  /** Composition item ids served by this spec. */
  itemIds: readonly string[];
  /** Frames produced so far for this spec. */
  frame: number;
  /** Expected frame count for this spec, when computable (else undefined). */
  totalFrames: number | undefined;
  /** True when this spec was a pure cache hit (no ffmpeg ran). */
  cached: boolean;
}

export interface PreExtractOptions {
  /** Cache root directory. Default: {@link defaultFrameCacheRoot}. */
  cacheRoot?: string;
  /** LRU byte budget. Default: {@link DEFAULT_CACHE_MAX_BYTES} (5 GB). */
  maxBytes?: number;
  /** Override the ffmpeg binary. Default: bundled `ffmpeg-static`, else `ffmpeg`. */
  ffmpegPath?: string;
  /** Override the spawn function (tests). Default: `child_process.spawn`. */
  spawn?: FfmpegSpawn;
  /** Override the global library root for `global:` srcs (tests). */
  globalLibraryRoot?: string;
  /** Inject the stat used for hashing (tests). Default: `fs.statSync`. */
  statFile?: (path: string) => FileStat;
  /** Progress callback; a throw here never aborts the extraction. */
  onProgress?: (info: FrameExtractProgress) => void;
}

export interface PreExtractResult {
  /** The cache root used. */
  root: string;
  /** Entries keyed by spec hash, parallel to {@link collectVideoExtractSpecs}. */
  entries: Map<string, FrameCacheEntry>;
  /** Total bytes resident in the cache after pruning. */
  cacheBytes: number;
  /** Cache entry hashes evicted by the LRU prune this run. */
  pruned: string[];
}

/**
 * Materialise a PNG sequence for every distinct video clip in the composition,
 * reusing cached entries where possible, then prune the cache to its byte
 * budget. Returns one {@link FrameCacheEntry} per distinct spec.
 *
 * @throws {Error} on a bad asset reference (see {@link collectVideoExtractSpecs})
 *   or when ffmpeg fails / produces no frames for a clip.
 */
export async function preExtractVideoFrames(
  comp: Composition,
  opts: PreExtractOptions = {},
): Promise<PreExtractResult> {
  const specs = collectVideoExtractSpecs(comp, {
    ...(opts.globalLibraryRoot !== undefined
      ? { globalLibraryRoot: opts.globalLibraryRoot }
      : {}),
    ...(opts.statFile !== undefined ? { statFile: opts.statFile } : {}),
  });

  const root = opts.cacheRoot ?? defaultFrameCacheRoot();
  const maxBytes = opts.maxBytes ?? DEFAULT_CACHE_MAX_BYTES;
  const entries = new Map<string, FrameCacheEntry>();

  // Best-effort sweep of `.tmp-*` dirs orphaned by a crashed/killed
  // extraction (R-12) before doing any new work. Age-gated so a concurrent
  // render's own in-flight staging dir is never touched; never fails the run.
  await sweepOrphanExtractDirs(root).catch(() => undefined);

  if (specs.length === 0) {
    return { root, entries, cacheBytes: 0, pruned: [] };
  }

  await mkdir(root, { recursive: true });

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const dir = join(root, spec.hash);
    const expectedFrames =
      spec.duration !== undefined
        ? Math.max(1, Math.round(spec.duration * fpsValue(spec.fps)))
        : undefined;

    // ── Cache hit: a complete meta marker means the PNGs are already here. ──
    const hitMeta = await readMetaIfComplete(join(dir, META_FILENAME));
    if (hitMeta) {
      await touchAccessed(join(dir, META_FILENAME), hitMeta);
      const entry: FrameCacheEntry = {
        hash: spec.hash,
        dir,
        frameCount: hitMeta.frameCount,
        // Older cache entries may predate width/height in meta.json — fall
        // back to the spec's resolution (identical, since the hash pins it).
        width: hitMeta.width || spec.width,
        height: hitMeta.height || spec.height,
        bytes: hitMeta.bytes,
        itemIds: spec.itemIds,
        cached: true,
      };
      entries.set(spec.hash, entry);
      report(opts, {
        spec: i + 1,
        totalSpecs: specs.length,
        hash: spec.hash,
        itemIds: spec.itemIds,
        frame: hitMeta.frameCount,
        totalFrames: hitMeta.frameCount,
        cached: true,
      });
      continue;
    }

    // ── Cache miss: extract into a private temp dir, then publish atomically. ─
    const tmpDir = join(root, `.tmp-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });
    try {
      report(opts, {
        spec: i + 1,
        totalSpecs: specs.length,
        hash: spec.hash,
        itemIds: spec.itemIds,
        frame: 0,
        totalFrames: expectedFrames,
        cached: false,
      });

      await runExtraction(spec, tmpDir, opts, (frame) => {
        report(opts, {
          spec: i + 1,
          totalSpecs: specs.length,
          hash: spec.hash,
          itemIds: spec.itemIds,
          frame,
          totalFrames: expectedFrames,
          cached: false,
        });
      });

      const frames = await listPngFrames(tmpDir);
      if (frames.length === 0) {
        throw new Error(
          `ffmpeg produced no frames for video asset "${spec.assetId}" ` +
            `(${spec.width}x${spec.height} @ ${spec.fps}fps).`,
        );
      }
      const bytes = await sumFrameBytes(tmpDir, frames);
      // The true frame size (drives `fit`): ffmpeg's `-2` rounding, or an
      // unprobed asset, can leave the spec's prediction off — trust the PNG.
      const dims = (await readPngSize(join(tmpDir, frames[0]!))) ?? {
        width: spec.width,
        height: spec.height,
      };
      const now = Date.now();
      const meta: CacheMeta = {
        hash: spec.hash,
        src: spec.srcPath,
        trimIn: spec.trimIn,
        trimOut: spec.trimOut ?? null,
        fps: spec.fps,
        width: dims.width,
        height: dims.height,
        frameCount: frames.length,
        bytes,
        createdAt: now,
        accessedAt: now,
      };
      await writeFile(join(tmpDir, META_FILENAME), JSON.stringify(meta));

      // Publish: drop any stale/partial dir at the target, then rename. rename
      // is atomic on the same filesystem, so a hit can never observe a partial.
      await rm(dir, { recursive: true, force: true });
      await rename(tmpDir, dir);

      const entry: FrameCacheEntry = {
        hash: spec.hash,
        dir,
        frameCount: frames.length,
        width: dims.width,
        height: dims.height,
        bytes,
        itemIds: spec.itemIds,
        cached: false,
      };
      entries.set(spec.hash, entry);
      report(opts, {
        spec: i + 1,
        totalSpecs: specs.length,
        hash: spec.hash,
        itemIds: spec.itemIds,
        frame: frames.length,
        totalFrames: expectedFrames ?? frames.length,
        cached: false,
      });
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true });
      throw err;
    }
  }

  const usage = await pruneCache(root, maxBytes);
  return {
    root,
    entries,
    cacheBytes: usage.bytes,
    pruned: usage.prunedHashes,
  };
}

async function runExtraction(
  spec: VideoExtractSpec,
  tmpDir: string,
  opts: PreExtractOptions,
  onFrame: (frame: number) => void,
): Promise<void> {
  const pattern = join(tmpDir, "%05d.png");
  const args = buildExtractArgs(spec, pattern);
  const ffmpegPath = opts.ffmpegPath ?? (await resolveFfmpeg());
  const spawnFn = opts.spawn ?? defaultExtractSpawn;
  const ffmpeg = spawnFn(ffmpegPath, args);

  // stdout carries `-progress` key=value blocks; pick out the running frame.
  let lastFrame = 0;
  if (ffmpeg.stdout) {
    ffmpeg.stdout.setEncoding("utf8");
    ffmpeg.stdout.on("data", (chunk: string) => {
      for (const m of chunk.matchAll(/frame=\s*(\d+)/g)) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n >= lastFrame) lastFrame = n;
      }
      onFrame(lastFrame);
    });
  }

  let stderrTail = "";
  if (ffmpeg.stderr) {
    ffmpeg.stderr.setEncoding("utf8");
    ffmpeg.stderr.on("data", (chunk: string) => {
      stderrTail += chunk;
      if (stderrTail.length > STDERR_TAIL_BYTES) {
        stderrTail = stderrTail.slice(-STDERR_TAIL_BYTES);
      }
    });
  }

  // Extraction reads from a file input, not stdin — close it so ffmpeg sees
  // EOF immediately (and the test fake, which keys close off stdin end, fires).
  ffmpeg.stdin?.end();

  const [code, signal] = (await once(ffmpeg, "close")) as [
    number | null,
    NodeJS.Signals | null,
  ];
  if (code !== 0) {
    const tail = stderrTail.trim();
    const reason =
      code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
    throw new Error(
      `ffmpeg (extract) exited with ${reason}${tail ? `:\n${tail}` : ""}`,
    );
  }
}

// ───────────────────────────── cache meta / LRU ────────────────────────────

interface CacheMeta {
  hash: string;
  src: string;
  trimIn: number;
  trimOut: number | null;
  fps: Fps;
  width: number;
  height: number;
  frameCount: number;
  bytes: number;
  createdAt: number;
  accessedAt: number;
}

export interface CacheUsage {
  /** Total bytes resident across all complete entries (after pruning). */
  bytes: number;
  /** Number of complete entries remaining. */
  entries: number;
  /** Hashes evicted by this prune call. */
  prunedHashes: string[];
}

/**
 * Evict least-recently-accessed cache entries until the cache fits `maxBytes`.
 * Incomplete dirs (missing/invalid meta) and in-flight `.tmp-*` dirs are
 * ignored. Returns the post-prune usage. Safe to call when the root is absent.
 */
export async function pruneCache(
  root: string,
  maxBytes: number,
): Promise<CacheUsage> {
  const entries = await readAllEntries(root);
  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  if (total <= maxBytes) {
    return { bytes: total, entries: entries.length, prunedHashes: [] };
  }

  // Oldest access first — classic LRU eviction order.
  entries.sort((a, b) => a.accessedAt - b.accessedAt);
  const prunedHashes: string[] = [];
  let remaining = entries.length;
  for (const entry of entries) {
    if (total <= maxBytes) break;
    await rm(entry.dir, { recursive: true, force: true });
    total -= entry.bytes;
    remaining -= 1;
    prunedHashes.push(entry.hash);
  }
  return { bytes: total, entries: remaining, prunedHashes };
}

interface CacheEntryOnDisk {
  hash: string;
  dir: string;
  bytes: number;
  accessedAt: number;
}

async function readAllEntries(root: string): Promise<CacheEntryOnDisk[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return []; // root not created yet
  }
  const out: CacheEntryOnDisk[] = [];
  for (const name of names) {
    if (name.startsWith(".tmp-")) continue;
    const dir = join(root, name);
    const meta = await readMetaIfComplete(join(dir, META_FILENAME));
    if (!meta) continue;
    out.push({
      hash: meta.hash,
      dir,
      bytes: meta.bytes,
      accessedAt: meta.accessedAt,
    });
  }
  return out;
}

async function readMetaIfComplete(
  metaPath: string,
): Promise<CacheMeta | undefined> {
  let raw: string;
  try {
    raw = await readFile(metaPath, "utf8");
  } catch {
    return undefined; // no marker ⇒ no (complete) entry
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CacheMeta>;
    if (
      typeof parsed.frameCount === "number" &&
      parsed.frameCount > 0 &&
      typeof parsed.bytes === "number" &&
      parsed.bytes >= 0
    ) {
      return {
        accessedAt: Date.now(),
        createdAt: Date.now(),
        hash: "",
        src: "",
        trimIn: 0,
        trimOut: null,
        fps: 0,
        width: 0,
        height: 0,
        ...parsed,
      } as CacheMeta;
    }
  } catch {
    // Corrupt marker — treat as a miss so the next run re-extracts cleanly.
  }
  return undefined;
}

async function touchAccessed(metaPath: string, meta: CacheMeta): Promise<void> {
  try {
    await writeFile(
      metaPath,
      JSON.stringify({ ...meta, accessedAt: Date.now() }),
    );
  } catch {
    // Best effort — a failed touch only skews LRU ordering, never correctness.
  }
}

async function listPngFrames(dir: string): Promise<string[]> {
  const names = await readdir(dir);
  return names.filter((n) => n.toLowerCase().endsWith(".png")).sort();
}

/**
 * Width/height from a PNG's IHDR chunk (bytes 16–23, big-endian), or undefined
 * when the file is not a readable PNG. Avoids decoding the image.
 */
export async function readPngSize(
  path: string,
): Promise<{ width: number; height: number } | undefined> {
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch {
    return undefined;
  }
  if (
    buf.length < 24 ||
    buf.readUInt32BE(0) !== 0x89504e47 ||
    buf.toString("latin1", 12, 16) !== "IHDR"
  ) {
    return undefined;
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

async function sumFrameBytes(dir: string, frames: string[]): Promise<number> {
  let total = 0;
  for (const name of frames) {
    try {
      total += (await stat(join(dir, name))).size;
    } catch {
      // A frame that vanished between listing and stat is non-fatal accounting.
    }
  }
  return total;
}

// ───────────────────────────── binary / paths ──────────────────────────────

/**
 * Frame-cache root: `$DAVIDUP_CACHE/frames` when set, else
 * `~/.davidup/cache/frames` — sibling of the global library root.
 */
export function defaultFrameCacheRoot(): string {
  const override = process.env.DAVIDUP_CACHE;
  if (override && override.length > 0) return join(override, "frames");
  return join(nodeOs.homedir(), ".davidup", "cache", "frames");
}

// ───────────────────────────── small helpers ───────────────────────────────

function defaultStatFile(path: string): FileStat {
  const s = statSync(path);
  return { mtimeMs: s.mtimeMs, size: s.size };
}

function defaultExtractSpawn(
  cmd: string,
  args: ReadonlyArray<string>,
): ChildProcess {
  // stdin ignored (file input), stdout piped for `-progress`, stderr for errors.
  return nodeSpawn(cmd, args as string[], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function report(opts: PreExtractOptions, info: FrameExtractProgress): void {
  if (!opts.onProgress) return;
  try {
    opts.onProgress(info);
  } catch {
    // A throwing progress callback must not kill the extraction.
  }
}

/**
 * Format a seconds value for an ffmpeg argument: fixed-point (never
 * exponential, which ffmpeg rejects), trailing zeros trimmed.
 */
/** `fps=` filter value: exact "N/D" for a rational, the trimmed decimal otherwise. */
function fmtFps(fps: Fps): string {
  if (typeof fps === "number") return fmtSeconds(fps);
  const { num, den } = fpsRational(fps);
  return `${num}/${den}`;
}

function fmtSeconds(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 1e6) / 1e6;
  let s = rounded.toFixed(6).replace(/\.?0+$/, "");
  if (s === "" || s === "-0") s = "0";
  return s;
}
