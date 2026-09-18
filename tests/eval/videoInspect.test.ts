// Unit tests for the eval harness's frame-inspection heuristic
// (scripts/eval-agents/videoInspect.ts). Pure buffer math — no ffmpeg
// subprocess involved — so this always runs, unlike the gated end-to-end
// agent eval test.

import { describe, expect, it } from "vitest";

import { frameStats, isNonBlank } from "../../scripts/eval-agents/videoInspect.js";

function solidFrame(width: number, height: number, r: number, g: number, b: number): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = 255;
  }
  return buf;
}

function noisyFrame(width: number, height: number, seed = 1): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  let x = seed;
  for (let i = 0; i < buf.length; i += 4) {
    // xorshift — deterministic, cheap, good enough to fake "real content".
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const v = x & 0xff;
    buf[i] = v;
    buf[i + 1] = (v * 3) & 0xff;
    buf[i + 2] = (255 - v) & 0xff;
    buf[i + 3] = 255;
  }
  return buf;
}

describe("videoInspect — frame-inspection heuristic", () => {
  it("reports zero spread for a perfectly solid-color frame", () => {
    const frame = solidFrame(64, 64, 20, 30, 40);
    const stats = frameStats(frame);
    // Floating-point roundoff in the variance formula can leave a hair of
    // noise even for perfectly flat input — assert "effectively zero", not
    // exactly zero.
    expect(stats.stddev).toBeLessThan(1e-3);
    expect(stats.samples).toBeGreaterThan(0);
  });

  it("flags a solid-color frame as blank", () => {
    const frame = solidFrame(64, 64, 200, 200, 200);
    expect(isNonBlank(frame)).toBe(false);
  });

  it("flags a frame with real variation as non-blank", () => {
    const frame = noisyFrame(64, 64);
    const stats = frameStats(frame);
    expect(stats.stddev).toBeGreaterThan(1.5);
    expect(isNonBlank(frame)).toBe(true);
  });

  it("a half-and-half two-tone frame is non-blank even with a coarse sampling stride", () => {
    const width = 200;
    const height = 200;
    const buf = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const isRight = x >= width / 2;
        buf[i] = isRight ? 250 : 5;
        buf[i + 1] = isRight ? 250 : 5;
        buf[i + 2] = isRight ? 250 : 5;
        buf[i + 3] = 255;
      }
    }
    expect(isNonBlank(buf)).toBe(true);
  });

  it("respects a custom threshold", () => {
    const frame = noisyFrame(32, 32, 7);
    const stats = frameStats(frame);
    expect(isNonBlank(frame, stats.stddev + 1)).toBe(false);
    expect(isNonBlank(frame, Math.max(0, stats.stddev - 1))).toBe(true);
  });
});
