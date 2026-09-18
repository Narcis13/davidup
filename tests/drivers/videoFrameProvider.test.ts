// Unit test for the node driver's §S8 frame binding: buildVideoFrameProvider
// turns a pre-extract result (cache dirs + frame counts) into a
// VideoFrameProvider the renderer draws from. Since v1.1 S6 frames decode into
// a bounded sliding window, warmed by `prepare` before each draw. Uses a fake skia.loadImage so it
// needs no native build and no real PNGs on disk — loadImage just echoes the
// path it was asked to decode.

import { describe, expect, it, vi } from "vitest";

import {
  buildVideoFrameProvider,
  DEFAULT_MAX_DECODED_FRAMES,
  SlidingWindowClip,
} from "../../src/drivers/node/index.js";
import type {
  FrameCacheEntry,
  PreExtractResult,
} from "../../src/drivers/node/index.js";

function entry(over: Partial<FrameCacheEntry> & Pick<FrameCacheEntry, "hash" | "dir" | "frameCount" | "itemIds">): FrameCacheEntry {
  return {
    width: 320,
    height: 240,
    bytes: 1000,
    cached: false,
    ...over,
  };
}

function result(entries: FrameCacheEntry[]): PreExtractResult {
  return {
    root: "/cache/frames",
    entries: new Map(entries.map((e) => [e.hash, e])),
    cacheBytes: entries.reduce((s, e) => s + e.bytes, 0),
    pruned: [],
  };
}

describe("buildVideoFrameProvider", () => {
  it("maps each item id to its clip and decodes frames on demand", async () => {
    const loadImage = vi.fn(async (src: string) => ({ src }));
    const res = result([
      entry({
        hash: "abc",
        dir: "/cache/frames/abc",
        frameCount: 3,
        width: 320,
        height: 240,
        itemIds: ["v1", "v2"], // two items share one cache entry
      }),
    ]);

    const provider = await buildVideoFrameProvider(res, { loadImage });

    // Only frame 1 is decoded up front (for its intrinsic size).
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledWith("/cache/frames/abc/00001.png");

    // Both items resolve to the same clip with the right metadata.
    const clip1 = provider.getClip("v1");
    const clip2 = provider.getClip("v2");
    expect(clip1).toBeDefined();
    expect(clip2).toBe(clip1);
    expect(clip1!.frameCount).toBe(3);
    expect(clip1!.width).toBe(320);
    expect(clip1!.height).toBe(240);

    // getFrame is 1-based; frames outside the window are loaded by prepare,
    // padded to ffmpeg's %05d.png naming.
    expect(clip1!.getFrame(1)).toEqual({ src: "/cache/frames/abc/00001.png" });
    await clip1!.prepare!([{ frameIndex: 3, loop: false }]);
    expect(loadImage).toHaveBeenCalledWith("/cache/frames/abc/00003.png");
    expect(clip1!.getFrame(3)).toEqual({ src: "/cache/frames/abc/00003.png" });
  });

  it("returns undefined for out-of-range frame indices", async () => {
    const loadImage = vi.fn(async (src: string) => ({ src }));
    const res = result([
      entry({ hash: "h", dir: "/c/h", frameCount: 2, itemIds: ["v"] }),
    ]);
    const provider = await buildVideoFrameProvider(res, { loadImage });
    const clip = provider.getClip("v")!;
    await clip.prepare!([
      { frameIndex: 0, loop: false },
      { frameIndex: 3, loop: false },
    ]);
    expect(clip.getFrame(0)).toBeUndefined();
    expect(clip.getFrame(3)).toBeUndefined();
  });

  it("returns undefined for an unknown item id", async () => {
    const loadImage = vi.fn(async (src: string) => ({ src }));
    const res = result([
      entry({ hash: "h", dir: "/c/h", frameCount: 1, itemIds: ["v"] }),
    ]);
    const provider = await buildVideoFrameProvider(res, { loadImage });
    expect(provider.getClip("nope")).toBeUndefined();
  });

  it("builds independent clips for distinct cache entries", async () => {
    const loadImage = vi.fn(async (src: string) => ({ src }));
    const res = result([
      entry({ hash: "a", dir: "/c/a", frameCount: 1, width: 100, height: 50, itemIds: ["a"] }),
      entry({ hash: "b", dir: "/c/b", frameCount: 1, width: 80, height: 80, itemIds: ["b"] }),
    ]);
    const provider = await buildVideoFrameProvider(res, { loadImage });
    expect(provider.getClip("a")!.width).toBe(100);
    expect(provider.getClip("b")!.width).toBe(80);
    expect(provider.getClip("a")!.getFrame(1)).toEqual({ src: "/c/a/00001.png" });
    expect(provider.getClip("b")!.getFrame(1)).toEqual({ src: "/c/b/00001.png" });
  });

  it("never holds more than maxDecodedFrames while playing through a clip", async () => {
    const loadImage = vi.fn(
      (src: string) => new Promise((r) => setTimeout(() => r({ src }), 0)),
    );
    const max = 8;
    const res = result([
      entry({ hash: "h", dir: "/c/h", frameCount: 120, itemIds: ["v"] }),
    ]);
    const provider = await buildVideoFrameProvider(res, { loadImage }, {
      maxDecodedFrames: max,
    });
    const clip = provider.getClip("v") as SlidingWindowClip;

    // 300 draws of a looping item: wraps the 120-frame clip twice.
    let peak = clip.residentFrames;
    for (let n = 0; n < 300; n++) {
      const frameIndex = (n % 120) + 1;
      await clip.prepare([{ frameIndex, loop: true }]);
      // The frame about to be drawn is always resident after prepare.
      expect(clip.getFrame(frameIndex)).toEqual({
        src: `/c/h/${String(frameIndex).padStart(5, "0")}.png`,
      });
      peak = Math.max(peak, clip.residentFrames);
      // Let background prefetches land between frames, as encoding would.
      await new Promise((r) => setTimeout(r, 0));
      peak = Math.max(peak, clip.residentFrames);
    }
    expect(peak).toBeLessThanOrEqual(max);
    expect(peak).toBeGreaterThan(1); // read-ahead actually happened
  });

  it("prefetches ahead so sequential frames are usually already decoded", async () => {
    const loadImage = vi.fn(async (src: string) => ({ src }));
    const res = result([
      entry({ hash: "h", dir: "/c/h", frameCount: 50, itemIds: ["v"] }),
    ]);
    const provider = await buildVideoFrameProvider(res, { loadImage });
    const clip = provider.getClip("v") as SlidingWindowClip;
    await clip.prepare([{ frameIndex: 1, loop: false }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(clip.getFrame(5)).toBeDefined();
    expect(clip.residentFrames).toBeLessThanOrEqual(DEFAULT_MAX_DECODED_FRAMES);
  });

  it("wraps read-ahead for looping items and evicts frames outside the window", async () => {
    const loadImage = vi.fn(async (src: string) => ({ src }));
    const res = result([
      entry({ hash: "h", dir: "/c/h", frameCount: 40, itemIds: ["v"] }),
    ]);
    const provider = await buildVideoFrameProvider(res, { loadImage });
    const clip = provider.getClip("v") as SlidingWindowClip;
    await clip.prepare([{ frameIndex: 39, loop: true }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(clip.getFrame(2)).toBeDefined(); // wrapped past frame 40
    expect(clip.getFrame(1)).toBeDefined();
    await clip.prepare([{ frameIndex: 20, loop: false }]);
    expect(clip.getFrame(39)).toBeUndefined();
    expect(clip.getFrame(2)).toBeUndefined();
  });

  it("rejects a non-positive maxDecodedFrames", async () => {
    const loadImage = vi.fn(async (src: string) => ({ src }));
    const res = result([entry({ hash: "h", dir: "/c/h", frameCount: 1, itemIds: ["v"] })]);
    await expect(
      buildVideoFrameProvider(res, { loadImage }, { maxDecodedFrames: 0 }),
    ).rejects.toThrow(RangeError);
  });
});
