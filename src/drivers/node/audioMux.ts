// Audio mux pipeline — the second stage of the v0.2 §S4 render.
//
// The node driver renders the visual timeline to a silent `temp_video.mp4`
// exactly as before. When a composition carries `audio[]` tracks, this module
// takes that silent video plus the N declared audio assets and muxes them into
// the final output:
//
//   ffmpeg -i temp_video.mp4 -i track0 -i track1 ...
//          -filter_complex "<per-track chains> ... amix ... [aout]"
//          -map 0:v:0 -map [aout]
//          -c:v copy            ← zero re-encode of the video we just made
//          -c:a aac -ar 48000   ← every source resampled to 48kHz
//          [-movflags +faststart]
//          output.mp4
//
// Per track the filter graph applies, in order: 48kHz resample, a uniform
// stereo layout (so `amix` never sees mismatched inputs), an optional seek
// into the source (`trimIn`, R-11) and/or trim to the track's `[start, end)`
// timeline window, volume gain, fade in/out, then `adelay` to position the
// clip on the composition timeline. A `loop` track repeats its (trimIn-seeked)
// source with `aloop` and is cut to its timeline span (v1.1 S10).
//
// After `amix` the master bus (`composition.audioMaster`, v1.1 S10) runs, in
// order: optional `loudnorm` (two-pass — see below) → `alimiter` at
// MUX_LIMITER_CEILING_DB (on by default) → pad/trim to the video's duration so
// the audio can never outrun the copied video.
//
// Loudness target: when `audioMaster.targetLufs` is set, `muxAudioTracks`
// spawns ffmpeg twice. Pass 1 renders the same per-track mix into
// `loudnorm=print_format=json` with `-f null` and parses the measured
// integrated loudness / true peak / LRA / threshold from stderr; pass 2 feeds
// those into `loudnorm … linear=true` so the whole mix gets one static gain
// (no pumping) and lands on the target.
//
// The filter / arg builders are pure and exported for unit testing; only
// `muxAudioTracks` touches the filesystem / spawns ffmpeg.

import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { extname } from "node:path";

import { resolveGlobalSrc } from "../../assets/node.js";
import type {
  AudioAsset,
  AudioMaster,
  AudioTrack,
  Composition,
} from "../../schema/types.js";
import { resolveFfmpeg } from "./ffmpeg.js";
import type { FfmpegSpawn } from "./index.js";

/** Every source and the final output are forced to this sample rate (§S4). */
export const MUX_SAMPLE_RATE = 48_000;
/** Bitrate for the muxed audio stream (AAC, or Opus in WebM). */
export const MUX_AUDIO_BITRATE = "192k";

/**
 * Ceiling of the master limiter, in dBFS (v1.1 S10). -1 rather than 0 leaves
 * headroom for the lossy encoder's inter-sample overshoot.
 */
export const MUX_LIMITER_CEILING_DB = -1;
/** True-peak ceiling handed to `loudnorm` when a loudness target is set. */
export const MUX_LOUDNORM_TRUE_PEAK = -1.5;
/** Loudness range target handed to `loudnorm` (its EBU R128 default). */
export const MUX_LOUDNORM_LRA = 11;
/** `aloop` size cap in samples: loop the whole (seeked) source. */
const ALOOP_MAX_SAMPLES = 2_147_483_647;

const STDERR_TAIL_BYTES = 4096;

export interface MuxAudioOptions {
  ffmpegPath?: string;
  spawn?: FfmpegSpawn;
  /** Append `-movflags +faststart` to the muxed MP4. */
  movflagsFaststart?: boolean;
  /** Override the global library root for `global:` audio srcs (tests). */
  globalLibraryRoot?: string;
}

export interface ResolvedAudioTrack {
  track: AudioTrack;
  /** Filesystem path handed to ffmpeg (`global:` already resolved). */
  src: string;
  /** Asset's natural duration in seconds, when known from the registry. */
  assetDuration?: number;
}

/** True when the composition has at least one audio track to mux. */
export function compositionHasAudio(comp: Composition): boolean {
  return (comp.audio?.length ?? 0) > 0;
}

/**
 * Resolve each audio track to a concrete ffmpeg input: look up its asset,
 * confirm it is an audio asset, and resolve the `src` to a filesystem path.
 *
 * @throws {Error} when a track references a missing or non-audio asset — the
 *   schema validator does not (yet) cross-check audio references, so this is
 *   the last line of defence before ffmpeg would fail opaquely.
 */
export function resolveAudioInputs(
  comp: Composition,
  globalLibraryRoot?: string,
): ResolvedAudioTrack[] {
  const tracks = comp.audio ?? [];
  const assetById = new Map(comp.assets.map((a) => [a.id, a] as const));

  return tracks.map((track) => {
    const label = `Audio track "${track.id ?? track.asset}"`;
    const asset = assetById.get(track.asset);
    if (!asset) {
      throw new Error(`${label} references unknown asset "${track.asset}".`);
    }
    if (asset.type !== "audio") {
      throw new Error(
        `${label} references asset "${track.asset}" which is type "${asset.type}", not "audio".`,
      );
    }
    const audioAsset = asset as AudioAsset;
    const resolved: ResolvedAudioTrack = {
      track,
      src: resolveGlobalSrc(audioAsset.src, globalLibraryRoot),
    };
    if (audioAsset.duration !== undefined) {
      resolved.assetDuration = audioAsset.duration;
    }
    return resolved;
  });
}

/**
 * Values `loudnorm` measured over the mix in the analysis pass (pass 1), fed
 * back into pass 2 for linear normalisation.
 */
export interface LoudnormMeasurement {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  targetOffset: number;
}

/**
 * Build the `-filter_complex` graph for the resolved tracks. Input index 0 is
 * the silent video, so track `i` is ffmpeg input `i + 1`. `videoDuration` (the
 * encoded video's exact length in seconds) caps the mixed audio so it never
 * extends past the copied video stream.
 *
 * `master` is the composition's `audioMaster` (limiter on unless explicitly
 * `false`). With `targetLufs` set, pass the pass-1 `measurement` for a linear
 * two-pass normalisation; without one `loudnorm` falls back to single-pass
 * dynamic mode.
 */
export function buildAudioFilterComplex(
  resolved: ReadonlyArray<ResolvedAudioTrack>,
  videoDuration: number,
  master: AudioMaster = {},
  measurement?: LoudnormMeasurement,
): string {
  const { chains, mixed } = buildTrackMix(resolved, videoDuration);

  const bus: string[] = [];
  if (master.targetLufs !== undefined) {
    bus.push(loudnormFilter(master.targetLufs, measurement));
    // loudnorm upsamples to 192kHz internally; bring the mix back to 48kHz.
    bus.push(`aresample=${MUX_SAMPLE_RATE}`);
  }
  if (master.limiter !== false) {
    // level=0 disables alimiter's auto make-up gain (it would otherwise push
    // quiet mixes up to the ceiling); latency=1 compensates its lookahead so
    // the audio stays in sync with the video.
    const limit = secs(Math.pow(10, MUX_LIMITER_CEILING_DB / 20));
    bus.push(`alimiter=limit=${limit}:level=0:latency=1`);
  }
  // Pad with silence and trim so the audio stream spans exactly the video
  // duration. `apad` covers the post-roll after the last track ends (so the
  // audio doesn't fall short of the copied video); `atrim` caps it so audio
  // never outruns the video either — matching the "truncated at mux time"
  // warning add_audio_track emits.
  bus.push("apad", `atrim=0:${secs(videoDuration)}`);

  chains.push(`${mixed}${bus.join(",")}[aout]`);
  return chains.join(";");
}

/**
 * Pass-1 graph for a loudness target: the same per-track mix, cut to the video
 * duration, into `loudnorm=print_format=json`. Run with `-map [aout] -f null -`
 * and read the measurement off stderr with `parseLoudnormMeasurement`.
 */
export function buildLoudnormAnalysisFilterComplex(
  resolved: ReadonlyArray<ResolvedAudioTrack>,
  videoDuration: number,
  targetLufs: number,
): string {
  const { chains, mixed } = buildTrackMix(resolved, videoDuration);
  chains.push(
    `${mixed}atrim=0:${secs(videoDuration)},` +
      `loudnorm=I=${secs(targetLufs)}:TP=${secs(MUX_LOUDNORM_TRUE_PEAK)}:LRA=${secs(MUX_LOUDNORM_LRA)}:print_format=json[aout]`,
  );
  return chains.join(";");
}

/**
 * Parse the JSON block `loudnorm=print_format=json` prints at the end of
 * stderr. Returns `undefined` when it's missing or the input was silent
 * (`-inf` loudness) — there is nothing to normalise then.
 */
export function parseLoudnormMeasurement(stderr: string): LoudnormMeasurement | undefined {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) return undefined;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(stderr.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const num = (key: string): number => Number(raw[key]);
  const m: LoudnormMeasurement = {
    inputI: num("input_i"),
    inputTp: num("input_tp"),
    inputLra: num("input_lra"),
    inputThresh: num("input_thresh"),
    targetOffset: num("target_offset"),
  };
  return Object.values(m).every(Number.isFinite) ? m : undefined;
}

function loudnormFilter(targetLufs: number, m: LoudnormMeasurement | undefined): string {
  const base = `loudnorm=I=${secs(targetLufs)}:TP=${secs(MUX_LOUDNORM_TRUE_PEAK)}:LRA=${secs(MUX_LOUDNORM_LRA)}`;
  if (!m) return base;
  // Clamp into loudnorm's accepted option ranges so an extreme measurement
  // can't make pass 2 fail to parse.
  const clamp = (n: number, lo: number, hi: number): string =>
    secs(Math.min(hi, Math.max(lo, n)));
  return (
    `${base}:measured_I=${clamp(m.inputI, -99, 0)}` +
    `:measured_TP=${clamp(m.inputTp, -99, 99)}` +
    `:measured_LRA=${clamp(m.inputLra, 0, 99)}` +
    `:measured_thresh=${clamp(m.inputThresh, -99, 0)}` +
    `:offset=${clamp(m.targetOffset, -99, 99)}:linear=true`
  );
}

/**
 * Per-track chains plus the mix step, shared by the render graph and the
 * loudness analysis graph. `mixed` is the filter-chain prefix that yields the
 * summed audio — append filters and an output label to it.
 */
function buildTrackMix(
  resolved: ReadonlyArray<ResolvedAudioTrack>,
  videoDuration: number,
): { chains: string[]; mixed: string } {
  const chains: string[] = [];
  const mixLabels: string[] = [];

  resolved.forEach(({ track, assetDuration }, i) => {
    const outLabel = `a${i}`;
    const parts: string[] = [];

    // 1. Force 48kHz on every source (§S4).
    parts.push(`aresample=${MUX_SAMPLE_RATE}`);
    // 2. Uniform stereo layout so amix never sees mismatched inputs (mono
    //    voiceovers get upmixed to stereo here).
    parts.push("aformat=channel_layouts=stereo");

    // 3. Seek into the source (R-11: `trimIn`, independent of timeline
    //    placement) and/or bound the clip to its [start, end) timeline window
    //    when `end` is explicit. `atrim`'s positional args are (start, end)
    //    seconds *into the source* — omitting the second bound plays out to
    //    the source's natural end. Resetting PTS afterwards puts the clip
    //    back at t=0 so fades and the delay below are computed relative to
    //    the clip's own start regardless of where in the source it began.
    const trimIn = track.trimIn ?? 0;
    const clipEnd = track.end ?? (track.loop ? videoDuration : undefined);
    const timelineDuration =
      clipEnd !== undefined ? Math.max(0, clipEnd - track.start) : undefined;
    const clipDuration =
      timelineDuration ??
      (assetDuration !== undefined ? assetDuration - trimIn : undefined);
    if (track.loop && timelineDuration !== undefined) {
      // v1.1 S10: seek once, repeat everything after the seek point, then cut
      // the repeated stream to the clip's timeline span (`end`, or the
      // composition end when `end` is omitted).
      if (trimIn > 0) {
        parts.push(`atrim=${secs(trimIn)}`, "asetpts=PTS-STARTPTS");
      }
      parts.push(
        `aloop=loop=-1:size=${ALOOP_MAX_SAMPLES}`,
        `atrim=0:${secs(timelineDuration)}`,
        "asetpts=PTS-STARTPTS",
      );
    } else if (trimIn > 0 || timelineDuration !== undefined) {
      parts.push(
        timelineDuration !== undefined
          ? `atrim=${secs(trimIn)}:${secs(trimIn + timelineDuration)}`
          : `atrim=${secs(trimIn)}`,
      );
      parts.push("asetpts=PTS-STARTPTS");
    }

    // 4. Volume gain (skip the no-op identity multiplier).
    if (track.volume !== undefined && track.volume !== 1) {
      parts.push(`volume=${secs(track.volume)}`);
    }

    // 5. Fade in from the clip start.
    if (track.fadeIn !== undefined && track.fadeIn > 0) {
      parts.push(`afade=t=in:st=0:d=${secs(track.fadeIn)}`);
    }

    // 6. Fade out ending at the clip end. Needs the clip duration, which is
    //    only known when `end` is set or the asset's duration was probed.
    if (
      track.fadeOut !== undefined &&
      track.fadeOut > 0 &&
      clipDuration !== undefined
    ) {
      const fadeOutStart = Math.max(0, clipDuration - track.fadeOut);
      parts.push(`afade=t=out:st=${secs(fadeOutStart)}:d=${secs(track.fadeOut)}`);
    }

    // 7. Position the clip on the composition timeline. `:all=1` delays every
    //    channel regardless of layout.
    if (track.start > 0) {
      parts.push(`adelay=${Math.round(track.start * 1000)}:all=1`);
    }

    chains.push(`[${i + 1}:a]${parts.join(",")}[${outLabel}]`);
    mixLabels.push(`[${outLabel}]`);
  });

  // Mix (or pass a single track straight through). normalize=0 keeps each
  // track's gain as authored; the master limiter catches the overlap peaks.
  const mixed =
    mixLabels.length === 1
      ? mixLabels[0]!
      : `${mixLabels.join("")}amix=inputs=${mixLabels.length}:normalize=0,`;
  return { chains, mixed };
}

export interface BuildMuxArgsInput {
  tempVideoPath: string;
  /** Resolved audio source paths, in track order (parallel to filter inputs). */
  inputs: ReadonlyArray<string>;
  filterComplex: string;
  outputPath: string;
  movflagsFaststart?: boolean;
}

/** Assemble the ffmpeg argv for the mux stage. */
export function buildMuxArgs(input: BuildMuxArgsInput): string[] {
  const webm = extname(input.outputPath).toLowerCase() === ".webm";
  const args = ["-y", "-i", input.tempVideoPath];
  for (const src of input.inputs) args.push("-i", src);
  args.push(
    "-filter_complex",
    input.filterComplex,
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    // WebM only carries Opus/Vorbis (v1.1 S9 VP9 alpha export).
    "-c:a",
    webm ? "libopus" : "aac",
    "-b:a",
    MUX_AUDIO_BITRATE,
    "-ar",
    String(MUX_SAMPLE_RATE),
    // R-16: same bitexact rationale as the stage-1 encode (buildFfmpegArgs)
    // — strip container timestamps and the aac encoder tag so the final
    // muxed MP4 is reproducible too.
    "-fflags",
    "+bitexact",
    "-flags:a",
    "+bitexact",
  );
  if (input.movflagsFaststart && !webm) args.push("-movflags", "+faststart");
  args.push(input.outputPath);
  return args;
}

/**
 * Mux the composition's audio tracks onto an already-encoded silent video.
 * Resolves inputs, builds the filter graph + argv, then spawns ffmpeg and
 * waits for it to exit. With `audioMaster.targetLufs` set, a loudness analysis
 * pass runs first (see the header comment). Throws (with the ffmpeg stderr
 * tail) on failure.
 */
export async function muxAudioTracks(
  comp: Composition,
  tempVideoPath: string,
  outputPath: string,
  videoDuration: number,
  opts: MuxAudioOptions = {},
): Promise<void> {
  const resolved = resolveAudioInputs(comp, opts.globalLibraryRoot);
  if (resolved.length === 0) {
    throw new Error("muxAudioTracks called with no audio tracks.");
  }
  const master = comp.composition.audioMaster ?? {};
  const inputs = resolved.map((r) => r.src);
  const spawnFn = opts.spawn ?? defaultSpawn;
  const ffmpegPath = opts.ffmpegPath ?? (await resolveFfmpeg());

  let measurement: LoudnormMeasurement | undefined;
  if (master.targetLufs !== undefined) {
    const analysisArgs = buildLoudnormAnalysisArgs({
      tempVideoPath,
      inputs,
      filterComplex: buildLoudnormAnalysisFilterComplex(
        resolved,
        videoDuration,
        master.targetLufs,
      ),
    });
    const stderr = await runFfmpeg(spawnFn, ffmpegPath, analysisArgs, "loudness analysis");
    measurement = parseLoudnormMeasurement(stderr);
  }

  // A silent mix measures -inf LUFS: nothing to normalise, so skip loudnorm
  // rather than hand pass 2 an unusable measurement.
  const effectiveMaster: AudioMaster =
    master.targetLufs !== undefined && measurement === undefined
      ? { ...(master.limiter !== undefined ? { limiter: master.limiter } : {}) }
      : master;
  const args = buildMuxArgs({
    tempVideoPath,
    inputs,
    filterComplex: buildAudioFilterComplex(
      resolved,
      videoDuration,
      effectiveMaster,
      measurement,
    ),
    outputPath,
    ...(opts.movflagsFaststart !== undefined
      ? { movflagsFaststart: opts.movflagsFaststart }
      : {}),
  });
  await runFfmpeg(spawnFn, ffmpegPath, args, "mux");
}

/** Argv for the loudness analysis pass: decode + mix to the null muxer. */
export function buildLoudnormAnalysisArgs(input: {
  tempVideoPath: string;
  inputs: ReadonlyArray<string>;
  filterComplex: string;
}): string[] {
  const args = ["-hide_banner", "-nostats", "-i", input.tempVideoPath];
  for (const src of input.inputs) args.push("-i", src);
  args.push("-filter_complex", input.filterComplex, "-map", "[aout]", "-f", "null", "-");
  return args;
}

/** Spawn ffmpeg, wait for exit, return the stderr tail; throw on failure. */
async function runFfmpeg(
  spawnFn: FfmpegSpawn,
  ffmpegPath: string,
  args: ReadonlyArray<string>,
  stage: string,
): Promise<string> {
  const ffmpeg = spawnFn(ffmpegPath, args);

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

  // The mux reads from file inputs, not stdin — close it so ffmpeg sees EOF
  // immediately (and the test fake, which keys "close" off stdin end, fires).
  ffmpeg.stdin?.end();

  const [code, signal] = (await once(ffmpeg, "close")) as [
    number | null,
    NodeJS.Signals | null,
  ];
  if (code !== 0) {
    const tail = stderrTail.trim();
    const reason = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
    throw new Error(`ffmpeg (${stage}) exited with ${reason}${tail ? `:\n${tail}` : ""}`);
  }
  return stderrTail;
}

/**
 * Format a seconds value for an ffmpeg filter argument: fixed-point (never
 * exponential, which ffmpeg rejects), trailing zeros trimmed.
 */
export function secs(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 1e6) / 1e6;
  let s = rounded.toFixed(6).replace(/\.?0+$/, "");
  if (s === "" || s === "-0") s = "0";
  return s;
}

function defaultSpawn(cmd: string, args: ReadonlyArray<string>): ChildProcess {
  return nodeSpawn(cmd, args as string[], {
    stdio: ["pipe", "ignore", "pipe"],
  });
}
