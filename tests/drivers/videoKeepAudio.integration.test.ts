// keepAudio end-to-end (v1.1 S11): a video item's own audio stream flows into
// the mux without being registered as a separate audio asset.
//
// beforeAll synthesises a 3s source clip (testsrc2 picture + a 440Hz sine) with
// the bundled ffmpeg, probes it through `probeVideo` (so `hasAudio` comes from
// real ffprobe), then renders a 2s composition that places a 1s slice of the
// clip — trimIn 0.5, trimOut 1.5 — at composition t=0.5 with `keepAudio: true`.
// The output must carry an audio stream that is audible over exactly the item
// span [0.5, 1.5) and silent on either side (the stream itself is padded to the
// video length, so "duration matches the item span" is measured as the audible
// window). A second render of a silent source with keepAudio stays single-stage
// and emits no audio stream.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { probeVideo } from "../../src/drivers/node/ffprobe.js";
import { renderToFile } from "../../src/drivers/node/index.js";
import type { Composition, VideoAsset } from "../../src/schema/types.js";
import { validate } from "../../src/schema/validator.js";

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  duration?: string;
}

let ffmpegPath: string | undefined;
let ffprobePath: string | undefined;
let workDir: string;
let withSound: VideoAsset;
let silent: VideoAsset;
let haveBins = false;

const TRANSFORM = {
  x: 32,
  y: 24,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0.5,
  anchorY: 0.5,
  opacity: 1,
};

function ff(args: string[]): void {
  const r = spawnSync(ffmpegPath!, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}

function audioStreams(path: string): ProbeStream[] {
  const r = spawnSync(
    ffprobePath!,
    ["-v", "error", "-print_format", "json", "-show_streams", path],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const streams = (JSON.parse(r.stdout) as { streams: ProbeStream[] }).streams;
  return streams.filter((s) => s.codec_type === "audio");
}

function meanVolumeDb(path: string, start: number, dur: number): number {
  const r = spawnSync(
    ffmpegPath!,
    ["-v", "info", "-ss", String(start), "-t", String(dur), "-i", path,
      "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const m = /mean_volume:\s*(-?inf|-?[\d.]+)\s*dB/i.exec(r.stderr);
  if (!m) throw new Error(`could not parse mean_volume from:\n${r.stderr}`);
  return /inf/i.test(m[1]!) ? -Infinity : Number(m[1]);
}

function keepAudioComposition(asset: VideoAsset): Composition {
  return {
    version: "0.1",
    composition: { width: 64, height: 48, fps: 12, duration: 2, background: "#000000" },
    assets: [asset],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["clip"] }],
    items: {
      clip: {
        type: "video",
        asset: asset.id,
        width: 64,
        height: 48,
        start: 0.5,
        end: 1.5,
        trimIn: 0.5,
        trimOut: 1.5,
        fit: "contain",
        loop: false,
        keepAudio: true,
        transform: TRANSFORM,
      },
    },
    tweens: [],
  };
}

beforeAll(async () => {
  ffmpegPath = ((await import("ffmpeg-static")).default as unknown as string | null) ?? undefined;
  ffprobePath = ((await import("ffprobe-static")).default as { path: string }).path;
  haveBins = ffmpegPath !== undefined && existsSync(ffmpegPath) && existsSync(ffprobePath);
  if (!haveBins) return;

  workDir = mkdtempSync(join(tmpdir(), "davidup-s11-"));
  const soundSrc = join(workDir, "broll-sound.mp4");
  const silentSrc = join(workDir, "broll-silent.mp4");
  ff(["-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=12:duration=3",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", soundSrc]);
  ff(["-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=12:duration=3",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", silentSrc]);

  withSound = { id: "broll", type: "video", src: soundSrc, ...(await probeVideo(soundSrc, { ffprobePath })) };
  silent = { id: "quiet", type: "video", src: silentSrc, ...(await probeVideo(silentSrc, { ffprobePath })) };
}, 60_000);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("renderToFile — keepAudio video item (integration)", () => {
  it("probes hasAudio on both sources", () => {
    if (!haveBins) return;
    expect(withSound.hasAudio).toBe(true);
    expect(silent.hasAudio).toBe(false);
  });

  it("muxes the clip's own audio, audible over exactly the item span", async () => {
    if (!haveBins) return;
    const out = join(workDir, "keep.mp4");
    const comp = keepAudioComposition(withSound);
    expect(validate(comp).warnings.map((w) => w.code)).not.toContain("W_VIDEO_NO_AUDIO_STREAM");
    await renderToFile(comp, out, {
      ffmpegPath,
      preset: "ultrafast",
      preExtract: { cacheRoot: join(workDir, "cache") },
    });

    const audio = audioStreams(out);
    expect(audio).toHaveLength(1);
    expect(audio[0]!.codec_name).toBe("aac");

    // Silent before the item starts, the tone across its span, silent after.
    expect(meanVolumeDb(out, 0, 0.4)).toBeLessThan(-60);
    expect(meanVolumeDb(out, 0.6, 0.8)).toBeGreaterThan(-30);
    expect(meanVolumeDb(out, 1.6, 0.4)).toBeLessThan(-60);
  }, 60_000);

  it("a silent source warns and renders without an audio stream", async () => {
    if (!haveBins) return;
    const out = join(workDir, "silent.mp4");
    const comp = keepAudioComposition(silent);
    expect(validate(comp).warnings.map((w) => w.code)).toContain("W_VIDEO_NO_AUDIO_STREAM");
    await renderToFile(comp, out, {
      ffmpegPath,
      preset: "ultrafast",
      preExtract: { cacheRoot: join(workDir, "cache") },
    });
    expect(audioStreams(out)).toHaveLength(0);
  }, 60_000);
});
