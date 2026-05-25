import { describe, expect, it, vi } from "vitest";
import {
  NodeAssetLoader,
  type SkiaCanvasModule,
} from "../../src/assets/index.js";

function fakeSkia(): SkiaCanvasModule & {
  loadImage: ReturnType<typeof vi.fn>;
  FontLibrary: { use: ReturnType<typeof vi.fn> };
} {
  return {
    loadImage: vi.fn(async (src: string) => ({ src, width: 10, height: 10 })),
    FontLibrary: {
      use: vi.fn(),
    },
  };
}

describe("NodeAssetLoader", () => {
  it("loads images via skia-canvas loadImage", async () => {
    const skia = fakeSkia();
    const loader = new NodeAssetLoader({ skiaCanvas: skia });

    await loader.preloadAll([{ id: "logo", type: "image", src: "logo.png" }]);

    expect(skia.loadImage).toHaveBeenCalledWith("logo.png");
    expect(loader.getImage("logo")).toEqual({
      src: "logo.png",
      width: 10,
      height: 10,
    });
  });

  it("registers fonts via skia-canvas FontLibrary.use", async () => {
    const skia = fakeSkia();
    const loader = new NodeAssetLoader({ skiaCanvas: skia });

    await loader.preloadAll([
      { id: "inter", type: "font", src: "Inter.ttf", family: "Inter" },
    ]);

    expect(skia.FontLibrary.use).toHaveBeenCalledWith("Inter", ["Inter.ttf"]);
    expect(loader.getFontFamily("inter")).toBe("Inter");
  });

  it("preloads a mixed asset list in one call", async () => {
    const skia = fakeSkia();
    const loader = new NodeAssetLoader({ skiaCanvas: skia });

    await loader.preloadAll([
      { id: "a", type: "image", src: "a.png" },
      { id: "b", type: "image", src: "b.png" },
      { id: "f", type: "font", src: "F.ttf", family: "F" },
    ]);

    expect(skia.loadImage).toHaveBeenCalledTimes(2);
    expect(skia.FontLibrary.use).toHaveBeenCalledTimes(1);
    expect(loader.getImage("a")).toBeDefined();
    expect(loader.getImage("b")).toBeDefined();
    expect(loader.getFontFamily("f")).toBe("F");
  });

  it("resolves `global:` srcs against an explicit library root", async () => {
    const skia = fakeSkia();
    const loader = new NodeAssetLoader({
      skiaCanvas: skia,
      globalLibraryRoot: "/tmp/lib",
    });

    await loader.preloadAll([
      { id: "g", type: "image", src: "global:assets/abc.png" },
      { id: "f", type: "font", src: "global:fonts/Inter.ttf", family: "Inter" },
    ]);

    expect(skia.loadImage).toHaveBeenCalledWith("/tmp/lib/assets/abc.png");
    expect(skia.FontLibrary.use).toHaveBeenCalledWith("Inter", [
      "/tmp/lib/fonts/Inter.ttf",
    ]);
  });

  it("falls back to $DAVIDUP_LIBRARY env var for `global:` srcs", async () => {
    const skia = fakeSkia();
    const prev = process.env.DAVIDUP_LIBRARY;
    process.env.DAVIDUP_LIBRARY = "/env/lib";
    try {
      const loader = new NodeAssetLoader({ skiaCanvas: skia });
      await loader.preloadAll([
        { id: "g", type: "image", src: "global:assets/x.png" },
      ]);
      expect(skia.loadImage).toHaveBeenCalledWith("/env/lib/assets/x.png");
    } finally {
      if (prev === undefined) delete process.env.DAVIDUP_LIBRARY;
      else process.env.DAVIDUP_LIBRARY = prev;
    }
  });

  it("leaves non-`global:` srcs untouched", async () => {
    const skia = fakeSkia();
    const loader = new NodeAssetLoader({
      skiaCanvas: skia,
      globalLibraryRoot: "/tmp/lib",
    });

    await loader.preloadAll([
      { id: "rel", type: "image", src: "./logo.png" },
      { id: "abs", type: "image", src: "/absolute/path.png" },
    ]);

    expect(skia.loadImage).toHaveBeenCalledWith("./logo.png");
    expect(skia.loadImage).toHaveBeenCalledWith("/absolute/path.png");
  });
});
