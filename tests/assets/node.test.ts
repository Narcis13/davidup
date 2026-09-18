import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NodeAssetLoader,
  __resetFontClaimsForTests,
  type SkiaCanvasModule,
} from "../../src/assets/index.js";

function fakeSkia(): SkiaCanvasModule & {
  loadImage: ReturnType<typeof vi.fn>;
  FontLibrary: { use: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> };
} {
  return {
    loadImage: vi.fn(async (src: string) => ({ src, width: 10, height: 10 })),
    FontLibrary: {
      use: vi.fn(),
      reset: vi.fn(),
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

  // R-13 / R-32 (Session 28): FontLibrary is a process-global registry with no
  // per-family removal, only a blanket reset(). These tests use family names
  // unique to this block so they don't interact with claims other tests in
  // this file leave behind (nothing here calls clear() elsewhere).
  describe("font claim tracking (R-13, R-32)", () => {
    // Hermetic per-test: the claim table is process-global by design (see
    // src/assets/node.ts), so without this reset a claim left dangling by one
    // `it()` (or by an unrelated test elsewhere in this file that never calls
    // `clear()`) would change whether/when a later test's `clear()` reaches
    // the "everything released" threshold and fires `FontLibrary.reset()`.
    beforeEach(() => {
      __resetFontClaimsForTests();
    });

    it("does not re-register the same (family, path) from a second loader instance", async () => {
      const skiaA = fakeSkia();
      const skiaB = fakeSkia();
      const loaderA = new NodeAssetLoader({ skiaCanvas: skiaA });
      const loaderB = new NodeAssetLoader({ skiaCanvas: skiaB });
      const asset = { id: "f", type: "font" as const, src: "Dup.ttf", family: "ClaimDup" };

      await loaderA.preloadAll([asset]);
      await loaderB.preloadAll([asset]);

      // Both loaders resolve the family locally (their own `getFontFamily`
      // works), but only the *first* claimant actually calls the native
      // FontLibrary — that's what fixed the R-32 pixel drift.
      expect(skiaA.FontLibrary.use).toHaveBeenCalledWith("ClaimDup", ["Dup.ttf"]);
      expect(skiaB.FontLibrary.use).not.toHaveBeenCalled();
      expect(loaderB.getFontFamily("f")).toBe("ClaimDup");

      loaderA.clear();
      loaderB.clear();
    });

    it("still registers a genuinely new path under an already-claimed family", async () => {
      const skiaA = fakeSkia();
      const skiaB = fakeSkia();
      const loaderA = new NodeAssetLoader({ skiaCanvas: skiaA });
      const loaderB = new NodeAssetLoader({ skiaCanvas: skiaB });

      await loaderA.preloadAll([
        { id: "f1", type: "font", src: "Weight-Regular.ttf", family: "ClaimWeights" },
      ]);
      await loaderB.preloadAll([
        { id: "f2", type: "font", src: "Weight-Bold.ttf", family: "ClaimWeights" },
      ]);

      // Different files under the same family alias both take effect.
      expect(skiaA.FontLibrary.use).toHaveBeenCalledWith("ClaimWeights", [
        "Weight-Regular.ttf",
      ]);
      expect(skiaB.FontLibrary.use).toHaveBeenCalledWith("ClaimWeights", [
        "Weight-Bold.ttf",
      ]);

      loaderA.clear();
      loaderB.clear();
    });

    it("clear() only calls FontLibrary.reset() once every claimant has released", async () => {
      const skia = fakeSkia();
      const loaderA = new NodeAssetLoader({ skiaCanvas: skia });
      const loaderB = new NodeAssetLoader({ skiaCanvas: skia });
      const asset = { id: "f", type: "font" as const, src: "Reset.ttf", family: "ClaimReset" };

      await loaderA.preloadAll([asset]);
      await loaderB.preloadAll([asset]);

      loaderA.clear();
      expect(skia.FontLibrary.reset).not.toHaveBeenCalled();

      loaderB.clear();
      expect(skia.FontLibrary.reset).toHaveBeenCalledTimes(1);
    });

    it("counts one claim per (loader, family) regardless of how many assets share it", async () => {
      const skia = fakeSkia();
      const loader = new NodeAssetLoader({ skiaCanvas: skia });

      await loader.preloadAll([
        { id: "f1", type: "font", src: "One.ttf", family: "ClaimSingle" },
        { id: "f2", type: "font", src: "Two.ttf", family: "ClaimSingle" },
      ]);

      // A second, independent loader is the only *other* claimant — releasing
      // the first loader (which registered two assets under the family, but
      // only holds one claim on it) must not under-count and reset early.
      const otherLoader = new NodeAssetLoader({ skiaCanvas: skia });
      await otherLoader.preloadAll([
        { id: "f3", type: "font", src: "Three.ttf", family: "ClaimSingle" },
      ]);

      loader.clear();
      expect(skia.FontLibrary.reset).not.toHaveBeenCalled();
      otherLoader.clear();
      expect(skia.FontLibrary.reset).toHaveBeenCalledTimes(1);
    });

    it("clear() is a no-op when no font was ever loaded", () => {
      const loader = new NodeAssetLoader({ skiaCanvas: fakeSkia() });
      expect(() => loader.clear()).not.toThrow();
    });
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
