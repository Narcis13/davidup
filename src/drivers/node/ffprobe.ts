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

import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export interface AudioMetadata {
  /** Seconds. */
  duration?: number;
  /** Hz. */
  sampleRate?: number;
  channels?: number;
  /** ffprobe `codec_name`, e.g. "mp3", "aac", "pcm_s16le". */
  codec?: string;
}

export type ProbeSpawn = (
  cmd: string,
  args: ReadonlyArray<string>,
) => ChildProcess;

export interface ProbeAudioOptions {
  /** Override the ffprobe binary path. Default: resolved via `ffprobe-static`, else "ffprobe". */
  ffprobePath?: string;
  /** Override the spawn function (tests). Default: `child_process.spawn`. */
  spawn?: ProbeSpawn;
}

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

function defaultSpawn(cmd: string, args: ReadonlyArray<string>): ChildProcess {
  return nodeSpawn(cmd, args as string[], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}
