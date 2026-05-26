// Real-ffprobe integration for `probeVideo` (v0.2 §S6 verification).
//
// Runs the bundled `ffprobe-static` binary against the four committed video
// fixtures the plan calls for — small, 4K, long, and a webm with alpha — and
// asserts the extracted metadata. Regenerate the fixtures with
// tests/drivers/fixtures/video/generate.sh.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  probeVideo,
  pixelFormatHasAlpha,
} from "../../src/drivers/node/ffprobe.js";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "video",
);

describe("probeVideo — real files (ffprobe-static)", () => {
  it("reads metadata from a small h264 mp4", async () => {
    const meta = await probeVideo(join(FIXTURES, "small.mp4"));
    expect(meta.codec).toBe("h264");
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(240);
    expect(meta.fps).toBeCloseTo(30, 5);
    expect(meta.pixelFormat).toBe("yuv420p");
    expect(meta.hasAlpha).toBe(false);
    expect(meta.duration).toBeCloseTo(1, 1);
  });

  it("reads 4K resolution from a UHD mp4", async () => {
    const meta = await probeVideo(join(FIXTURES, "uhd-4k.mp4"));
    expect(meta.codec).toBe("h264");
    expect(meta.width).toBe(3840);
    expect(meta.height).toBe(2160);
    expect(meta.fps).toBeCloseTo(24, 5);
    expect(meta.hasAlpha).toBe(false);
  });

  it("reads a >60s duration from a long mp4", async () => {
    const meta = await probeVideo(join(FIXTURES, "long.mp4"));
    expect(meta.codec).toBe("h264");
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(72);
    expect(meta.duration).toBeGreaterThan(60);
    expect(meta.hasAlpha).toBe(false);
  });

  it("detects alpha in a webm whose alpha lives in the alpha_mode tag", async () => {
    const meta = await probeVideo(join(FIXTURES, "alpha.webm"));
    expect(meta.codec).toBe("vp9");
    expect(meta.width).toBe(160);
    expect(meta.height).toBe(120);
    // WebM stores VP9 alpha out-of-band: pix_fmt stays yuv420p, alpha_mode=1.
    expect(meta.pixelFormat).toBe("yuv420p");
    expect(meta.hasAlpha).toBe(true);
  });

  it("rejects a file with no video stream", async () => {
    await expect(
      probeVideo(join(FIXTURES, "does-not-exist.mp4")),
    ).rejects.toThrow();
  });
});

describe("pixelFormatHasAlpha", () => {
  it("flags alpha-bearing pixel formats", () => {
    for (const fmt of [
      "yuva420p",
      "yuva444p10le",
      "ya8",
      "ya16le",
      "rgba",
      "bgra",
      "argb",
      "abgr",
      "gbrap",
      "gbrap10le",
    ]) {
      expect(pixelFormatHasAlpha(fmt), fmt).toBe(true);
    }
  });

  it("rejects opaque pixel formats", () => {
    for (const fmt of [
      "yuv420p",
      "yuv444p",
      "yuv420p10le",
      "rgb24",
      "bgr0",
      "gbrp",
      "gray",
    ]) {
      expect(pixelFormatHasAlpha(fmt), fmt).toBe(false);
    }
  });
});
