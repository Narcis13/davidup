// ffprobe audio metadata extraction (v0.2 §S2).
//
// `register_asset` calls `probeAudio` when admitting a `type: "audio"` asset to
// fill in duration / sampleRate / channels / codec. ffprobe is spawned as a
// subprocess (JSON output) and the first audio stream is read out.
//
// Binary resolution mirrors the editor's asset pipeline: prefer the bundled
// `ffprobe-static` binary (always present as a dependency, and crucially
// independent of a possibly-broken Homebrew ffprobe), fall back to `ffprobe`
// on PATH. The spawn function is injectable so tests can exercise the parsing
// and the "ffprobe unavailable" path without a real subprocess.

import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";

export interface AudioMetadata {
  /** Seconds. */
  duration?: number;
  /** Hz. */
  sampleRate?: number;
  channels?: number;
  /** ffprobe `codec_name`, e.g. "mp3", "aac", "pcm_s16le". */
  codec?: string;
}

export interface VideoMetadata {
  /** Seconds. */
  duration?: number;
  /** Pixels. */
  width?: number;
  /** Pixels. */
  height?: number;
  /** Frames per second (decimal; parsed from ffprobe's frame-rate fraction). */
  fps?: number;
  /**
   * The same rate as ffprobe reported it, exact: "30000/1001" (v1.1 S7). Set
   * only when the chosen field was a positive "num/den" fraction; usable
   * verbatim as a composition `fps` so cuts line up with the source.
   */
  fpsRational?: string;
  /** True when the pixel format carries an alpha plane (e.g. "yuva420p", "rgba"). */
  hasAlpha?: boolean;
  /** ffprobe `codec_name`, e.g. "h264", "hevc", "vp9", "av1". */
  codec?: string;
  /** ffprobe `pix_fmt`, e.g. "yuv420p", "yuva420p". */
  pixelFormat?: string;
  /** True when the container also carries an audio stream (v1.1 S11 `keepAudio`). */
  hasAudio?: boolean;
}

export type ProbeSpawn = (
  cmd: string,
  args: ReadonlyArray<string>,
) => ChildProcess;

/** Minimal `child_process.spawnSync` result shape {@link probeVideoSync} reads. */
export interface ProbeSpawnSyncResult {
  status: number | null;
  stdout: string;
  error?: Error | undefined;
}

export type ProbeSpawnSync = (
  cmd: string,
  args: ReadonlyArray<string>,
) => ProbeSpawnSyncResult;

export interface ProbeVideoSyncOptions {
  /** Override the ffprobe binary path. Default: as {@link resolveFfprobePath}. */
  ffprobePath?: string;
  /** Override the sync spawn (tests). Default: `child_process.spawnSync`. */
  spawnSync?: ProbeSpawnSync;
}

export interface ProbeAudioOptions {
  /** Override the ffprobe binary path. Default: resolved via `ffprobe-static`, else "ffprobe". */
  ffprobePath?: string;
  /** Override the spawn function (tests). Default: `child_process.spawn`. */
  spawn?: ProbeSpawn;
}

/** Same shape as {@link ProbeAudioOptions}; named separately for clarity at call sites. */
export type ProbeVideoOptions = ProbeAudioOptions;

/**
 * Thrown when ffprobe could not be launched at all (binary missing / not
 * executable). Distinct from a probe that ran but failed, so callers can tell
 * the user to install ffprobe versus reporting a bad file.
 */
export class FfprobeUnavailableError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "FfprobeUnavailableError";
    if (cause !== undefined) this.cause = cause;
  }
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  pix_fmt?: string;
  /** Stream tags as the muxer wrote them; key case varies (see alphaModeTag). */
  tags?: Record<string, string>;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

let cachedPath: string | undefined;

/**
 * Resolve the ffprobe binary path. Prefers the bundled `ffprobe-static`
 * binary; falls back to `"ffprobe"` (PATH lookup) when the package is absent.
 * Memoised after the first resolution.
 */
export async function resolveFfprobePath(): Promise<string> {
  if (cachedPath !== undefined) return cachedPath;
  try {
    // Indirect specifier so bundlers don't eagerly resolve this node-only dep.
    const specifier = "ffprobe-static";
    const mod = (await import(/* @vite-ignore */ specifier)) as
      | { default?: { path?: string } | string | null; path?: string }
      | null;
    const fromDefault = (mod?.default ?? null) as
      | { path?: string }
      | string
      | null;
    if (typeof fromDefault === "string" && fromDefault.length > 0) {
      cachedPath = fromDefault;
    } else if (
      fromDefault &&
      typeof fromDefault === "object" &&
      typeof fromDefault.path === "string"
    ) {
      cachedPath = fromDefault.path;
    } else if (mod && typeof mod.path === "string") {
      cachedPath = mod.path;
    }
  } catch {
    // ffprobe-static not installed — fall through to PATH.
  }
  if (cachedPath === undefined) cachedPath = "ffprobe";
  return cachedPath;
}

/**
 * Synchronous twin of {@link resolveFfprobePath}, sharing its memo. Needed by
 * {@link probeVideoSync}; `createRequire` is used with an indirect specifier so
 * bundlers leave this node-only dep alone.
 */
function resolveFfprobePathSync(): string {
  if (cachedPath !== undefined) return cachedPath;
  try {
    const specifier = "ffprobe-static";
    const req = createRequire(import.meta.url);
    const mod = req(specifier) as { path?: string } | string | null;
    if (typeof mod === "string" && mod.length > 0) {
      cachedPath = mod;
    } else if (mod && typeof mod === "object" && typeof mod.path === "string") {
      cachedPath = mod.path;
    }
  } catch {
    // ffprobe-static not installed — fall through to PATH.
  }
  if (cachedPath === undefined) cachedPath = "ffprobe";
  return cachedPath;
}

/**
 * Probe an audio file's metadata via ffprobe.
 *
 * @throws {FfprobeUnavailableError} when the ffprobe binary cannot be spawned.
 * @throws {Error} when ffprobe ran but failed (non-zero exit, unparseable
 *   output, or no audio stream) — i.e. a problem with the file, not the tool.
 */
export async function probeAudio(
  src: string,
  opts: ProbeAudioOptions = {},
): Promise<AudioMetadata> {
  const ffprobePath = opts.ffprobePath ?? (await resolveFfprobePath());
  const spawnFn = opts.spawn ?? defaultSpawn;
  const output = await runFfprobe(spawnFn, ffprobePath, src);
  return parseAudioMetadata(output, src);
}

/**
 * Probe a video file's metadata via ffprobe (v0.2 §S6).
 *
 * @throws {FfprobeUnavailableError} when the ffprobe binary cannot be spawned.
 * @throws {Error} when ffprobe ran but failed (non-zero exit, unparseable
 *   output, or no video stream) — i.e. a problem with the file, not the tool.
 */
export async function probeVideo(
  src: string,
  opts: ProbeVideoOptions = {},
): Promise<VideoMetadata> {
  const ffprobePath = opts.ffprobePath ?? (await resolveFfprobePath());
  const spawnFn = opts.spawn ?? defaultSpawn;
  const output = await runFfprobe(spawnFn, ffprobePath, src);
  return parseVideoMetadata(output, src);
}

/**
 * Best-effort synchronous probe (v1.3 B-7). The frame extractor's spec
 * collection is synchronous — and its result feeds a cache hash that three
 * separate callers recompute — so the one question it still has to ask ffprobe
 * ("is there an alpha side channel, and in which codec?") has to be answerable
 * without awaiting.
 *
 * Never throws: a missing binary, an unreadable file or a stream-less
 * container all return undefined, and the caller falls back to whatever the
 * composition already recorded. Callers that can await should use
 * {@link probeVideo}, which reports *why* a probe failed.
 */
export function probeVideoSync(
  src: string,
  opts: ProbeVideoSyncOptions = {},
): VideoMetadata | undefined {
  const ffprobePath = opts.ffprobePath ?? resolveFfprobePathSync();
  const run = opts.spawnSync ?? defaultSpawnSync;
  try {
    const result = run(ffprobePath, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      src,
    ]);
    if (result.error || result.status !== 0 || !result.stdout) return undefined;
    return parseVideoMetadata(JSON.parse(result.stdout) as FfprobeOutput, src);
  } catch {
    return undefined;
  }
}

function runFfprobe(
  spawnFn: ProbeSpawn,
  ffprobePath: string,
  file: string,
): Promise<FfprobeOutput> {
  return new Promise((resolve, reject) => {
    let proc: ChildProcess;
    try {
      proc = spawnFn(ffprobePath, [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        file,
      ]);
    } catch (err) {
      reject(
        new FfprobeUnavailableError(
          `Could not launch ffprobe (${ffprobePath}).`,
          err,
        ),
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (d: string) => {
      stdout += d;
    });
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (d: string) => {
      stderr += d;
    });
    proc.on("error", (err: NodeJS.ErrnoException) => {
      // ENOENT = binary not found; treat any spawn-level error as "unavailable".
      reject(
        new FfprobeUnavailableError(
          `Could not launch ffprobe (${ffprobePath}): ${err.message}`,
          err,
        ),
      );
    });
    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(
          new Error(
            `ffprobe exited with code ${code ?? "null"} for "${file}"${
              stderr.trim() ? `:\n${stderr.trim()}` : ""
            }`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout) as FfprobeOutput);
      } catch (err) {
        reject(
          new Error(
            `ffprobe output was not valid JSON for "${file}": ${
              (err as Error).message
            }`,
          ),
        );
      }
    });
  });
}

function parseAudioMetadata(probe: FfprobeOutput, src: string): AudioMetadata {
  const audio = (probe.streams ?? []).find((s) => s.codec_type === "audio");
  if (!audio) {
    throw new Error(`No audio stream found in "${src}".`);
  }
  const out: AudioMetadata = {};

  // Duration: prefer the container format duration (covers VBR streams whose
  // per-stream duration may be absent), fall back to the stream's own.
  const durRaw = probe.format?.duration ?? audio.duration;
  if (typeof durRaw === "string") {
    const n = Number.parseFloat(durRaw);
    if (Number.isFinite(n) && n >= 0) out.duration = n;
  }

  if (typeof audio.sample_rate === "string") {
    const sr = Number.parseInt(audio.sample_rate, 10);
    if (Number.isInteger(sr) && sr > 0) out.sampleRate = sr;
  }

  if (typeof audio.channels === "number" && audio.channels > 0) {
    out.channels = audio.channels;
  }

  if (typeof audio.codec_name === "string" && audio.codec_name.length > 0) {
    out.codec = audio.codec_name;
  }

  return out;
}

function parseVideoMetadata(probe: FfprobeOutput, src: string): VideoMetadata {
  const video = (probe.streams ?? []).find((s) => s.codec_type === "video");
  if (!video) {
    throw new Error(`No video stream found in "${src}".`);
  }
  const out: VideoMetadata = {};

  // Duration: prefer the container format duration (the per-stream duration is
  // often absent in webm/mkv), fall back to the stream's own.
  const durRaw = probe.format?.duration ?? video.duration;
  if (typeof durRaw === "string") {
    const n = Number.parseFloat(durRaw);
    if (Number.isFinite(n) && n >= 0) out.duration = n;
  }

  if (typeof video.width === "number" && video.width > 0) out.width = video.width;
  if (typeof video.height === "number" && video.height > 0) out.height = video.height;

  // Frame rate: prefer the average (the true playback rate for VFR / decimal
  // fps), fall back to the base `r_frame_rate`. Both arrive as "num/den"
  // strings; "0/0" (unknown) parses to undefined and is skipped.
  const rateField =
    parseFrameRate(video.avg_frame_rate) !== undefined
      ? video.avg_frame_rate
      : video.r_frame_rate;
  const fps = parseFrameRate(rateField);
  if (fps !== undefined) {
    out.fps = fps;
    const m = typeof rateField === "string" ? rateField.match(/^(\d+)\/(\d+)$/) : null;
    if (m) {
      // Kept as reported (ffprobe emits lowest terms); parseInt drops any
      // leading zeros so the string passes the composition `fps` schema.
      out.fpsRational = `${Number.parseInt(m[1]!, 10)}/${Number.parseInt(m[2]!, 10)}`;
    }
  }

  if (typeof video.codec_name === "string" && video.codec_name.length > 0) {
    out.codec = video.codec_name;
  }

  // Alpha surfaces two ways: most containers encode it in the pixel format
  // (yuva420p, rgba, …), but WebM (VP8/VP9) carries it out-of-band in the
  // `alpha_mode` stream tag while pix_fmt stays "yuv420p" — so check both.
  const pixFmt = video.pix_fmt;
  const alphaFromTag = alphaModeTag(video.tags) === "1";
  if (typeof pixFmt === "string" && pixFmt.length > 0) {
    out.pixelFormat = pixFmt;
    out.hasAlpha = pixelFormatHasAlpha(pixFmt) || alphaFromTag;
  } else if (alphaFromTag) {
    out.hasAlpha = true;
  }

  // v1.1 S11: whether there is any nat sound for `keepAudio` to mux.
  out.hasAudio = (probe.streams ?? []).some((s) => s.codec_type === "audio");

  return out;
}

/**
 * The WebM `alpha_mode` tag in whatever case it was written: libvpx's own
 * encode writes `alpha_mode`, but a stream-copy remux (muxing a sound track
 * into an alpha clip, as `hdf render --alpha webm` does) writes `ALPHA_MODE`,
 * and a clip read as opaque would lose its transparency in the render.
 */
function alphaModeTag(tags: Record<string, string> | undefined): string | undefined {
  if (!tags) return undefined;
  const key = Object.keys(tags).find((k) => k.toLowerCase() === "alpha_mode");
  return key === undefined ? undefined : tags[key];
}

/**
 * Parse an ffprobe frame-rate field ("num/den", e.g. "30000/1001" → 29.97).
 * Returns undefined for the "0/0" unknown marker or any unparseable value.
 */
function parseFrameRate(raw: string | undefined): number | undefined {
  if (typeof raw !== "string") return undefined;
  const m = raw.match(/^(\d+)\/(\d+)$/);
  if (m) {
    const num = Number.parseInt(m[1]!, 10);
    const den = Number.parseInt(m[2]!, 10);
    if (num > 0 && den > 0) return num / den;
    return undefined;
  }
  // Some builds emit a bare decimal; accept that too.
  const single = Number.parseFloat(raw);
  return Number.isFinite(single) && single > 0 ? single : undefined;
}

/**
 * True when an ffprobe pixel-format name carries an alpha plane. FFmpeg encodes
 * the component layout in the name: an alpha plane shows up as a leading
 * "yuva"/"ya8|ya16" (planar YUV / grey + alpha), an "rgba"/"bgra"/"argb"/"abgr"
 * packing, or a "gbrap" planar form. Bit-depth and endianness suffixes (e.g.
 * "yuva420p10le") don't move the alpha marker.
 */
export function pixelFormatHasAlpha(pixFmt: string): boolean {
  return /(^yuva|^ya(8|16)|rgba|bgra|argb|abgr|gbrap)/i.test(pixFmt);
}

function defaultSpawn(cmd: string, args: ReadonlyArray<string>): ChildProcess {
  return nodeSpawn(cmd, args as string[], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function defaultSpawnSync(
  cmd: string,
  args: ReadonlyArray<string>,
): ProbeSpawnSyncResult {
  const r = nodeSpawnSync(cmd, args as string[], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? "", error: r.error };
}
