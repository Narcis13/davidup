// Unit tests for the MCP render helpers. We use the same FakeContext +
// fake-skia pattern the node driver tests use, so we exercise:
//   - sampleTimes() linspace + edge cases
//   - renderPreviewFrame returns a base64 string + correct mimeType
//   - renderThumbnailStrip returns `count` images and the parallel `times` array
// without needing the native skia binary.

import { describe, expect, it } from "vitest";

import {
  renderPreviewFrame,
  renderThumbnailStrip,
  sampleTimes,
} from "../../src/mcp/render.js";
import type { Composition } from "../../src/schema/types.js";
import { FakeContext } from "../engine/fakeContext.js";

function tinyComp(duration = 1): Composition {
  return {
    version: "0.1",
    composition: {
      width: 8,
      height: 8,
      fps: 5,
      duration,
      background: "#000000",
    },
    assets: [],
    layers: [
      { id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["s"] },
    ],
    items: {
      s: {
        type: "shape",
        kind: "rect",
        width: 4,
        height: 4,
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

interface FakeCanvas {
  width: number;
  height: number;
  ctx: FakeContext;
  getContext: () => FakeContext;
  toBuffer: (fmt: "png" | "jpg") => Promise<Uint8Array>;
}

function makeFakeSkia(): {
  Canvas: new (w: number, h: number) => FakeCanvas;
  loadImage: (src: string) => Promise<unknown>;
  FontLibrary: { use: (family: string, paths: ReadonlyArray<string>) => void };
  bufferCalls: number;
} {
  const state = { bufferCalls: 0 };

  class Canvas implements FakeCanvas {
    width: number;
    height: number;
    ctx: FakeContext = new FakeContext();
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext(): FakeContext {
      return this.ctx;
    }
    async toBuffer(fmt: "png" | "jpg"): Promise<Uint8Array> {
      state.bufferCalls++;
      // Distinct byte signature per format so tests can tell PNG vs JPEG output.
      const head =
        fmt === "png"
          ? [0x89, 0x50, 0x4e, 0x47]
          : [0xff, 0xd8, 0xff, 0xe0];
      return new Uint8Array([...head, ...new Array(this.width * this.height).fill(0)]);
    }
  }

  return {
    Canvas: Canvas as unknown as new (w: number, h: number) => FakeCanvas,
    loadImage: async (src: string) => ({ src }),
    FontLibrary: { use: () => undefined },
    get bufferCalls() {
      return state.bufferCalls;
    },
  };
}

describe("sampleTimes", () => {
  it("returns midpoint when count===1", () => {
    expect(sampleTimes(2, 1)).toEqual([1]);
  });
  it("returns linspace including endpoints when count>=2", () => {
    expect(sampleTimes(1, 2)).toEqual([0, 1]);
    expect(sampleTimes(1, 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
  it("returns empty array for count<=0", () => {
    expect(sampleTimes(1, 0)).toEqual([]);
  });
});

describe("renderPreviewFrame (fake skia)", () => {
  it("returns a base64 image, mime type, and matching dimensions", async () => {
    const skia = makeFakeSkia() as unknown as Parameters<
      typeof renderPreviewFrame
    >[2] extends { skiaCanvas?: infer S } | undefined
      ? S
      : never;
    const result = await renderPreviewFrame(tinyComp(), 0.5, {
      skiaCanvas: skia as never,
    });
    expect(result.mimeType).toBe("image/png");
    expect(typeof result.image).toBe("string");
    // base64 of [0x89,0x50,0x4e,0x47, …zeros] starts with "iVBORw==" prefix.
    expect(result.image.startsWith("iVBORw")).toBe(true);
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
  });

  it("supports JPEG format", async () => {
    const skia = makeFakeSkia();
    const result = await renderPreviewFrame(tinyComp(), 0, {
      skiaCanvas: skia as never,
      format: "jpeg",
    });
    expect(result.mimeType).toBe("image/jpeg");
    // base64 of [0xff,0xd8,0xff,0xe0, …zeros] starts with "/9j/" prefix.
    expect(result.image.startsWith("/9j/")).toBe(true);
  });

  it("rejects negative time", async () => {
    const skia = makeFakeSkia();
    await expect(
      renderPreviewFrame(tinyComp(), -1, { skiaCanvas: skia as never }),
    ).rejects.toThrow();
  });
});

describe("renderThumbnailStrip (fake skia)", () => {
  it("emits `count` PNGs aligned with the sample times array", async () => {
    const skia = makeFakeSkia();
    const result = await renderThumbnailStrip(tinyComp(2), {
      count: 4,
      skiaCanvas: skia as never,
    });
    expect(result.images).toHaveLength(4);
    expect(result.times).toEqual([0, 2 / 3, 4 / 3, 2]);
    for (const img of result.images) {
      expect(img.startsWith("iVBORw")).toBe(true);
    }
  });

  it("rejects non-positive count", async () => {
    const skia = makeFakeSkia();
    await expect(
      renderThumbnailStrip(tinyComp(), { count: 0, skiaCanvas: skia as never }),
    ).rejects.toThrow();
  });
});
