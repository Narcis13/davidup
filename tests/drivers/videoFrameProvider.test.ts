// Unit test for the node driver's §S8 frame binding: buildVideoFrameProvider
// turns a pre-extract result (cache dirs + frame counts) into a
// VideoFrameProvider the renderer draws from. Uses a fake skia.loadImage so it
// needs no native build and no real PNGs on disk — loadImage just echoes the
// path it was asked to decode.

import { describe, expect, it, vi } from "vitest";

import { buildVideoFrameProvider } from "../../src/drivers/node/index.js";
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
  it("decodes every cache PNG and maps each item id to its clip", async () => {
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

    // Frames decoded once each, padded to ffmpeg's %05d.png naming.
    expect(loadImage).toHaveBeenCalledTimes(3);
    expect(loadImage).toHaveBeenCalledWith("/cache/frames/abc/00001.png");
    expect(loadImage).toHaveBeenCalledWith("/cache/frames/abc/00002.png");
    expect(loadImage).toHaveBeenCalledWith("/cache/frames/abc/00003.png");

    // Both items resolve to the same clip with the right metadata.
    const clip1 = provider.getClip("v1");
    const clip2 = provider.getClip("v2");
    expect(clip1).toBeDefined();
    expect(clip2).toBe(clip1);
    expect(clip1!.frameCount).toBe(3);
    expect(clip1!.width).toBe(320);
    expect(clip1!.height).toBe(240);

    // getFrame is 1-based and returns the decoded image for that frame.
    expect(clip1!.getFrame(1)).toEqual({ src: "/cache/frames/abc/00001.png" });
    expect(clip1!.getFrame(3)).toEqual({ src: "/cache/frames/abc/00003.png" });
  });

  it("returns undefined for out-of-range frame indices", async () => {
    const loadImage = vi.fn(async (src: string) => ({ src }));
    const res = result([
      entry({ hash: "h", dir: "/c/h", frameCount: 2, itemIds: ["v"] }),
    ]);
    const provider = await buildVideoFrameProvider(res, { loadImage });
    const clip = provider.getClip("v")!;
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
});
