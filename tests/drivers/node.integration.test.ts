// Integration test for the §6 server pipeline. Renders a §3.1-style
// hello-world to MP4 with real skia-canvas + real ffmpeg, then ffprobes the
// output to verify width/height/fps/duration/codec metadata.
//
// External assets in §3.1 (logo image, Inter font) live outside the repo, so
// the composition here uses shapes only — same authorial intent (fade-in +
// scale pop), zero filesystem dependencies.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderToFile } from "../../src/drivers/node/index.js";
import type { Composition } from "../../src/schema/types.js";

interface ProbeStream {
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  nb_frames?: string;
  duration?: string;
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
    workDir = mkdtempSync(join(tmpdir(), "motionforge-phase6-"));
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
