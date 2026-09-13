// Unit tests for the MCP render helpers. We use the same FakeContext +
// fake-skia pattern the node driver tests use, so we exercise:
//   - sampleTimes() linspace + edge cases
//   - renderPreviewFrame returns a base64 string + correct mimeType
//   - renderThumbnailStrip returns `count` images and the parallel `times` array
// without needing the native skia binary. The S4 video block at the bottom is
// the exception: it uses real skia + bundled ffmpeg to pixel-probe footage.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  renderPreviewFrame,
  renderThumbnailStrip,
  sampleTimes,
  THUMBNAIL_STRIP_MAX_COUNT,
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

  it("rejects count above THUMBNAIL_STRIP_MAX_COUNT with a structured, hinted error", async () => {
    const skia = makeFakeSkia();
    await expect(
      renderThumbnailStrip(tinyComp(), {
        count: THUMBNAIL_STRIP_MAX_COUNT + 1,
        skiaCanvas: skia as never,
      }),
    ).rejects.toMatchObject({
      code: "E_INVALID_VALUE",
      hint: expect.stringContaining(String(THUMBNAIL_STRIP_MAX_COUNT)),
    });
  });

  it("accepts count exactly at THUMBNAIL_STRIP_MAX_COUNT", async () => {
    const skia = makeFakeSkia();
    const result = await renderThumbnailStrip(tinyComp(10), {
      count: THUMBNAIL_STRIP_MAX_COUNT,
      skiaCanvas: skia as never,
    });
    expect(result.images).toHaveLength(THUMBNAIL_STRIP_MAX_COUNT);
  });
});

// ── v1.1 S4: video items in previews ───────────────────────────────────────

const VIDEO_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drivers",
  "fixtures",
  "video",
  "small.mp4",
);

// 640×360 pure-blue stage with the 320×240 fixture in the top-left 320×240 box.
function videoComp(src = VIDEO_FIXTURE): Composition {
  return {
    version: "0.1",
    composition: { width: 640, height: 360, fps: 30, duration: 1, background: "#0000ff" },
    assets: [
      { id: "clip", type: "video", src, duration: 1, width: 320, height: 240, fps: 30 },
    ],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["v"] }],
    items: {
      v: {
        type: "video",
        asset: "clip",
        width: 320,
        height: 240,
        start: 0,
        trimIn: 0,
        trimOut: 1,
        fit: "contain",
        loop: false,
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

describe("video items in previews (fake skia)", () => {
  it("renders the rest of the frame and warns when the video source is missing", async () => {
    const skia = makeFakeSkia();
    const result = await renderPreviewFrame(videoComp("/nonexistent/clip.mp4"), 0.5, {
      skiaCanvas: skia as never,
    });
    expect(result.image.startsWith("iVBORw")).toBe(true);
    expect(result.warnings).toEqual([
      expect.stringContaining("Video frames unavailable"),
    ]);
  });

  it("omits `warnings` for compositions without video", async () => {
    const skia = makeFakeSkia();
    const result = await renderPreviewFrame(tinyComp(), 0, { skiaCanvas: skia as never });
    expect(result).not.toHaveProperty("warnings");
  });
});

describe("video items in previews — real skia + ffmpeg (S4)", () => {
  // Real skia module (loaded once — the provider cache is keyed by its identity).
  let skia: {
    Canvas: new (w: number, h: number) => {
      getContext(k: "2d"): {
        drawImage(img: unknown, x: number, y: number): void;
        getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
      };
    };
    loadImage(src: Buffer | string): Promise<unknown>;
  };
  let ffmpegPath: string | undefined;
  let cacheRoot: string;

  beforeAll(async () => {
    skia = (await import("skia-canvas")) as unknown as typeof skia;
    ffmpegPath =
      ((await import("ffmpeg-static")).default as unknown as string | null) ?? undefined;
    cacheRoot = mkdtempSync(join(tmpdir(), "davidup-s4-preview-cache-"));
  });

  afterAll(() => {
    rmSync(cacheRoot, { recursive: true, force: true });
  });

  async function pixel(base64: string, x: number, y: number): Promise<number[]> {
    const img = await skia.loadImage(Buffer.from(base64, "base64"));
    const canvas = new skia.Canvas(640, 360);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
  }

  const isBlue = (px: number[]) => px[0]! < 10 && px[1]! < 10 && px[2]! > 245;

  it("preview inside the video span shows footage where the clip is", async () => {
    const result = await renderPreviewFrame(videoComp(), 0.5, {
      skiaCanvas: skia as never,
      preExtract: { cacheRoot, ffmpegPath },
    });
    // First call had to extract → latency hint.
    expect(result.warnings).toEqual([expect.stringContaining("Extracted")]);

    // Inside the clip box: not background. Every probe in the box must differ
    // from blue somewhere, so sample a few points and require all non-blue.
    for (const [x, y] of [[40, 40], [160, 120], [280, 200]] as const) {
      expect(isBlue(await pixel(result.image, x, y))).toBe(false);
    }
    // Outside the clip box: background.
    expect(isBlue(await pixel(result.image, 500, 300))).toBe(true);
  }, 30_000);

  it("thumbnail strip reuses the cached provider (no re-extraction) and composites video", async () => {
    const result = await renderThumbnailStrip(videoComp(), {
      count: 3,
      skiaCanvas: skia as never,
      preExtract: { cacheRoot, ffmpegPath },
    });
    expect(result).not.toHaveProperty("warnings");
    expect(isBlue(await pixel(result.images[1]!, 160, 120))).toBe(false);
  }, 30_000);

  it("preExtract: false leaves the clip box empty", async () => {
    const result = await renderPreviewFrame(videoComp(), 0.5, {
      skiaCanvas: skia as never,
      preExtract: false,
    });
    expect(isBlue(await pixel(result.image, 160, 120))).toBe(true);
  });
});
