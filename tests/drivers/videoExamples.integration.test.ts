// Integration tests for the v0.2 §S10 sample compositions under
// examples/video-*/. Each renders its composition end-to-end through real
// skia-canvas + real ffmpeg (pre-extract → encode), then ffprobes the output
// to verify width/height/fps/duration/frame-count — the same
// render-then-ffprobe pattern as tests/drivers/node.integration.test.ts,
// applied to the three video-item sample compositions instead of the
// shapes-only hello-world.
//
// Coverage, one example per §S10 scenario:
//   - video-pip           picture-in-picture: two simultaneous video items
//                          (a looping full-frame background + a smaller
//                          inset), plus a shape overlay for the frame border.
//   - video-bg-text       a full-frame video background under a tweened text
//                          caption.
//   - video-freeze-trim   a trimmed clip whose content is exhausted well
//                          before the composition ends, so it freezes on the
//                          last extracted frame for the remainder.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderToFile } from "../../src/drivers/node/index.js";
import type { Composition } from "../../src/schema/types.js";
import { buildVideoPipComposition } from "../../examples/video-pip/composition.js";
import { buildVideoBgTextComposition } from "../../examples/video-bg-text/composition.js";
import { buildVideoFreezeTrimComposition } from "../../examples/video-freeze-trim/composition.js";

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

interface Example {
  name: string;
  build: () => Composition;
  expectedFrameCount: number;
}

const EXAMPLES: Example[] = [
  // duration 2s @ 10fps = 20 frames exactly.
  { name: "video-pip", build: buildVideoPipComposition, expectedFrameCount: 20 },
  // duration 2s @ 10fps = 20 frames exactly.
  { name: "video-bg-text", build: buildVideoBgTextComposition, expectedFrameCount: 20 },
  // duration 3s @ 10fps = 30 frames exactly.
  { name: "video-freeze-trim", build: buildVideoFreezeTrimComposition, expectedFrameCount: 30 },
];

describe.each(EXAMPLES)(
  "renderToFile — $name sample composition (integration)",
  ({ build, expectedFrameCount, name }) => {
    let workDir: string;
    let cacheRoot: string;
    let outPath: string;

    beforeAll(() => {
      workDir = mkdtempSync(join(tmpdir(), `davidup-s10-${name}-`));
      cacheRoot = mkdtempSync(join(tmpdir(), `davidup-s10-${name}-cache-`));
      outPath = join(workDir, `${name}.mp4`);
    });

    afterAll(() => {
      rmSync(workDir, { recursive: true, force: true });
      rmSync(cacheRoot, { recursive: true, force: true });
    });

    it(
      "renders the sample composition to MP4 with matching ffprobe metadata",
      async () => {
        const comp = build();

        const result = await renderToFile(comp, outPath, {
          ffmpegPath,
          crf: 23,
          preset: "ultrafast",
          preExtract: { cacheRoot },
        });

        expect(result.outputPath).toBe(outPath);
        expect(result.frameCount).toBe(expectedFrameCount);

        const fileSize = statSync(outPath).size;
        expect(fileSize).toBeGreaterThan(0);

        const probe = ffprobe(outPath);
        const video = probe.streams.find((s) => s.codec_name === "h264");
        expect(video, "expected an h264 stream in the output").toBeDefined();
        if (!video) return;

        expect(video.width).toBe(comp.composition.width);
        expect(video.height).toBe(comp.composition.height);
        expect(video.pix_fmt).toBe("yuv420p");

        const fps = parseRational(
          video.avg_frame_rate ?? video.r_frame_rate ?? "",
        );
        expect(fps).toBeCloseTo(comp.composition.fps, 5);

        // Duration-exact assertion: expectedFrameCount / fps, with a small
        // encoder tolerance (same bracket style as node.integration.test.ts).
        const expectedDuration = expectedFrameCount / comp.composition.fps;
        const reported = Number(video.duration ?? probe.format.duration ?? "NaN");
        expect(Number.isFinite(reported)).toBe(true);
        expect(reported).toBeGreaterThan(expectedDuration - 0.3);
        expect(reported).toBeLessThan(expectedDuration + 0.3);

        if (video.nb_frames !== undefined) {
          expect(Number(video.nb_frames)).toBe(expectedFrameCount);
        }
      },
      30_000,
    );
  },
);
