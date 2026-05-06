import { describe, expect, it } from "vitest";

import {
  buildFfmpegArgs,
  frameCount,
  renderToFile,
} from "../../src/drivers/node/index.js";
import type { Composition } from "../../src/schema/types.js";
import { makeFakeSpawn } from "./fakeFfmpeg.js";
import { makeFakeSkia } from "./fakeSkia.js";

function tinyComp(overrides: Partial<Composition["composition"]> = {}): Composition {
  return {
    version: "0.1",
    composition: {
      width: 32,
      height: 32,
      fps: 5,
      duration: 0.4,
      background: "#101010",
      ...overrides,
    },
    assets: [],
    layers: [
      { id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["s"] },
    ],
    items: {
      s: {
        type: "shape",
        kind: "rect",
        width: 10,
        height: 10,
        fillColor: "#ff0000",
        transform: {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
    },
    tweens: [],
  };
}

describe("buildFfmpegArgs", () => {
  it("emits the canonical raw-RGBA → libx264 yuv420p pipeline (design-doc §6)", () => {
    const comp = tinyComp({ width: 1920, height: 1080, fps: 30 });
    const args = buildFfmpegArgs(comp, "/tmp/out.mp4", {});

    expect(args).toEqual([
      "-y",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-s",
      "1920x1080",
      "-r",
      "30",
      "-i",
      "pipe:0",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "/tmp/out.mp4",
    ]);
  });

  it("propagates codec, crf, preset, and faststart flag overrides", () => {
    const comp = tinyComp();
    const args = buildFfmpegArgs(comp, "/tmp/x.mp4", {
      codec: "libx265",
      crf: 23,
      preset: "fast",
      pixFmt: "yuv444p",
      movflagsFaststart: true,
    });
    expect(args).toContain("libx265");
    expect(args.join(" ")).toContain("-crf 23");
    expect(args.join(" ")).toContain("-preset fast");
    expect(args.join(" ")).toContain("-pix_fmt yuv444p");
    expect(args.join(" ")).toContain("-movflags +faststart");
    // Output path stays last.
    expect(args[args.length - 1]).toBe("/tmp/x.mp4");
  });
});

describe("frameCount", () => {
  it("rounds up duration*fps and clamps to at least one frame", () => {
    expect(frameCount(tinyComp({ duration: 1, fps: 30 }))).toBe(30);
    expect(frameCount(tinyComp({ duration: 1.001, fps: 30 }))).toBe(31);
    expect(frameCount(tinyComp({ duration: 0, fps: 30 }))).toBe(1);
  });
});

describe("renderToFile — frame pumping", () => {
  it("writes one RGBA frame per (duration*fps) and clearRects each frame", async () => {
    const comp = tinyComp({ duration: 0.4, fps: 5 }); // 2 frames
    const skia = makeFakeSkia();
    const harness = makeFakeSpawn({ exitCode: 0 });

    const result = await renderToFile(comp, "/tmp/out.mp4", {
      skiaCanvas: skia,
      spawn: harness.spawn,
    });

    expect(result.frameCount).toBe(2);
    expect(result.outputPath).toBe("/tmp/out.mp4");
    expect(harness.calls).toHaveLength(1);

    // Frames pushed into ffmpeg stdin: one per loop iteration.
    const { ffmpeg } = harness.calls[0]!;
    expect(ffmpeg.stdin.writes).toHaveLength(2);
    expect(ffmpeg.stdin.ended).toBe(true);

    // Each frame is sized as width*height*4 RGBA bytes.
    for (const buf of ffmpeg.stdin.writes) {
      expect(buf.length).toBe(32 * 32 * 4);
    }

    // Single canvas instance reused across frames — clearRect once per frame.
    expect(skia.canvases).toHaveLength(1);
    const canvas = skia.canvases[0]!;
    const clearRects = canvas.ctx.calls.filter((c) => c.op === "clearRect");
    expect(clearRects).toHaveLength(2);
    expect(canvas.toBufferCalls).toBe(2);
  });

  it("preloads composition assets via the asset loader before rendering", async () => {
    const comp: Composition = {
      ...tinyComp(),
      assets: [
        { id: "logo", type: "image", src: "logo.png" },
        { id: "inter", type: "font", src: "Inter.ttf", family: "Inter" },
      ],
    };
    const skia = makeFakeSkia();
    const harness = makeFakeSpawn({ exitCode: 0 });

    await renderToFile(comp, "/tmp/out.mp4", {
      skiaCanvas: skia,
      spawn: harness.spawn,
    });

    expect(skia.loadImage).toHaveBeenCalledWith("logo.png");
    expect(skia.FontLibrary.use).toHaveBeenCalledWith("Inter", ["Inter.ttf"]);
  });

  it("spawns ffmpeg with the canonical args (and honours ffmpegPath override)", async () => {
    const comp = tinyComp({ width: 64, height: 48, fps: 24, duration: 1 / 24 });
    const skia = makeFakeSkia();
    const harness = makeFakeSpawn({ exitCode: 0 });

    await renderToFile(comp, "/tmp/canon.mp4", {
      skiaCanvas: skia,
      spawn: harness.spawn,
      ffmpegPath: "/opt/ffmpeg/bin/ffmpeg",
    });

    const { cmd, args } = harness.calls[0]!;
    expect(cmd).toBe("/opt/ffmpeg/bin/ffmpeg");
    expect(args).toContain("64x48");
    expect(args).toContain("24");
    expect(args[args.length - 1]).toBe("/tmp/canon.mp4");
  });
});

describe("renderToFile — backpressure", () => {
  it("awaits 'drain' when stdin.write returns false, then keeps pumping", async () => {
    // 5 frames @ 32×32×4 = 4096 bytes each. Trigger drain after each frame.
    const comp = tinyComp({ duration: 1, fps: 5 });
    const skia = makeFakeSkia();
    const harness = makeFakeSpawn({ exitCode: 0, backpressureBytes: 1 });

    const result = await renderToFile(comp, "/tmp/bp.mp4", {
      skiaCanvas: skia,
      spawn: harness.spawn,
    });

    expect(result.frameCount).toBe(5);
    const { ffmpeg } = harness.calls[0]!;
    expect(ffmpeg.stdin.writes).toHaveLength(5);
    expect(ffmpeg.stdin.ended).toBe(true);
  });
});

describe("renderToFile — error paths", () => {
  it("throws with stderr tail when ffmpeg exits non-zero", async () => {
    const comp = tinyComp();
    const skia = makeFakeSkia();
    const harness = makeFakeSpawn({
      exitCode: 1,
      stderr: "Unknown encoder 'libx999'\n",
    });

    await expect(
      renderToFile(comp, "/tmp/fail.mp4", {
        skiaCanvas: skia,
        spawn: harness.spawn,
      }),
    ).rejects.toThrow(/ffmpeg exited with code 1[\s\S]*Unknown encoder 'libx999'/);
  });
});
