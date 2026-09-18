// Integration test for alpha export (v1.1 S9): a composition with
// `background: "transparent"` rendered through the real skia → ffmpeg pipeline
// to ProRes 4444 (.mov) and VP9 (.webm). ffprobe must report an alpha pixel
// format / alpha side channel, and frame 0 decoded back to PNG must have alpha
// 0 where nothing is drawn and 255 under the opaque rect.
//
// Encoder availability varies between ffmpeg builds, so each block is skipped
// when the bundled ffmpeg lacks the encoder; `ffmpeg -encoders` is checked once
// and what was found is logged so CI output records which ran.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderToFile } from "../../src/drivers/node/index.js";
import type { Composition } from "../../src/schema/types.js";

const VOICEOVER = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "audio",
  "tone-mono.wav",
);

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  codec_tag_string?: string;
  pix_fmt?: string;
  tags?: Record<string, string>;
}

const ffmpegPath = (await import("ffmpeg-static")).default as unknown as string;
const ffprobePath = ((await import("ffprobe-static")).default as { path: string }).path;

function listing(flag: "-encoders" | "-decoders"): string {
  return spawnSync(ffmpegPath, ["-hide_banner", flag], { encoding: "utf8" }).stdout ?? "";
}
const encoders = listing("-encoders");
const decoders = listing("-decoders");
const HAS_PRORES = /\bprores_ks\b/.test(encoders);
// ffmpeg's native vp9 decoder drops the alpha side channel; reading alpha back
// needs the libvpx decoder too.
const HAS_VP9 = /\blibvpx-vp9\b/.test(encoders) && /\blibvpx-vp9\b/.test(decoders);
console.info(
  `[alphaExport] bundled ffmpeg: prores_ks=${HAS_PRORES ? "yes" : "no"}, libvpx-vp9=${HAS_VP9 ? "yes" : "no"}`,
);

const W = 64;
const H = 48;

function overlayComposition(withAudio = false): Composition {
  return {
    version: "0.1",
    composition: { width: W, height: H, fps: 12, duration: 0.25, background: "transparent" },
    assets: withAudio
      ? [{ id: "vo", type: "audio", src: VOICEOVER, duration: 0.5, sampleRate: 48000, channels: 1 }]
      : [],
    layers: [{ id: "fg", z: 0, opacity: 1, blendMode: "normal", items: ["box"] }],
    items: {
      box: {
        type: "shape",
        kind: "rect",
        width: 20,
        height: 20,
        fillColor: "#ff2266",
        transform: {
          x: W / 2,
          y: H / 2,
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
    ...(withAudio ? { audio: [{ id: "vo", asset: "vo", start: 0 }] } : {}),
  };
}

function probeStreams(path: string): ProbeStream[] {
  const r = spawnSync(
    ffprobePath,
    ["-v", "error", "-print_format", "json", "-show_streams", path],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { streams: ProbeStream[] }).streams;
}

/** Decode frame 0 to a PNG, then read that PNG's RGBA bytes back. */
function frame0Alpha(
  video: string,
  pngPath: string,
  decoderArgs: string[] = [],
): { corner: number; center: number } {
  const toPng = spawnSync(
    ffmpegPath,
    ["-y", "-v", "error", ...decoderArgs, "-i", video, "-frames:v", "1", "-pix_fmt", "rgba", pngPath],
    { encoding: "utf8" },
  );
  if (toPng.status !== 0) throw new Error(`frame extract failed: ${toPng.stderr}`);
  const raw = spawnSync(
    ffmpegPath,
    ["-v", "error", "-i", pngPath, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  if (raw.status !== 0) throw new Error(`png decode failed: ${raw.stderr.toString()}`);
  const px = raw.stdout as Buffer;
  expect(px.length).toBe(W * H * 4);
  const alphaAt = (x: number, y: number) => px[(y * W + x) * 4 + 3]!;
  return { corner: alphaAt(0, 0), center: alphaAt(W / 2, H / 2) };
}

let workDir: string;
beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "davidup-alpha-"));
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe.skipIf(!HAS_PRORES)("alpha export — ProRes 4444 .mov (v1.1 S9)", () => {
  it("writes yuva444p10le ProRes 4444 with transparent empty pixels", async () => {
    const out = join(workDir, "overlay.mov");
    await renderToFile(overlayComposition(), out, {
      ffmpegPath,
      codec: "prores_ks",
      movflagsFaststart: true,
    });
    const video = probeStreams(out).find((s) => s.codec_type === "video");
    expect(video?.codec_name).toBe("prores");
    expect(video?.pix_fmt).toBe("yuva444p10le");
    // `ap4h` is the ProRes 4444 FourCC.
    expect(video?.codec_tag_string).toBe("ap4h");

    const alpha = frame0Alpha(out, join(workDir, "prores-f0.png"));
    expect(alpha.corner).toBeLessThan(255);
    expect(alpha.corner).toBe(0);
    expect(alpha.center).toBe(255);
  }, 60_000);

  it("keeps alpha through the audio mux (-c:v copy into .mov)", async () => {
    const dir = mkdtempSync(join(workDir, "mux-mov-"));
    const out = join(dir, "overlay-audio.mov");
    await renderToFile(overlayComposition(true), out, { ffmpegPath, codec: "prores_ks" });
    const streams = probeStreams(out);
    expect(streams.find((s) => s.codec_type === "video")?.pix_fmt).toBe("yuva444p10le");
    expect(streams.find((s) => s.codec_type === "audio")?.codec_name).toBe("aac");
    expect(frame0Alpha(out, join(dir, "f0.png")).corner).toBe(0);
    // Silent temp video (a .mov here) was cleaned up.
    expect(readdirSync(dir).filter((f) => f.startsWith(".davidup-tmpvideo-"))).toEqual([]);
  }, 60_000);
});

describe.skipIf(!HAS_VP9)("alpha export — VP9 .webm (v1.1 S9)", () => {
  it("writes VP9 with an alpha channel and transparent empty pixels", async () => {
    const out = join(workDir, "overlay.webm");
    // faststart requested on purpose: the WebM muxer would reject -movflags.
    await renderToFile(overlayComposition(), out, {
      ffmpegPath,
      codec: "libvpx-vp9",
      movflagsFaststart: true,
    });
    expect(existsSync(out)).toBe(true);
    const video = probeStreams(out).find((s) => s.codec_type === "video");
    expect(video?.codec_name).toBe("vp9");
    // The native decoder reports yuv420p; the alpha plane is flagged on the track.
    const alphaMode = Object.entries(video?.tags ?? {}).find(
      ([k]) => k.toLowerCase() === "alpha_mode",
    )?.[1];
    expect(alphaMode).toBe("1");

    const alpha = frame0Alpha(out, join(workDir, "vp9-f0.png"), ["-c:v", "libvpx-vp9"]);
    expect(alpha.corner).toBeLessThan(255);
    expect(alpha.center).toBeGreaterThan(250);
  }, 60_000);

  it("muxes Opus audio into the .webm and keeps the alpha track", async () => {
    const out = join(workDir, "overlay-audio.webm");
    await renderToFile(overlayComposition(true), out, {
      ffmpegPath,
      codec: "libvpx-vp9",
      movflagsFaststart: true,
    });
    const streams = probeStreams(out);
    expect(streams.find((s) => s.codec_type === "audio")?.codec_name).toBe("opus");
    const alpha = frame0Alpha(out, join(workDir, "vp9-audio-f0.png"), ["-c:v", "libvpx-vp9"]);
    expect(alpha.corner).toBeLessThan(255);
  }, 60_000);
});
