// Server render driver — skia-canvas + ffmpeg subprocess (per design-doc §5.6, §6).
//
// Pipeline per frame:
//   1. clearRect — single Canvas reused across the whole render (per §5.7).
//   2. renderFrame(comp, t, ctx) — engine paints into skia's Canvas2D.
//   3. canvas.toBuffer('raw') — RGBA bytes, fed straight into ffmpeg stdin.
//   4. backpressure: when stdin.write returns false, await 'drain' before the
//      next frame so a slow encoder cannot let the buffer grow without bound.
//
// Before any rendering, the driver runs `precompile()` (COMPOSITION_PRIMITIVES
// §10.3) so callers can hand authored v0.2 JSON containing `$ref` / `$behavior`
// markers directly. For canonical v0.1 input the precompile call is a no-op.
//
// skia-canvas is lazy-imported (indirect specifier) so this module is safe to
// reference from environments where the native binary is absent — tests inject
// a fake module to exercise behaviour without the dependency.

import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { Writable } from "node:stream";

import {
  NodeAssetLoader,
  withBundledAssets,
  type AssetLoader,
  type SkiaCanvasModule,
} from "../../assets/index.js";
import { precompile, synthesizeVideoAudio } from "../../compose/index.js";
import type { ReadFile } from "../../compose/imports.js";
import { indexTweens, prepareVideoFrames, renderFrame } from "../../engine/index.js";
import type {
  Canvas2DContext,
  OffscreenSurface,
  VideoClip,
  VideoFrameProvider,
  VideoFrameRequest,
} from "../../engine/types.js";
import { fpsArg, fpsRational, frameTime, framesForDuration } from "../../schema/fps.js";
import type { Composition } from "../../schema/types.js";
import { compositionHasAudio, muxAudioTracks } from "./audioMux.js";
import { resolveFfmpeg, sweepOrphanTempVideos } from "./ffmpeg.js";
import {
  compositionHasVideo,
  preExtractVideoFrames,
  type FrameCacheEntry,
  type FrameExtractProgress,
  type PreExtractResult,
} from "./videoExtract.js";

export {
  probeAudio,
  probeVideo,
  probeVideoSync,
  pixelFormatHasAlpha,
  resolveFfprobePath,
  FfprobeUnavailableError,
  type AudioMetadata,
  type VideoMetadata,
  type ProbeAudioOptions,
  type ProbeVideoOptions,
  type ProbeVideoSyncOptions,
  type ProbeSpawn,
  type ProbeSpawnSync,
  type ProbeSpawnSyncResult,
} from "./ffprobe.js";

export {
  buildAudioFilterComplex,
  buildLoudnormAnalysisArgs,
  buildLoudnormAnalysisFilterComplex,
  buildMuxArgs,
  compositionHasAudio,
  muxAudioTracks,
  parseLoudnormMeasurement,
  resolveAudioInputs,
  secs as formatFilterSeconds,
  MUX_SAMPLE_RATE,
  MUX_AUDIO_BITRATE,
  MUX_LIMITER_CEILING_DB,
  MUX_LOUDNORM_LRA,
  MUX_LOUDNORM_TRUE_PEAK,
  type BuildMuxArgsInput,
  type LoudnormMeasurement,
  type MuxAudioOptions,
  type ResolvedAudioTrack,
} from "./audioMux.js";

export {
  alphaDecoderFor,
  buildExtractArgs,
  collectVideoExtractSpecs,
  compositionHasVideo,
  computeSpecHash,
  defaultFrameCacheRoot,
  preExtractVideoFrames,
  pruneCache,
  readPngSize,
  resolveExtractDimensions,
  DEFAULT_CACHE_MAX_BYTES,
  VIDEO_EXTRACTION_VERSION,
  type CacheUsage,
  type CollectSpecsOptions,
  type ExtractDimensions,
  type FileStat,
  type FrameCacheEntry,
  type FrameExtractProgress,
  type PreExtractOptions,
  type PreExtractResult,
  type VideoExtractSpec,
  type VideoProbeHint,
} from "./videoExtract.js";

export {
  resolveFfmpeg,
  sweepOrphanExtractDirs,
  sweepOrphanTempVideos,
  DEFAULT_ORPHAN_MAX_AGE_MS,
  EXTRACT_TMP_PREFIX,
  TEMP_VIDEO_PREFIX,
  type SweepOptions,
  type SweepResult,
} from "./ffmpeg.js";

export interface SkiaCanvasInstance {
  getContext(kind: "2d"): Canvas2DContext;
  toBuffer(format: "raw" | "png"): Promise<Uint8Array> | Uint8Array;
}

export interface SkiaDriverModule extends SkiaCanvasModule {
  Canvas: new (width: number, height: number) => SkiaCanvasInstance;
}

export type FfmpegSpawn = (cmd: string, args: ReadonlyArray<string>) => ChildProcess;

export interface RenderToFileOptions {
  /**
   * Video encoder. `libx264` (default) / `libx265` are opaque; `prores_ks`
   * (ProRes 4444, `yuva444p10le`, `.mov`) and `libvpx-vp9` (`yuva420p`,
   * `.webm`) carry the canvas alpha channel (v1.1 S9). The output extension
   * must suit the codec — see {@link checkContainerCodec}.
   */
  codec?: VideoCodec;
  /** Quality for x264 / x265 / VP9. ProRes is profile-driven and ignores it. */
  crf?: number;
  /** x264 / x265 preset. Ignored by ProRes and VP9. */
  preset?: string;
  /** Output pixel format. Default depends on the codec (see {@link defaultPixFmt}). */
  pixFmt?: string;
  ffmpegPath?: string;
  movflagsFaststart?: boolean;
  /**
   * Output colour tagging (v1.1 S8). `"bt709"` (default) pins the RGB→YUV
   * conversion to the BT.709 matrix at TV range and tags the stream
   * (`colorspace`/`color_primaries`/`color_trc`/`color_range`) to match, so
   * NLEs and players don't guess. `"untagged"` restores the pre-1.1 argv:
   * swscale's implicit BT.601 matrix with no colour metadata.
   */
  colorProfile?: ColorProfile;

  /**
   * Path of the file the composition was loaded from. Required only when the
   * composition contains `$ref` markers — relative refs resolve against this
   * file's directory (COMPOSITION_PRIMITIVES.md §5.3).
   */
  sourcePath?: string;
  /**
   * Custom file reader used by the `$ref` resolver. Defaults to
   * `fs/promises#readFile` with utf-8 encoding.
   */
  readFile?: ReadFile;

  // Injection points (primarily for tests; production callers leave unset).
  skiaCanvas?: SkiaDriverModule;
  loader?: AssetLoader;
  spawn?: FfmpegSpawn;

  /**
   * Optional progress callback invoked after each frame is encoded. `frame`
   * is the 1-based count of frames written so far; `total` is `frameCount(comp)`.
   * Editor / SaaS callers wire this into an SSE channel; CLI callers ignore it.
   */
  onProgress?: (info: { frame: number; total: number }) => void;

  /**
   * Video frame pre-extraction (v0.2 §S7). Before encoding, every distinct
   * video clip is extracted to a cached PNG sequence (drawing from it is §S8).
   * Enabled by default whenever the composition contains video items; pass
   * `false` to skip it, or an object to configure the cache. ffmpeg path /
   * spawn are inherited from the top-level options.
   */
  preExtract?: false | PreExtractRenderOptions;

  /**
   * Render only `[from, to)` of the timeline, in seconds (v1.1 S12). Both ends
   * are clamped to `[0, duration]`; the first frame is the one at or before
   * `from` and `ceil((to − from) × fps)` frames are written. Audio tracks are
   * cut to the same window. Omitted = the whole composition.
   */
  range?: RenderRange;
  /**
   * `"video"` (default) encodes through ffmpeg. `"png-sequence"` writes one
   * PNG per frame instead (no ffmpeg, no audio): `outPath` is either a
   * printf-style pattern ending in `%0Nd.png` or a directory, which gets
   * `%05d.png`. Frames are numbered from 1. An `outPath` ending in
   * `%0Nd.png` selects the sequence even without this option.
   */
  format?: RenderFormat;
}

export interface RenderRange {
  /** Start of the window in seconds (inclusive). Default 0. */
  from?: number;
  /** End of the window in seconds (exclusive). Default the composition duration. */
  to?: number;
}

export type RenderFormat = "video" | "png-sequence";

const PNG_SEQUENCE_RE = /%(?:0(\d+))?d\.png$/i;

/** True when `outPath` is a PNG-sequence pattern such as `frames/%05d.png`. */
export function isPngSequencePath(outPath: string): boolean {
  return PNG_SEQUENCE_RE.test(outPath);
}

/** File name of 1-based frame `n` in a `%0Nd.png` pattern. */
export function pngSequenceFramePath(pattern: string, n: number): string {
  return pattern.replace(PNG_SEQUENCE_RE, (_m, width: string | undefined) =>
    `${String(n).padStart(width !== undefined ? Number(width) : 0, "0")}.png`,
  );
}

/**
 * Frame window a {@link RenderRange} covers: `startFrame` (0-based index into
 * the full timeline) and `frameCount` frames. Throws `RangeError` for a
 * non-finite bound or a window that is empty after clamping.
 */
export function resolveRenderRange(
  comp: Composition,
  range: RenderRange | undefined,
): { startFrame: number; frameCount: number } {
  const total = frameCount(comp);
  if (range === undefined) return { startFrame: 0, frameCount: total };
  const { duration, fps } = comp.composition;
  const from = range.from ?? 0;
  const to = range.to ?? duration;
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new RangeError(`render range must be finite seconds (got ${from}..${to})`);
  }
  const lo = Math.min(Math.max(from, 0), duration);
  const hi = Math.min(Math.max(to, 0), duration);
  if (hi <= lo) {
    throw new RangeError(
      `render range ${from}..${to} is empty within the composition's 0..${duration}s`,
    );
  }
  const { num, den } = fpsRational(fps);
  // Frame-align down: the first frame shown at `from`. The 1e-9 absorbs float
  // noise so 1.0 s @ 30 fps is frame 30, not 29.
  const startFrame = Math.min(total - 1, Math.floor((lo * num) / den + 1e-9));
  // Same epsilon on the length: (1.6 − 1) × 5 is 3.0000000000000004, not 4 frames.
  const count = Math.max(1, Math.ceil(((hi - lo) * num) / den - 1e-9));
  return { startFrame, frameCount: Math.min(count, total - startFrame) };
}

export type VideoCodec = "libx264" | "libx265" | "prores_ks" | "libvpx-vp9";
export const VIDEO_CODECS: readonly VideoCodec[] = [
  "libx264",
  "libx265",
  "prores_ks",
  "libvpx-vp9",
];
/** Codecs whose output keeps the canvas alpha channel (v1.1 S9). */
export const ALPHA_CODECS: readonly VideoCodec[] = ["prores_ks", "libvpx-vp9"];

/** Container extension a codec is written to when the caller names none. */
export function defaultContainerExtension(codec: VideoCodec = "libx264"): string {
  if (codec === "prores_ks") return ".mov";
  if (codec === "libvpx-vp9") return ".webm";
  return ".mp4";
}

/** Pixel format used when `pixFmt` is not given. */
export function defaultPixFmt(codec: VideoCodec = "libx264"): string {
  if (codec === "prores_ks") return "yuva444p10le";
  if (codec === "libvpx-vp9") return "yuva420p";
  return "yuv420p";
}

/**
 * Container/codec compatibility (v1.1 S9, `E_CONTAINER_CODEC`). ProRes 4444
 * must go to `.mov` and VP9-with-alpha to `.webm`; WebM cannot hold H.264 /
 * H.265. Returns an error message, or `undefined` when the pairing is fine.
 * A path without an extension is not checked (callers that append one use
 * {@link defaultContainerExtension}).
 */
export function checkContainerCodec(
  outPath: string,
  codec: VideoCodec = "libx264",
): string | undefined {
  const ext = extname(outPath).toLowerCase();
  if (ext === "") return undefined;
  const want = defaultContainerExtension(codec);
  const mismatch = ALPHA_CODECS.includes(codec) ? ext !== want : ext === ".webm";
  if (mismatch) {
    return `codec ${codec} cannot be written to a ${ext} file (use ${want})`;
  }
  return undefined;
}

/** Thrown by {@link renderToFile} for invalid render options, before any work. */
export class RenderOptionsError extends Error {
  readonly code = "E_CONTAINER_CODEC" as const;
  constructor(message: string) {
    super(message);
    this.name = "RenderOptionsError";
  }
}

export type ColorProfile = "bt709" | "untagged";
export const COLOR_PROFILES: readonly ColorProfile[] = ["bt709", "untagged"];

export interface PreExtractRenderOptions {
  /** Cache root. Default: `$DAVIDUP_CACHE/frames` or `~/.davidup/cache/frames`. */
  cacheRoot?: string;
  /** LRU byte budget. Default 5 GB. */
  maxBytes?: number;
  /** Per-frame progress for the extraction phase (distinct from `onProgress`). */
  onExtractProgress?: (info: FrameExtractProgress) => void;
  /**
   * Cap on decoded frames held in memory per clip while rendering (v1.1 S6).
   * Default {@link DEFAULT_MAX_DECODED_FRAMES}.
   */
  maxDecodedFrames?: number;
}

export interface RenderToFileResult {
  outputPath: string;
  durationMs: number;
  frameCount: number;
}

const STDERR_TAIL_BYTES = 4096;

export async function renderToFile(
  comp: Composition,
  outPath: string,
  opts: RenderToFileOptions = {},
): Promise<RenderToFileResult> {
  const startedAt = nowMs();
  const pngSequence = opts.format === "png-sequence" || isPngSequencePath(outPath);
  if (!pngSequence) {
    const containerError = checkContainerCodec(outPath, opts.codec);
    if (containerError !== undefined) throw new RenderOptionsError(containerError);
  }
  // v1.1 S11: `keepAudio` video items become ordinary `audio[]` tracks here,
  // after precompile, so the mux below picks them up (see compose/videoAudio.ts
  // for why this isn't a precompile pass).
  const compiled = synthesizeVideoAudio(
    await precompile(comp, {
      ...(opts.sourcePath !== undefined ? { sourcePath: opts.sourcePath } : {}),
      ...(opts.readFile !== undefined ? { readFile: opts.readFile } : {}),
    }),
  ) as Composition;
  // Resolve the frame window before any expensive work so a bad range fails fast.
  const { startFrame, frameCount: totalFrames } = resolveRenderRange(compiled, opts.range);
  const skia = opts.skiaCanvas ?? (await importSkiaCanvas());
  const loader = opts.loader ?? new NodeAssetLoader({ skiaCanvas: skia });

  await loader.preloadAll(withBundledAssets(compiled));

  // Pre-extract phase (v0.2 §S7) + frame binding (§S8): materialise/refresh the
  // cached PNG sequence for every distinct video clip, then bind those frames
  // to a VideoFrameProvider that decodes a bounded window ahead of the loop. Skipped entirely when the
  // composition has no video items (zero behaviour change for the pre-S5 path)
  // or when the caller opts out with `preExtract: false`.
  let videoProvider: VideoFrameProvider | undefined;
  if (opts.preExtract !== false && compositionHasVideo(compiled)) {
    const pe = typeof opts.preExtract === "object" ? opts.preExtract : {};
    const peResult = await preExtractVideoFrames(compiled, {
      ...(pe.cacheRoot !== undefined ? { cacheRoot: pe.cacheRoot } : {}),
      ...(pe.maxBytes !== undefined ? { maxBytes: pe.maxBytes } : {}),
      ...(pe.onExtractProgress !== undefined
        ? { onProgress: pe.onExtractProgress }
        : {}),
      ...(opts.ffmpegPath !== undefined ? { ffmpegPath: opts.ffmpegPath } : {}),
      ...(opts.spawn !== undefined ? { spawn: opts.spawn } : {}),
    });
    videoProvider = await buildVideoFrameProvider(peResult, skia, {
      ...(pe.maxDecodedFrames !== undefined
        ? { maxDecodedFrames: pe.maxDecodedFrames }
        : {}),
    });
  }

  const meta = compiled.composition;
  const canvas = new skia.Canvas(meta.width, meta.height);
  const ctx = canvas.getContext("2d");
  const tweenIndex = indexTweens(compiled);
  const createOffscreen = (w: number, h: number): OffscreenSurface => {
    const off = new skia.Canvas(w, h);
    return { context: off.getContext("2d"), source: off };
  };

  const paintFrame = async (i: number): Promise<void> => {
    const t = frameTime(startFrame + i, meta.fps);
    await prepareVideoFrames(compiled, t, videoProvider);
    ctx.clearRect(0, 0, meta.width, meta.height);
    renderFrame(compiled, t, ctx, {
      assets: loader,
      index: tweenIndex,
      createOffscreen,
      ...(videoProvider !== undefined ? { video: videoProvider } : {}),
    });
  };
  const reportProgress = async (frame: number): Promise<void> => {
    if (!opts.onProgress) return;
    try {
      opts.onProgress({ frame, total: totalFrames });
    } catch {
      // A throwing progress callback must not kill the render.
    }
    // Yield to the libuv loop so SSE / IPC writes posted by the
    // progress callback actually flush before we start painting the
    // next frame. Without this, on small/fast renders the entire loop
    // serialises in one microtask burst and observers only see the
    // terminal state. Cost: one macrotask per frame.
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  // PNG sequence (v1.1 S12): encode each frame with skia and write it straight
  // to disk — no ffmpeg, no audio.
  if (pngSequence) {
    const pattern = isPngSequencePath(outPath) ? outPath : join(outPath, "%05d.png");
    await mkdir(dirname(pattern), { recursive: true });
    for (let i = 0; i < totalFrames; i++) {
      await paintFrame(i);
      const png = await Promise.resolve(canvas.toBuffer("png"));
      await writeFile(pngSequenceFramePath(pattern, i + 1), toNodeBuffer(png));
      await reportProgress(i + 1);
    }
    return {
      outputPath: pattern,
      durationMs: nowMs() - startedAt,
      frameCount: totalFrames,
    };
  }

  // Two-stage pipeline (v0.2 §S4): when the composition declares audio tracks,
  // stage 1 encodes the silent video to a temp file and stage 2 muxes the audio
  // into the real output (`-c:v copy`, zero re-encode). Without audio it's the
  // single-stage encode straight to `outPath`, byte-for-byte as before.
  // Best-effort cleanup of orphaned stage-1 temp videos left by a prior
  // crashed/killed render into this output directory (R-12) — scoped to
  // `dirname(outPath)` since these files have no fixed cache root. Never
  // blocks or fails the current render.
  await sweepOrphanTempVideos(dirname(outPath)).catch(() => undefined);

  const hasAudio = compositionHasAudio(compiled);
  // The silent temp video shares the final container so `-c:v copy` into it
  // is always legal (ProRes → .mov, VP9 → .webm).
  const tempVideoPath = hasAudio
    ? join(
        dirname(outPath),
        `.davidup-tmpvideo-${randomUUID()}${extname(outPath) || defaultContainerExtension(opts.codec)}`,
      )
    : outPath;

  // faststart on the silent temp video is wasted work — it's re-muxed away.
  // Apply it (when requested) to the final muxed output instead.
  const stage1Opts: RenderToFileOptions = hasAudio
    ? { ...opts, movflagsFaststart: false }
    : opts;
  const args = buildFfmpegArgs(compiled, tempVideoPath, stage1Opts);
  const spawnFn = opts.spawn ?? defaultSpawn;
  const ffmpegPath = opts.ffmpegPath ?? (await resolveFfmpeg());
  const ffmpeg = spawnFn(ffmpegPath, args);

  const stdin = ffmpeg.stdin;
  if (!stdin) {
    throw new Error("ffmpeg subprocess has no stdin");
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

  // Race-aware close + stdin error so the loop bails fast on ffmpeg crashes
  // (e.g. EPIPE from a missing codec) rather than hanging on the next drain.
  const closePromise = waitForClose(ffmpeg);
  let stdinErrored: Error | undefined;
  stdin.on("error", (err) => {
    stdinErrored = err as Error;
  });

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (stdinErrored) throw stdinErrored;
      await paintFrame(i);
      const raw = await Promise.resolve(canvas.toBuffer("raw"));
      const buf = toNodeBuffer(raw);
      const ok = stdin.write(buf);
      if (!ok) await waitForDrain(stdin);
      await reportProgress(i + 1);
    }
  } catch (err) {
    safeKill(ffmpeg);
    if (hasAudio) await safeUnlink(tempVideoPath);
    throw err;
  }

  stdin.end();
  const { code, signal } = await closePromise;
  if (code !== 0) {
    const tail = stderrTail.trim();
    // `code === null` happens when ffmpeg is killed by a signal (e.g. SIGABRT
    // from a missing dynamic library) — we must surface that as a failure
    // rather than silently treat it as success.
    const reason = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
    // Best-effort cleanup of the silent temp video on a stage-1 failure too.
    if (hasAudio) await safeUnlink(tempVideoPath);
    throw new Error(
      `ffmpeg exited with ${reason}${tail ? `:\n${tail}` : ""}`,
    );
  }

  // Stage 2: mux the declared audio tracks onto the silent temp video.
  if (hasAudio) {
    try {
      await muxAudioTracks(compiled, tempVideoPath, outPath, frameTime(totalFrames, meta.fps), {
        // Default faststart on the final MP4 unless the caller opted out.
        movflagsFaststart: opts.movflagsFaststart ?? true,
        // A ranged render hears the timeline from its first frame (v1.1 S12).
        ...(startFrame > 0 ? { timelineOffset: frameTime(startFrame, meta.fps) } : {}),
        ...(opts.ffmpegPath !== undefined ? { ffmpegPath: opts.ffmpegPath } : {}),
        ...(opts.spawn !== undefined ? { spawn: opts.spawn } : {}),
      });
    } finally {
      await safeUnlink(tempVideoPath);
    }
  }

  return {
    outputPath: outPath,
    durationMs: nowMs() - startedAt,
    frameCount: totalFrames,
  };
}

export function buildFfmpegArgs(
  comp: Composition,
  outPath: string,
  opts: RenderToFileOptions,
): string[] {
  // Canonical pipeline from design-doc §6. Keep the input/output flag pairing
  // intact: ordering matters to ffmpeg.
  const meta = comp.composition;
  const args: string[] = [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${meta.width}x${meta.height}`,
    "-r",
    fpsArg(meta.fps),
    "-i",
    "pipe:0",
  ];
  if ((opts.colorProfile ?? "bt709") === "bt709") {
    // v1.1 S8: without an explicit matrix swscale converts RGB→YUV with
    // BT.601 coefficients, so tagging alone would lie about the pixels. Pin
    // the math, then tag the stream to match (encoder VUI + mp4 `colr`).
    args.push(
      "-vf",
      "scale=out_color_matrix=bt709:out_range=tv",
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-color_range",
      "tv",
    );
  }
  const codec = opts.codec ?? "libx264";
  args.push("-c:v", codec);
  if (codec === "prores_ks") {
    // v1.1 S9: ProRes 4444 with a 16-bit alpha plane. `apl0` vendor tag so
    // Apple tools treat it as native ProRes.
    args.push("-profile:v", "4444", "-vendor", "apl0");
  } else if (codec === "libvpx-vp9") {
    // Constant-quality VP9 (`-b:v 0` makes `-crf` the only rate control);
    // yuva420p makes libvpx write the alpha plane as a WebM side channel.
    args.push("-crf", String(opts.crf ?? 18), "-b:v", "0");
  } else {
    args.push("-preset", opts.preset ?? "medium", "-crf", String(opts.crf ?? 18));
  }
  args.push(
    "-pix_fmt",
    opts.pixFmt ?? defaultPixFmt(codec),
    // R-16: `+bitexact` on both the muxer (`-fflags`) and the video encoder
    // (`-flags:v`) strips wall-clock-derived container fields
    // (`creation_time`/`modification_time` in `mvhd`/`mdhd`) and the
    // libx264-version tag string that otherwise vary between two encodes of
    // identical input — output-file options so they bind to the mp4 muxer,
    // per ffmpeg's documented bitexact idiom. Scopes the "byte-identical
    // MP4" claim to what's actually reproducible; see
    // bitexact.integration.test.ts.
    "-fflags",
    "+bitexact",
    "-flags:v",
    "+bitexact",
  );
  // `-movflags` is an mp4/mov muxer option; the WebM muxer rejects it.
  if (opts.movflagsFaststart && extname(outPath).toLowerCase() !== ".webm") {
    args.push("-movflags", "+faststart");
  }
  args.push(outPath);
  return args;
}

export function frameCount(comp: Composition): number {
  // Match the design-doc reference: ceil(duration * fps). Always at least one
  // frame so a zero-duration composition still produces a valid (1-frame) clip.
  const { duration, fps } = comp.composition;
  return Math.max(1, framesForDuration(duration, fps));
}

/** Default cap on decoded frames resident per clip (v1.1 S6). */
export const DEFAULT_MAX_DECODED_FRAMES = 64;
/** Frames kept behind the current one (a re-render / small seek back is free). */
const WINDOW_BEHIND = 2;
/** Frames decoded ahead of the current one. */
const WINDOW_AHEAD = 16;
/** Parallel background decodes per clip. */
const PREFETCH_CONCURRENCY = 4;

export interface VideoFrameProviderOptions {
  /**
   * Upper bound on decoded frames held per clip (default
   * {@link DEFAULT_MAX_DECODED_FRAMES}). Only exceeded when more items sharing
   * one clip draw distinct frames at the same instant than this allows.
   */
  maxDecodedFrames?: number;
}

/**
 * Build the render-time {@link VideoFrameProvider} (v0.2 §S8) from a pre-extract
 * result, mapping each composition video-item id to a {@link VideoClip} backed
 * by the cached PNGs (`<dir>/00001.png`, …).
 *
 * Decoding is a bounded sliding window (v1.1 S6), not eager: `renderFrame`
 * draws synchronously, so callers await `prepareVideoFrames(comp, t, provider)`
 * first. That decodes the requested frames, keeps `[current − 2, current + 16]`
 * per clip (wrapping for looping items), evicts everything else and prefetches
 * the read-ahead in the background with bounded concurrency. Residency is
 * capped at `maxDecodedFrames` per clip; pixels are identical to eager decode.
 * Exported for unit testing with an injected skia fake.
 */
export async function buildVideoFrameProvider(
  result: PreExtractResult,
  skia: { loadImage: (src: string) => Promise<unknown> },
  opts: VideoFrameProviderOptions = {},
): Promise<VideoFrameProvider> {
  const maxDecoded = opts.maxDecodedFrames ?? DEFAULT_MAX_DECODED_FRAMES;
  if (!Number.isInteger(maxDecoded) || maxDecoded < 1) {
    throw new RangeError(
      `maxDecodedFrames must be a positive integer (got ${String(maxDecoded)})`,
    );
  }
  const byItemId = new Map<string, VideoClip>();
  for (const entry of result.entries.values()) {
    const clip = new SlidingWindowClip(entry, skia.loadImage, maxDecoded);
    await clip.init();
    for (const id of entry.itemIds) byItemId.set(id, clip);
  }
  return {
    getClip(itemId: string): VideoClip | undefined {
      return byItemId.get(itemId);
    },
  };
}

/**
 * One cache entry's frames, decoded on demand into a bounded window. Exported
 * (not part of the package surface) so tests can observe residency.
 */
export class SlidingWindowClip implements VideoClip {
  readonly frameCount: number;
  width: number;
  height: number;

  private readonly decoded = new Map<number, unknown>();
  private readonly inflight = new Map<number, Promise<unknown>>();
  /** Frames the current window wants resident, highest priority first. */
  private wanted: number[] = [1];
  private wantedSet = new Set<number>([1]);
  private required = new Set<number>([1]);

  constructor(
    private readonly entry: FrameCacheEntry,
    private readonly loadImage: (src: string) => Promise<unknown>,
    private readonly maxDecoded: number,
  ) {
    this.frameCount = entry.frameCount;
    this.width = entry.width;
    this.height = entry.height;
  }

  /** Decode frame 1 up front: `fit` needs the true intrinsic size (B-1). */
  async init(): Promise<void> {
    if (this.frameCount < 1) return;
    const size = imageSize(await this.load(1));
    if (size) {
      this.width = size.width;
      this.height = size.height;
    }
  }

  /** Number of decoded frames currently held (for tests / diagnostics). */
  get residentFrames(): number {
    return this.decoded.size;
  }

  getFrame(frameIndex: number): unknown | undefined {
    return this.decoded.get(frameIndex);
  }

  async prepare(requests: ReadonlyArray<VideoFrameRequest>): Promise<void> {
    const required: number[] = [];
    for (const r of requests) {
      const i = r.frameIndex;
      if (Number.isInteger(i) && i >= 1 && i <= this.frameCount && !required.includes(i)) {
        required.push(i);
      }
    }
    if (required.length === 0) return;

    // Priority: the frames drawn now, then read-ahead (nearest first,
    // round-robin across requests), then the short look-behind. Truncated to
    // the cap, but never below the required set.
    const wanted = [...required];
    const seen = new Set(required);
    const push = (i: number | undefined): void => {
      if (i === undefined || seen.has(i)) return;
      seen.add(i);
      wanted.push(i);
    };
    for (let k = 1; k <= WINDOW_AHEAD; k++) {
      for (const r of requests) push(this.offset(r, k));
    }
    for (let k = 1; k <= WINDOW_BEHIND; k++) {
      for (const r of requests) push(this.offset(r, -k));
    }
    this.wanted = wanted.slice(0, Math.max(required.length, this.maxDecoded));
    this.wantedSet = new Set(this.wanted);
    this.required = new Set(required);

    for (const i of [...this.decoded.keys()]) {
      if (!this.wantedSet.has(i)) this.decoded.delete(i);
    }

    await Promise.all(required.map((i) => this.load(i)));
    this.pump();
  }

  /** Frame `k` steps from a request, wrapping for loops; undefined off the ends. */
  private offset(r: VideoFrameRequest, k: number): number | undefined {
    const i = r.frameIndex + k;
    if (i >= 1 && i <= this.frameCount) return i;
    if (!r.loop || k < 0) return undefined;
    return ((i - 1) % this.frameCount) + 1;
  }

  private load(i: number): Promise<unknown> {
    const have = this.decoded.get(i);
    if (have !== undefined) return Promise.resolve(have);
    const pending = this.inflight.get(i);
    if (pending) return pending;
    const file = join(this.entry.dir, `${String(i).padStart(5, "0")}.png`);
    const p = this.loadImage(file).then(
      (image) => {
        this.inflight.delete(i);
        this.store(i, image);
        return image;
      },
      (err: unknown) => {
        this.inflight.delete(i);
        throw err;
      },
    );
    this.inflight.set(i, p);
    return p;
  }

  private store(i: number, image: unknown): void {
    // A read-ahead that landed after the window moved on is dropped.
    if (!this.wantedSet.has(i)) return;
    if (this.decoded.size >= this.maxDecoded) {
      // Make room by dropping the lowest-priority non-required frame; if every
      // resident frame is required, only a required frame may overflow.
      const victim = [...this.decoded.keys()]
        .filter((j) => !this.required.has(j))
        .sort((a, b) => this.wanted.indexOf(b) - this.wanted.indexOf(a))[0];
      if (victim !== undefined) this.decoded.delete(victim);
      else if (!this.required.has(i)) return;
    }
    this.decoded.set(i, image);
  }

  /** Start background decodes of the read-ahead, bounded by concurrency + cap. */
  private pump(): void {
    for (const i of this.wanted) {
      if (this.inflight.size >= PREFETCH_CONCURRENCY) return;
      if (this.decoded.size + this.inflight.size >= this.maxDecoded) return;
      if (this.decoded.has(i) || this.inflight.has(i)) continue;
      // Prefetch failures are silent: the frame is retried (and its error
      // surfaced) if it is ever actually required.
      this.load(i).then(
        () => this.pump(),
        () => undefined,
      );
    }
  }
}

function imageSize(image: unknown): { width: number; height: number } | undefined {
  if (typeof image !== "object" || image === null) return undefined;
  const { width, height } = image as { width?: unknown; height?: unknown };
  return typeof width === "number" && typeof height === "number" && width > 0 && height > 0
    ? { width, height }
    : undefined;
}

function defaultSpawn(cmd: string, args: ReadonlyArray<string>): ChildProcess {
  return nodeSpawn(cmd, args as string[], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function waitForDrain(stream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      stream.off("error", onError);
      resolve();
    };
    const onError = (err: Error) => {
      stream.off("drain", onDrain);
      reject(err);
    };
    stream.once("drain", onDrain);
    stream.once("error", onError);
  });
}

async function waitForClose(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const [code, signal] = (await once(child, "close")) as [
    number | null,
    NodeJS.Signals | null,
  ];
  return { code, signal };
}

function toNodeBuffer(raw: Uint8Array): Buffer {
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
}

async function safeUnlink(path: string): Promise<void> {
  // `force` swallows ENOENT (e.g. the temp video was never written because a
  // test injected a fake spawn); any other error is non-fatal cleanup noise.
  try {
    await rm(path, { force: true });
  } catch {
    // Leaving an orphan temp file is preferable to masking the real error.
  }
}

function safeKill(child: ChildProcess): void {
  if (child.killed || child.exitCode !== null) return;
  try {
    child.kill("SIGKILL");
  } catch {
    // child already gone; nothing to do.
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function importSkiaCanvas(): Promise<SkiaDriverModule> {
  // String-variable specifier + @vite-ignore so Vite/Vitest don't try to
  // pre-resolve skia-canvas at transform time (it's a native module). The
  // node driver is the only consumer; browser/Vite builds never reach this.
  const specifier = "skia-canvas";
  return import(/* @vite-ignore */ specifier) as Promise<SkiaDriverModule>;
}
