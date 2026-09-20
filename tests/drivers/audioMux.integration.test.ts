// Golden integration for the v0.2 §S4 audio mux pipeline.
//
// Renders a fixture composition with one voiceover + one music bed through the
// real two-stage pipeline (skia → temp video → ffmpeg mux) using the bundled
// static ffmpeg/ffprobe binaries, then:
//   1. ffprobes the output and asserts the audio stream is AAC @ 48kHz, and the
//      video stream survived (`-c:v copy`).
//   2. runs `volumedetect` over three time windows ("waveform comparison on 3
//      time points" from the plan) to confirm the tracks are positioned right:
//      music-only window is audible, music+voiceover window is audible, and the
//      post-roll window (both tracks ended) is silent.
//
// Fixtures (committed for §S2): tone-stereo.mp3 (~1s, 44.1kHz stereo) and
// tone-mono.wav (0.5s, 48kHz mono) — exactly the "1 music + 1 voiceover" the
// §S4 deliverable calls for, and a deliberate sample-rate + channel mismatch so
// the forced 48kHz resample and stereo upmix are exercised end-to-end.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderToFile } from "../../src/drivers/node/index.js";
import type { Composition } from "../../src/schema/types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "audio");
const MUSIC = join(FIXTURES, "tone-stereo.mp3");
const VOICEOVER = join(FIXTURES, "tone-mono.wav");

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string;
  channels?: number;
  width?: number;
  height?: number;
  color_space?: string;
  color_range?: string;
}
interface ProbeOutput {
  streams: ProbeStream[];
  format: { duration?: string };
}

let ffmpegPath: string | undefined;
let ffprobePath: string | undefined;

beforeAll(async () => {
  const ffmpegStatic = (await import("ffmpeg-static")).default as unknown as
    | string
    | null;
  if (ffmpegStatic) ffmpegPath = ffmpegStatic;
  const ffprobeStatic = (await import("ffprobe-static")).default as {
    path: string;
  };
  if (ffprobeStatic?.path) ffprobePath = ffprobeStatic.path;
});

// R-11: the voiceover asset (tone-mono.wav) is 0.5s long. Placed at timeline
// `start: 0` with `trimIn: 0.25`, the mux should seek 0.25s into the source
// before playing, leaving only 0.25s of remaining audio — audible over
// [0, 0.25) then silent for the rest of the 1s composition. Critically, if
// `trimIn` were ignored (the pre-fix behaviour — `atrim` always from 0), the
// clip would instead play its full 0.5s and still be audible at t=0.35.
function trimInComposition(): Composition {
  return {
    version: "0.1",
    composition: {
      width: 64,
      height: 48,
      fps: 12,
      duration: 1,
      background: "#000010",
    },
    assets: [
      { id: "vo", type: "audio", src: VOICEOVER, duration: 0.5, sampleRate: 48000, channels: 1 },
    ],
    layers: [{ id: "bg", z: 0, opacity: 1, blendMode: "normal", items: ["box"] }],
    items: {
      box: {
        type: "shape",
        kind: "rect",
        width: 20,
        height: 20,
        fillColor: "#ff2266",
        transform: {
          x: 32,
          y: 24,
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
    audio: [{ id: "vo-trimmed", asset: "vo", start: 0, trimIn: 0.25 }],
  };
}

// music bed [0, ~1]s at 0.5 gain; voiceover [0.5, 1.0]s with a short fade-in.
// Composition runs 2s so there's a clear post-roll silence window.
function voiceoverPlusMusicComposition(): Composition {
  return {
    version: "0.1",
    composition: {
      width: 64,
      height: 48,
      fps: 12,
      duration: 2,
      background: "#000010",
    },
    assets: [
      { id: "music", type: "audio", src: MUSIC, duration: 1, sampleRate: 44100, channels: 2 },
      { id: "vo", type: "audio", src: VOICEOVER, duration: 0.5, sampleRate: 48000, channels: 1 },
    ],
    layers: [{ id: "bg", z: 0, opacity: 1, blendMode: "normal", items: ["box"] }],
    items: {
      box: {
        type: "shape",
        kind: "rect",
        width: 30,
        height: 30,
        fillColor: "#22aaff",
        transform: {
          x: 32,
          y: 24,
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
    audio: [
      { id: "music-bed", asset: "music", start: 0, volume: 0.5 },
      { id: "vo-1", asset: "vo", start: 0.5, fadeIn: 0.1 },
    ],
  };
}

function ffprobe(path: string): ProbeOutput {
  if (!ffprobePath) throw new Error("ffprobe-static path missing");
  const r = spawnSync(
    ffprobePath,
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return JSON.parse(r.stdout) as ProbeOutput;
}

// Mean volume (dBFS) of a [start, start+dur] window of the output's audio.
// -Infinity for true silence (ffmpeg prints "-inf" / a -91dB floor).
function meanVolumeDb(path: string, start: number, dur: number): number {
  if (!ffmpegPath) throw new Error("ffmpeg-static path missing");
  const r = spawnSync(
    ffmpegPath,
    [
      "-v", "info",
      "-ss", String(start),
      "-t", String(dur),
      "-i", path,
      "-map", "0:a:0",
      "-af", "volumedetect",
      "-f", "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const m = /mean_volume:\s*(-?inf|-?[\d.]+)\s*dB/i.exec(r.stderr);
  if (!m) throw new Error(`could not parse mean_volume from:\n${r.stderr}`);
  return /inf/i.test(m[1]!) ? -Infinity : Number(m[1]);
}

describe("renderToFile — voiceover + music mux (integration)", () => {
  let workDir: string;
  let outPath: string;
  let haveBins = false;

  beforeAll(async () => {
    haveBins =
      ffmpegPath !== undefined &&
      ffprobePath !== undefined &&
      existsSync(MUSIC) &&
      existsSync(VOICEOVER);
    if (!haveBins) return;
    workDir = mkdtempSync(join(tmpdir(), "davidup-s4-"));
    outPath = join(workDir, "out.mp4");
    await renderToFile(voiceoverPlusMusicComposition(), outPath, {
      ffmpegPath,
      preset: "ultrafast",
      crf: 28,
    });
  }, 60_000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it("produces an output with an AAC audio stream at 48kHz", () => {
    if (!haveBins) return;
    expect(statSync(outPath).size).toBeGreaterThan(0);

    const probe = ffprobe(outPath);
    const audio = probe.streams.find((s) => s.codec_type === "audio");
    expect(audio, "expected an audio stream in the muxed output").toBeDefined();
    expect(audio!.codec_name).toBe("aac");
    expect(Number(audio!.sample_rate)).toBe(48000);
  });

  it("keeps the copied video stream intact (-c:v copy)", () => {
    if (!haveBins) return;
    const probe = ffprobe(outPath);
    const video = probe.streams.find((s) => s.codec_type === "video");
    expect(video, "expected the copied video stream to survive").toBeDefined();
    expect(video!.codec_name).toBe("h264");
    expect(video!.width).toBe(64);
    expect(video!.height).toBe(48);
    // v1.1 S8: stage-1 colour tags survive the copy mux.
    expect(video!.color_space).toBe("bt709");
    expect(video!.color_range).toBe("tv");
  });

  it("cleans up the temporary silent video", () => {
    if (!haveBins) return;
    const leftovers = readdirSync(workDir).filter((f) =>
      f.includes("davidup-tmpvideo"),
    );
    expect(leftovers).toEqual([]);
  });

  it("waveform comparison on 3 time points: music-only, music+VO, silence", () => {
    if (!haveBins) return;
    // Windows chosen to sit clear of track edges / fades.
    const musicOnly = meanVolumeDb(outPath, 0.15, 0.2); // [0.15,0.35]: music only
    const overlap = meanVolumeDb(outPath, 0.6, 0.2); //    [0.6,0.8]: music + voiceover
    const postRoll = meanVolumeDb(outPath, 1.4, 0.4); //   [1.4,1.8]: both ended → silent

    // Both active windows are clearly audible.
    expect(musicOnly).toBeGreaterThan(-50);
    expect(overlap).toBeGreaterThan(-50);
    // Post-roll is effectively silent: well below the audible windows and the
    // -60dB noise floor.
    expect(postRoll).toBeLessThan(-60);
    expect(postRoll).toBeLessThan(musicOnly - 10);
    expect(postRoll).toBeLessThan(overlap - 10);
  });
});

describe("renderToFile — audio `trimIn` in-source offset (R-11, integration)", () => {
  let workDir: string;
  let outPath: string;
  let haveBins = false;

  beforeAll(async () => {
    haveBins =
      ffmpegPath !== undefined && ffprobePath !== undefined && existsSync(VOICEOVER);
    if (!haveBins) return;
    workDir = mkdtempSync(join(tmpdir(), "davidup-s4-trimin-"));
    outPath = join(workDir, "out.mp4");
    await renderToFile(trimInComposition(), outPath, {
      ffmpegPath,
      preset: "ultrafast",
      crf: 28,
    });
  }, 60_000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it("waveform comparison on 3 time points: audible, cut short by trimIn, silent post-roll", () => {
    if (!haveBins) return;
    const audible = meanVolumeDb(outPath, 0.05, 0.15); //  [0.05,0.2]: within the 0.25s remaining after trimIn
    const shouldBeCutShort = meanVolumeDb(outPath, 0.3, 0.1); // [0.3,0.4]: would still be audible at the untrimmed source's 0.5s length, but trimIn leaves only [0,0.25) — must be silent
    const postRoll = meanVolumeDb(outPath, 0.6, 0.3); //    [0.6,0.9]: long past the clip either way

    expect(audible).toBeGreaterThan(-50);
    expect(shouldBeCutShort).toBeLessThan(-60);
    expect(postRoll).toBeLessThan(-60);
    expect(shouldBeCutShort).toBeLessThan(audible - 10);
  });
});

// ──────────────── v1.1 S10: limiter, loop, loudness target ────────────────

// Minimal composition around a given audio setup: one small shape so the video
// stage has something to encode.
function audioOnlyComposition(
  duration: number,
  assets: Composition["assets"],
  audio: NonNullable<Composition["audio"]>,
  audioMaster?: Composition["composition"]["audioMaster"],
): Composition {
  return {
    version: "0.1",
    composition: {
      width: 64,
      height: 48,
      fps: 12,
      duration,
      background: "#000010",
      ...(audioMaster !== undefined ? { audioMaster } : {}),
    },
    assets,
    layers: [{ id: "bg", z: 0, opacity: 1, blendMode: "normal", items: ["box"] }],
    items: {
      box: {
        type: "shape",
        kind: "rect",
        width: 10,
        height: 10,
        fillColor: "#ffffff",
        transform: {
          x: 32, y: 24, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1,
        },
      },
    },
    tweens: [],
    audio,
  };
}

// Sample peak (dBFS) of the output's decoded audio. astats reads the float
// decode, so unlike volumedetect it reports overs above 0 dBFS.
function peakDb(path: string): number {
  if (!ffmpegPath) throw new Error("ffmpeg-static path missing");
  const r = spawnSync(
    ffmpegPath,
    ["-v", "info", "-i", path, "-map", "0:a:0", "-af", "astats=metadata=0", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const m = /Overall[\s\S]*?Peak level dB:\s*(-?inf|-?[\d.]+)/i.exec(r.stderr);
  if (!m) throw new Error(`could not parse peak level from:\n${r.stderr}`);
  return /inf/i.test(m[1]!) ? -Infinity : Number(m[1]);
}

// Integrated loudness (LUFS) of the output's audio via ebur128.
function integratedLufs(path: string): number {
  if (!ffmpegPath) throw new Error("ffmpeg-static path missing");
  const r = spawnSync(
    ffmpegPath,
    ["-v", "info", "-nostats", "-i", path, "-map", "0:a:0", "-af", "ebur128", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const m = /Integrated loudness:\s*I:\s*(-?[\d.]+)\s*LUFS/.exec(r.stderr);
  if (!m) throw new Error(`could not parse integrated loudness from:\n${r.stderr}`);
  return Number(m[1]);
}

describe("renderToFile — master limiter on overlapping full-scale tracks (v1.1 S10, integration)", () => {
  let workDir: string;
  let haveBins = false;
  let limitedPeak = 0;
  let unlimitedPeak = 0;

  beforeAll(async () => {
    haveBins = ffmpegPath !== undefined && ffprobePath !== undefined;
    if (!haveBins) return;
    workDir = mkdtempSync(join(tmpdir(), "davidup-s10-limiter-"));
    // Two identical full-scale (0 dBFS peak) 440Hz tones: summed in phase they
    // peak at +6 dBFS without a limiter.
    const tone = join(workDir, "full.wav");
    const gen = spawnSync(ffmpegPath!, [
      "-v", "error", "-y", "-f", "lavfi", "-i", "aevalsrc=sin(2*PI*440*t):s=48000:d=1.5", tone,
    ]);
    if (gen.status !== 0) throw new Error(`tone generation failed: ${gen.stderr}`);

    const assets: Composition["assets"] = [
      { id: "a", type: "audio", src: tone, duration: 1.5, sampleRate: 48000, channels: 1 },
      { id: "b", type: "audio", src: tone, duration: 1.5, sampleRate: 48000, channels: 1 },
    ];
    const tracks = [
      { id: "t1", asset: "a", start: 0 },
      { id: "t2", asset: "b", start: 0 },
    ];
    const limited = join(workDir, "limited.mp4");
    const unlimited = join(workDir, "unlimited.mp4");
    const opts = { ffmpegPath, preset: "ultrafast" as const, crf: 28 };
    await renderToFile(audioOnlyComposition(1.5, assets, tracks), limited, opts);
    await renderToFile(
      audioOnlyComposition(1.5, assets, tracks, { limiter: false }),
      unlimited,
      opts,
    );
    limitedPeak = peakDb(limited);
    unlimitedPeak = peakDb(unlimited);
  }, 60_000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it("the summed tones stay at or below 0 dBFS with the default limiter", () => {
    if (!haveBins) return;
    expect(limitedPeak).toBeLessThanOrEqual(0);
  });

  it("control: `limiter: false` lets the overlap clip past 0 dBFS", () => {
    if (!haveBins) return;
    expect(unlimitedPeak).toBeGreaterThan(1);
  });
});

describe("renderToFile — `loop` audio track and loudness target (v1.1 S10, integration)", () => {
  let workDir: string;
  let loopOut: string;
  let loudOut: string;
  let haveBins = false;

  beforeAll(async () => {
    haveBins = ffmpegPath !== undefined && ffprobePath !== undefined && existsSync(MUSIC);
    if (!haveBins) return;
    workDir = mkdtempSync(join(tmpdir(), "davidup-s10-loop-"));
    const assets: Composition["assets"] = [
      { id: "music", type: "audio", src: MUSIC, duration: 1, sampleRate: 44100, channels: 2 },
    ];
    const opts = { ffmpegPath, preset: "ultrafast" as const, crf: 28 };

    // ~1s bed looped from 0.5s to the end of a 4s composition (no `end`).
    loopOut = join(workDir, "loop.mp4");
    await renderToFile(
      audioOnlyComposition(4, assets, [{ id: "bed", asset: "music", start: 0.5, loop: true }]),
      loopOut,
      opts,
    );

    // Same bed looped under a 6s composition, normalised to -16 LUFS.
    loudOut = join(workDir, "loud.mp4");
    await renderToFile(
      audioOnlyComposition(
        6,
        assets,
        [{ id: "bed", asset: "music", start: 0, loop: true, volume: 0.3 }],
        { targetLufs: -16 },
      ),
      loudOut,
      opts,
    );
  }, 60_000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it("loop produces continuous audio from `start` to the composition end", () => {
    if (!haveBins) return;
    const before = meanVolumeDb(loopOut, 0.1, 0.3); // [0.1,0.4]: before start → silent
    // Windows in the 1st, 2nd, 3rd and 4th repetition of the ~1s source.
    const windows = [0.7, 1.7, 2.7, 3.6].map((t) => meanVolumeDb(loopOut, t, 0.2));

    expect(before).toBeLessThan(-60);
    for (const w of windows) expect(w).toBeGreaterThan(-50);
    // Each repetition is the same tone at the same level.
    expect(Math.max(...windows) - Math.min(...windows)).toBeLessThan(3);

    const probe = ffprobe(loopOut);
    expect(Number(probe.format.duration)).toBeGreaterThan(3.9);
  });

  it("targetLufs normalises the mix to the target (two-pass loudnorm)", () => {
    if (!haveBins) return;
    expect(Math.abs(integratedLufs(loudOut) - -16)).toBeLessThan(1.5);
  });
});

// ──────────────── B-9: loudness target on a ranged render ────────────────

// A track that starts exactly at the range's first frame, with a loudness
// target. The pass-2 bus is `loudnorm → aresample → [alimiter] → apad`; when
// ffmpeg re-initialises the graph mid-stream (the mix goes from silence to the
// track's first samples right at the cut), loudnorm's output carries no pinned
// channel layout and the link into `apad` fails to negotiate one:
// "Cannot select channel layout for the link between filters … apad".
// `aformat=channel_layouts=stereo` after the resample pins it.
describe("renderToFile — targetLufs on a ranged render (B-9, integration)", () => {
  let workDir: string;
  let outPath: string;
  let haveBins = false;

  beforeAll(async () => {
    haveBins = ffmpegPath !== undefined && ffprobePath !== undefined;
    if (!haveBins) return;
    workDir = mkdtempSync(join(tmpdir(), "davidup-b9-range-lufs-"));
    outPath = join(workDir, "out.mp4");
    const tone = join(workDir, "tone.wav");
    const gen = spawnSync(ffmpegPath!, [
      "-v", "error", "-y", "-f", "lavfi",
      "-i", "aevalsrc=0.5*sin(2*PI*440*t):s=48000:d=1",
      tone,
    ]);
    if (gen.status !== 0) throw new Error(`tone generation failed: ${gen.stderr}`);

    await renderToFile(
      audioOnlyComposition(
        3,
        [{ id: "boom", type: "audio", src: tone, duration: 1, sampleRate: 48000, channels: 1 }],
        [{ id: "hit", asset: "boom", start: 2 }],
        { targetLufs: -14, limiter: false },
      ),
      outPath,
      { ffmpegPath, preset: "ultrafast", crf: 28, range: { from: 2, to: 3 } },
    );
  }, 60_000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it("muxes an audio stream instead of failing to negotiate a layout", () => {
    if (!haveBins) return;
    const probe = ffprobe(outPath);
    const audio = probe.streams.find((s) => s.codec_type === "audio");
    expect(audio, "expected an audio stream in the ranged output").toBeDefined();
    expect(audio!.codec_name).toBe("aac");
    expect(audio!.channels).toBe(2);
  });

  it("the track is audible from the range's first frame", () => {
    if (!haveBins) return;
    // The track starts at composition t=2, which is t=0 of the rendered window.
    expect(meanVolumeDb(outPath, 0.1, 0.5)).toBeGreaterThan(-50);
  });
});
