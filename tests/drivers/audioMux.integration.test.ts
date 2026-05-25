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
