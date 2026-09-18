// v1.1 S12: time-range renders and PNG-sequence export (fake skia + ffmpeg).

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  buildAudioFilterComplex,
  buildLoudnormAnalysisFilterComplex,
  isPngSequencePath,
  pngSequenceFramePath,
  renderToFile,
  resolveRenderRange,
  type ResolvedAudioTrack,
} from "../../src/drivers/node/index.js";
import type { Composition } from "../../src/schema/types.js";
import { makeFakeSpawn } from "./fakeFfmpeg.js";
import { makeFakeSkia } from "./fakeSkia.js";

function comp(
  overrides: Partial<Composition["composition"]> = {},
  audio?: Composition["audio"],
): Composition {
  return {
    version: "0.1",
    composition: {
      width: 16,
      height: 16,
      fps: 5,
      duration: 2,
      background: "#101010",
      ...overrides,
    },
    assets: audio ? [{ id: "music", type: "audio", src: "/a/music.mp3", duration: 2 }] : [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: [] }],
    items: {},
    tweens: [],
    ...(audio ? { audio } : {}),
  };
}

const tmps: string[] = [];
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "davidup-s12-"));
  tmps.push(d);
  return d;
}

describe("resolveRenderRange", () => {
  it("covers the whole timeline without a range", () => {
    expect(resolveRenderRange(comp(), undefined)).toEqual({ startFrame: 0, frameCount: 10 });
  });

  it("frame count = ceil((to − from) × fps), first frame aligned down", () => {
    expect(resolveRenderRange(comp(), { from: 0.5, to: 1.3 })).toEqual({
      startFrame: 2,
      frameCount: 4,
    });
    expect(resolveRenderRange(comp({ fps: 30, duration: 30 }), { from: 12, to: 16 })).toEqual({
      startFrame: 360,
      frameCount: 120,
    });
  });

  it("clamps both ends to the composition and defaults the missing one", () => {
    expect(resolveRenderRange(comp(), { from: 1.5, to: 99 })).toEqual({
      startFrame: 7,
      frameCount: 3,
    });
    expect(resolveRenderRange(comp(), { to: 1 })).toEqual({ startFrame: 0, frameCount: 5 });
    expect(resolveRenderRange(comp(), { from: 1 })).toEqual({ startFrame: 5, frameCount: 5 });
  });

  it("handles rational fps exactly", () => {
    const c = comp({ fps: "30000/1001", duration: 20 });
    // 10.01 s @ 29.97 is exactly frame 300.
    expect(resolveRenderRange(c, { from: 10.01, to: 11.011 })).toEqual({
      startFrame: 300,
      frameCount: 30,
    });
  });

  it("rejects an empty or non-finite window", () => {
    expect(() => resolveRenderRange(comp(), { from: 1, to: 1 })).toThrow(RangeError);
    expect(() => resolveRenderRange(comp(), { from: 5, to: 9 })).toThrow(/empty/);
    expect(() => resolveRenderRange(comp(), { from: Number.NaN })).toThrow(RangeError);
  });
});

describe("renderToFile — range", () => {
  it("pipes ceil((to − from) × fps) frames and reports that total", async () => {
    const harness = makeFakeSpawn({ exitCode: 0 });
    const totals = new Set<number>();
    const result = await renderToFile(comp(), "/tmp/beat.mp4", {
      skiaCanvas: makeFakeSkia(),
      spawn: harness.spawn,
      range: { from: 0.5, to: 1.3 },
      onProgress: ({ total }) => totals.add(total),
    });
    expect(result.frameCount).toBe(4);
    expect(harness.calls[0]!.ffmpeg.stdin.writes).toHaveLength(4);
    expect([...totals]).toEqual([4]);
  });

  it("fails fast on an empty range, before spawning ffmpeg", async () => {
    const harness = makeFakeSpawn({ exitCode: 0 });
    await expect(
      renderToFile(comp(), "/tmp/x.mp4", {
        skiaCanvas: makeFakeSkia(),
        spawn: harness.spawn,
        range: { from: 3, to: 4 },
      }),
    ).rejects.toThrow(RangeError);
    expect(harness.calls).toHaveLength(0);
  });

  it("cuts the audio mix at the range start and caps it to the range length", async () => {
    const harness = makeFakeSpawn({ exitCode: 0 });
    await renderToFile(
      comp({}, [{ id: "m", asset: "music", start: 0 }]),
      "/tmp/beat.mp4",
      { skiaCanvas: makeFakeSkia(), spawn: harness.spawn, range: { from: 1, to: 1.6 } },
    );
    const mux = harness.calls[1]!.args;
    const filter = mux[mux.indexOf("-filter_complex") + 1]!;
    expect(filter).toContain("[a0]atrim=start=1,asetpts=PTS-STARTPTS,alimiter=");
    expect(filter).toMatch(/atrim=0:0\.6\[aout\]$/);
  });
});

describe("buildAudioFilterComplex — timelineOffset (v1.1 S12)", () => {
  const bed: ResolvedAudioTrack = {
    track: { id: "bed", asset: "music", start: 0, loop: true },
    src: "/a/music.mp3",
  };

  it("offset 0 is byte-identical to the unranged graph", () => {
    expect(buildAudioFilterComplex([bed], 2, {}, undefined, 0)).toBe(
      buildAudioFilterComplex([bed], 2),
    );
  });

  it("loops run to the end of the rendered window, not just its length", () => {
    const filter = buildAudioFilterComplex([bed], 1, { limiter: false }, undefined, 3);
    expect(filter).toContain("aloop=loop=-1:size=2147483647,atrim=0:4,");
    expect(filter).toContain("[a0]atrim=start=3,asetpts=PTS-STARTPTS,apad,atrim=0:1[aout]");
  });

  it("the loudness analysis pass measures the same window", () => {
    const filter = buildLoudnormAnalysisFilterComplex([bed], 1, -16, 3);
    expect(filter).toContain("[a0]atrim=start=3,asetpts=PTS-STARTPTS,atrim=0:1,loudnorm=");
  });
});

describe("renderToFile — PNG sequence", () => {
  it("recognises %0Nd.png patterns", () => {
    expect(isPngSequencePath("/o/frames/%05d.png")).toBe(true);
    expect(isPngSequencePath("/o/f_%d.PNG")).toBe(true);
    expect(isPngSequencePath("/o/out.png")).toBe(false);
    expect(isPngSequencePath("/o/out.mp4")).toBe(false);
    expect(pngSequenceFramePath("/o/f/%05d.png", 7)).toBe("/o/f/00007.png");
    expect(pngSequenceFramePath("/o/f_%d.png", 12)).toBe("/o/f_12.png");
  });

  it("a %05d.png outPath writes one PNG per frame without ffmpeg", async () => {
    const dir = tmp();
    const harness = makeFakeSpawn({ exitCode: 0 });
    const result = await renderToFile(
      comp({}, [{ id: "m", asset: "music", start: 0 }]),
      join(dir, "seq", "%05d.png"),
      { skiaCanvas: makeFakeSkia(), spawn: harness.spawn },
    );
    expect(harness.calls).toHaveLength(0);
    expect(result.frameCount).toBe(10);
    expect(result.outputPath).toBe(join(dir, "seq", "%05d.png"));
    const files = readdirSync(join(dir, "seq")).sort();
    expect(files).toHaveLength(10);
    expect(files[0]).toBe("00001.png");
    expect(files[9]).toBe("00010.png");
  });

  it("format png-sequence into a directory, with a range: count matches", async () => {
    const dir = tmp();
    const harness = makeFakeSpawn({ exitCode: 0 });
    const result = await renderToFile(comp(), join(dir, "frames"), {
      skiaCanvas: makeFakeSkia(),
      spawn: harness.spawn,
      format: "png-sequence",
      range: { from: 0.4, to: 1.1 },
    });
    expect(harness.calls).toHaveLength(0);
    expect(result.frameCount).toBe(4); // ceil(0.7 × 5)
    expect(result.outputPath).toBe(join(dir, "frames", "%05d.png"));
    expect(readdirSync(join(dir, "frames"))).toHaveLength(4);
  });
});
