// Integration test for the §6 server pipeline. Renders a §3.1-style
// hello-world to MP4 with real skia-canvas + real ffmpeg, then ffprobes the
// output to verify width/height/fps/duration/codec metadata.
//
// External assets in §3.1 (logo image, Inter font) live outside the repo, so
// the composition here uses shapes only — same authorial intent (fade-in +
// scale pop), zero filesystem dependencies.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderToFile } from "../../src/drivers/node/index.js";
import type { Composition } from "../../src/schema/types.js";

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  nb_frames?: string;
  duration?: string;
  color_space?: string;
  color_primaries?: string;
  color_transfer?: string;
  color_range?: string;
}

interface ProbeOutput {
  streams: ProbeStream[];
  format: { duration?: string; format_name?: string };
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

function helloWorldComposition(): Composition {
  // §3.1 hello-world variant: a logo-shape that fades in and scale-pops, with
  // a tinted background. 200×120 @ 12 fps × 0.5s = 6 frames keeps the
  // integration test fast (sub-second on real ffmpeg).
  return {
    version: "0.1",
    composition: {
      width: 200,
      height: 120,
      fps: 12,
      duration: 0.5,
      background: "#000020",
    },
    assets: [],
    layers: [
      {
        id: "fg",
        z: 0,
        opacity: 1,
        blendMode: "normal",
        items: ["logo"],
      },
    ],
    items: {
      logo: {
        type: "shape",
        kind: "rect",
        width: 80,
        height: 80,
        fillColor: "#ff8800",
        cornerRadius: 12,
        transform: {
          x: 100,
          y: 60,
          scaleX: 0.5,
          scaleY: 0.5,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
    },
    tweens: [
      {
        id: "fade-in",
        target: "logo",
        property: "transform.opacity",
        from: 0,
        to: 1,
        start: 0,
        duration: 0.4,
        easing: "easeOutQuad",
      },
      {
        id: "pop-x",
        target: "logo",
        property: "transform.scaleX",
        from: 0.5,
        to: 1,
        start: 0,
        duration: 0.5,
        easing: "easeOutBack",
      },
      {
        id: "pop-y",
        target: "logo",
        property: "transform.scaleY",
        from: 0.5,
        to: 1,
        start: 0,
        duration: 0.5,
        easing: "easeOutBack",
      },
    ],
  };
}

function ffprobe(path: string): ProbeOutput {
  if (!ffprobePath) throw new Error("ffprobe-static path missing");
  const result = spawnSync(
    ffprobePath,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      path,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`ffprobe failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as ProbeOutput;
}

function parseRational(rate: string): number {
  const [a, b] = rate.split("/").map(Number);
  if (!a || !b) return Number.NaN;
  return a / b;
}

describe("renderToFile — hello-world MP4 (integration)", () => {
  let workDir: string;
  let outPath: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "davidup-phase6-"));
    outPath = join(workDir, "hello-world.mp4");
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("encodes the §3.1 hello-world variant and ffprobe reports matching metadata", async () => {
    const comp = helloWorldComposition();

    const result = await renderToFile(comp, outPath, {
      ffmpegPath,
      // Smaller crf/preset don't matter here — verify that overrides flow through.
      crf: 23,
      preset: "ultrafast",
    });

    expect(result.outputPath).toBe(outPath);
    expect(result.frameCount).toBe(6);

    const fileSize = statSync(outPath).size;
    expect(fileSize).toBeGreaterThan(0);

    const probe = ffprobe(outPath);
    const video = probe.streams.find((s) => s.codec_name === "h264");
    expect(video, "expected an h264 stream in the output").toBeDefined();
    if (!video) return;

    expect(video.width).toBe(comp.composition.width);
    expect(video.height).toBe(comp.composition.height);
    expect(video.pix_fmt).toBe("yuv420p");

    // Frame rate: ffprobe reports a rational like "12/1".
    const fps = parseRational(video.avg_frame_rate ?? video.r_frame_rate ?? "");
    expect(fps).toBeCloseTo(comp.composition.fps, 5);

    // Duration: 6 frames @ 12 fps = 0.5s exactly. Allow a small encoder tolerance.
    const reported = Number(video.duration ?? probe.format.duration ?? "NaN");
    expect(Number.isFinite(reported)).toBe(true);
    expect(reported).toBeGreaterThan(0.3);
    expect(reported).toBeLessThan(0.8);

    if (video.nb_frames !== undefined) {
      expect(Number(video.nb_frames)).toBe(6);
    }
  }, 30_000);
});

describe("renderToFile — rational fps (v1.1 S7, integration)", () => {
  let workDir: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "davidup-ntsc-"));
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("a 30000/1001 composition encodes with an exact NTSC r_frame_rate", async () => {
    const comp = helloWorldComposition();
    comp.composition.fps = "30000/1001";
    const outPath = join(workDir, "ntsc.mp4");

    const result = await renderToFile(comp, outPath, { ffmpegPath, preset: "ultrafast" });
    // 0.5 s × 29.97 = 14.985 → 15 frames.
    expect(result.frameCount).toBe(15);

    const video = ffprobe(outPath).streams.find((s) => s.codec_name === "h264");
    expect(video).toBeDefined();
    expect(video!.r_frame_rate).toBe("30000/1001");
    expect(video!.avg_frame_rate).toBe("30000/1001");
    expect(Number(video!.nb_frames)).toBe(15);
  });
});

describe("renderToFile — colour-space tagging (v1.1 S8, integration)", () => {
  let workDir: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "davidup-color-"));
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("tags the output bt709 / tv by default", async () => {
    const outPath = join(workDir, "bt709.mp4");
    await renderToFile(helloWorldComposition(), outPath, { ffmpegPath, preset: "ultrafast" });
    const video = ffprobe(outPath).streams.find((s) => s.codec_name === "h264");
    expect(video).toBeDefined();
    expect(video!.color_space).toBe("bt709");
    expect(video!.color_primaries).toBe("bt709");
    expect(video!.color_transfer).toBe("bt709");
    expect(video!.color_range).toBe("tv");
  }, 30_000);

  it("writes no colour tags with colorProfile: untagged", async () => {
    const outPath = join(workDir, "untagged.mp4");
    await renderToFile(helloWorldComposition(), outPath, {
      ffmpegPath,
      preset: "ultrafast",
      colorProfile: "untagged",
    });
    const video = ffprobe(outPath).streams.find((s) => s.codec_name === "h264");
    expect(video).toBeDefined();
    expect(video!.color_space).toBeUndefined();
    expect(video!.color_primaries).toBeUndefined();
  }, 30_000);
});

describe("renderToFile — H.264 in a .mov container (v1.1 S30, integration)", () => {
  const VOICEOVER = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "audio",
    "tone-mono.wav",
  );
  let workDir: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "davidup-mov-"));
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("writes a QuickTime file with the same h264 stream the MP4 path produces", async () => {
    const comp = helloWorldComposition();
    const outPath = join(workDir, "hello-world.mov");

    const result = await renderToFile(comp, outPath, {
      ffmpegPath,
      preset: "ultrafast",
      movflagsFaststart: true,
    });
    expect(result.frameCount).toBe(6);

    const probe = ffprobe(outPath);
    // ffprobe names the mov/mp4 demuxer family "mov,mp4,m4a,3gp,3g2,mj2";
    // the brand is what tells QuickTime from MP4.
    expect(probe.format.format_name).toContain("mov");
    const video = probe.streams.find((s) => s.codec_type === "video");
    expect(video?.codec_name).toBe("h264");
    expect(video?.width).toBe(comp.composition.width);
    expect(video?.height).toBe(comp.composition.height);
    expect(video?.pix_fmt).toBe("yuv420p");
    expect(video?.color_space).toBe("bt709");
    expect(parseRational(video?.avg_frame_rate ?? "")).toBeCloseTo(comp.composition.fps, 5);
    if (video?.nb_frames !== undefined) expect(Number(video.nb_frames)).toBe(6);
  }, 30_000);

  it("muxes AAC audio into the .mov and cleans up the silent temp video", async () => {
    const comp = helloWorldComposition();
    comp.assets = [
      { id: "vo", type: "audio", src: VOICEOVER, duration: 0.5, sampleRate: 48000, channels: 1 },
    ];
    comp.audio = [{ id: "vo", asset: "vo", start: 0 }];
    const dir = mkdtempSync(join(workDir, "mux-"));
    const outPath = join(dir, "with-audio.mov");

    await renderToFile(comp, outPath, { ffmpegPath, preset: "ultrafast" });

    const streams = ffprobe(outPath).streams;
    expect(streams.find((s) => s.codec_type === "video")?.codec_name).toBe("h264");
    expect(streams.find((s) => s.codec_type === "audio")?.codec_name).toBe("aac");
    expect(readdirSync(dir)).toEqual(["with-audio.mov"]);
  }, 30_000);
});
