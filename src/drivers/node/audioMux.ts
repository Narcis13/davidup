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
// stereo layout (so `amix` never sees mismatched inputs), an optional trim to
// the track's `[start, end)` window, volume gain, fade in/out, then `adelay`
// to position the clip on the composition timeline. The mixed result is capped
// to the video's duration so the audio can never outrun the copied video.
//
// The filter / arg builders are pure and exported for unit testing; only
// `muxAudioTracks` touches the filesystem / spawns ffmpeg.

import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";

import { resolveGlobalSrc } from "../../assets/node.js";
import type { AudioAsset, AudioTrack, Composition } from "../../schema/types.js";
import { resolveFfmpeg } from "./ffmpeg.js";
import type { FfmpegSpawn } from "./index.js";

/** Every source and the final output are forced to this sample rate (§S4). */
export const MUX_SAMPLE_RATE = 48_000;
/** AAC bitrate for the muxed audio stream. */
export const MUX_AUDIO_BITRATE = "192k";

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
 * Build the `-filter_complex` graph for the resolved tracks. Input index 0 is
 * the silent video, so track `i` is ffmpeg input `i + 1`. `videoDuration` (the
 * encoded video's exact length in seconds) caps the mixed audio so it never
 * extends past the copied video stream.
 */
export function buildAudioFilterComplex(
  resolved: ReadonlyArray<ResolvedAudioTrack>,
  videoDuration: number,
): string {
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

    // 3. Bound the clip to its [start, end) window when `end` is explicit.
    //    Resetting PTS afterwards puts the clip back at t=0 so fades and the
    //    delay below are computed relative to the clip's own start.
    const clipDuration =
      track.end !== undefined ? track.end - track.start : assetDuration;
    if (track.end !== undefined) {
      parts.push(`atrim=0:${secs(track.end - track.start)}`);
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

  // Mix (or pass a single track straight through), then pad with silence and
  // trim so the audio stream spans exactly the video duration. `apad` covers
  // the post-roll after the last track ends (so the audio doesn't fall short of
  // the copied video); `atrim` caps it so audio never outruns the video either
  // — matching the "truncated at mux time" warning add_audio_track emits.
  const fit = `apad,atrim=0:${secs(videoDuration)}`;
  if (mixLabels.length === 1) {
    chains.push(`${mixLabels[0]}${fit}[aout]`);
  } else {
    chains.push(
      `${mixLabels.join("")}amix=inputs=${mixLabels.length}:normalize=0,${fit}[aout]`,
    );
  }

  return chains.join(";");
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
    "-c:a",
    "aac",
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
  if (input.movflagsFaststart) args.push("-movflags", "+faststart");
  args.push(input.outputPath);
  return args;
}

/**
 * Mux the composition's audio tracks onto an already-encoded silent video.
 * Resolves inputs, builds the filter graph + argv, then spawns ffmpeg and
 * waits for it to exit. Throws (with the ffmpeg stderr tail) on failure.
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
  const filterComplex = buildAudioFilterComplex(resolved, videoDuration);
  const args = buildMuxArgs({
    tempVideoPath,
    inputs: resolved.map((r) => r.src),
    filterComplex,
    outputPath,
    ...(opts.movflagsFaststart !== undefined
      ? { movflagsFaststart: opts.movflagsFaststart }
      : {}),
  });

  const spawnFn = opts.spawn ?? defaultSpawn;
  const ffmpegPath = opts.ffmpegPath ?? (await resolveFfmpeg());
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
    throw new Error(`ffmpeg (mux) exited with ${reason}${tail ? `:\n${tail}` : ""}`);
  }
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
