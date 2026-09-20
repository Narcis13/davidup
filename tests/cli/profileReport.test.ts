// `davidup render --profile` table (v1.3 G8). Pure formatting, so the shape
// of the report is pinned without paying for a render.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROFILE_BAND_SECONDS,
  bandProfile,
  formatProfileReport,
} from "../../src/cli/profileReport.js";
import { emptyRenderProfile } from "../../src/engine/index.js";
import type { FrameProfileRecord, RenderProfileReport } from "../../src/drivers/node/index.js";

function frame(
  t: number,
  paintMs: number,
  engine: Partial<ReturnType<typeof emptyRenderProfile>> = {},
): FrameProfileRecord {
  return {
    frame: Math.round(t * 30),
    t,
    paintMs,
    videoMs: 0,
    engine: { ...emptyRenderProfile(), ...engine },
  };
}

function report(frames: FrameProfileRecord[]): RenderProfileReport {
  return {
    fps: 30,
    paintMsTotal: frames.reduce((a, f) => a + f.paintMs, 0),
    frames,
  };
}

describe("bandProfile", () => {
  it("groups frames by composition time and averages each band", () => {
    const bands = bandProfile(
      report([
        frame(0, 100, { blurMs: 40, offscreens: 2, offscreenPixels: 1e6 }),
        frame(1, 300, { blurMs: 60, offscreens: 4, offscreenPixels: 3e6 }),
        frame(2.5, 50, { blurMs: 0, offscreens: 1, offscreenPixels: 5e5 }),
      ]),
      2,
    );

    expect(bands.map((b) => [b.from, b.to, b.frames])).toEqual([
      [0, 2, 2],
      [2, 4, 1],
    ]);
    // 200 ms a frame is 5 fps; the band's blur average is (40 + 60) / 2.
    expect(bands[0]!.paintMs).toBe(200);
    expect(bands[0]!.fps).toBeCloseTo(5, 10);
    expect(bands[0]!.blurMs).toBe(50);
    expect(bands[0]!.offscreens).toBe(3);
    expect(bands[0]!.offscreenMpx).toBeCloseTo(2, 10);
    expect(bands[1]!.fps).toBeCloseTo(20, 10);
  });

  it("puts every frame in exactly one band, whatever the band width", () => {
    const frames = Array.from({ length: 31 }, (_, i) => frame(i / 10, 10));
    for (const width of [0.25, 1, DEFAULT_PROFILE_BAND_SECONDS, 7]) {
      const bands = bandProfile(report(frames), width);
      expect(bands.reduce((a, b) => a + b.frames, 0)).toBe(frames.length);
      // Sorted, and no band is empty.
      expect(bands.map((b) => b.from)).toEqual([...bands.map((b) => b.from)].sort((a, b) => a - b));
      expect(bands.every((b) => b.frames > 0)).toBe(true);
    }
  });
});

describe("formatProfileReport", () => {
  it("prints a row per band plus totals, in fps and as a realtime factor", () => {
    const text = formatProfileReport(
      report([
        frame(0, 500, { blurMs: 400, offscreens: 6, offscreenPixels: 12e6 }),
        frame(2, 250, { blurMs: 0, offscreens: 2, offscreenPixels: 4e6 }),
      ]),
      2,
    );
    const lines = text.split("\n");
    expect(lines[0]).toContain("paint ms");
    expect(lines[1]).toContain("0.0–2.0");
    expect(lines[2]).toContain("2.0–4.0");
    // 2 frames in 0.75 s of paint = 2.67 fps, against a 30 fps composition.
    expect(text).toContain("total 2 frames");
    expect(text).toContain("2.67 fps");
    expect(text).toContain("0.09× realtime");
    expect(text).toContain("blur 0.4 s (53.3% of paint)");
    expect(text).toContain("8 scratch surfaces, 16 Mpx allocated");
  });

  it("survives a report whose frames all painted in zero measured time", () => {
    const text = formatProfileReport(report([frame(0, 0), frame(1, 0)]), 2);
    // No clock (or an unmeasurably fast frame) prints an em dash, not NaN.
    expect(text).not.toContain("NaN");
    expect(text).toContain("—");
  });
});
