import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssetRefError,
  NodeAssetLoader,
  __resetFontClaimsForTests,
  assetFileProblem,
  assetProjectOf,
  parseAssetSrc,
  resolveAssetSrcAgainst,
  resolveGlobalSrc,
  resolveLibraryAsset,
  type SkiaCanvasModule,
} from "../../src/assets/index.js";
import { BLUE_PNG, RED_PNG, makeShelves, put, type Shelves } from "./libraryShelves.js";

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

// B-5: the CLI and the editor render worker both rewrite relative asset srcs
// against the composition's directory before handing it to the Node driver.
// `global:` / `bundled:` are symbolic prefixes the *loader* resolves, so
// joining them onto a directory first produced a path that can't exist.
describe("resolveAssetSrcAgainst", () => {
  it("resolves a relative src against the composition directory", () => {
    expect(resolveAssetSrcAgainst("fonts/anton.woff2", "/project")).toBe(
      "/project/fonts/anton.woff2",
    );
  });

  it("strips a leading ./", () => {
    expect(resolveAssetSrcAgainst("./logo.png", "/project")).toBe("/project/logo.png");
  });

  it("leaves an absolute src untouched", () => {
    expect(resolveAssetSrcAgainst("/abs/path.png", "/project")).toBe("/abs/path.png");
  });

  it("leaves an empty src untouched", () => {
    expect(resolveAssetSrcAgainst("", "/project")).toBe("");
  });

  it("leaves global: srcs symbolic for the loader (B-5)", () => {
    expect(resolveAssetSrcAgainst("global:fonts/anton-400.woff2", "/project")).toBe(
      "global:fonts/anton-400.woff2",
    );
  });

  it("leaves bundled: srcs symbolic for the loader (B-5)", () => {
    expect(resolveAssetSrcAgainst("bundled:Inter-Regular.ttf", "/project")).toBe(
      "bundled:Inter-Regular.ttf",
    );
  });

  it("leaves any other scheme untouched", () => {
    for (const src of ["https://cdn.example/logo.png", "data:image/png;base64,AAAA"]) {
      expect(resolveAssetSrcAgainst(src, "/project")).toBe(src);
    }
  });

  it("treats a Windows drive letter as a path, not a scheme", () => {
    // A one-character prefix is never a scheme, so `C:` must not be skipped as
    // one — it is already absolute and stays exactly as authored.
    expect(resolveAssetSrcAgainst("C:\\assets\\logo.png", "/project")).toBe(
      "C:\\assets\\logo.png",
    );
    expect(resolveAssetSrcAgainst("c:/assets/logo.png", "/project")).toBe(
      "c:/assets/logo.png",
    );
  });
});

// Asset library D1: `asset:<id>[@sha12]` srcs resolve on the project, user and
// house shelves (docs/asset-library-plan.md).
describe("asset: srcs", () => {
  let sh: Shelves;
  let dot: string;
  const envBefore = { ...process.env };
  beforeEach(() => {
    sh = makeShelves();
    dot = put(join(sh.project, "assets"), { id: "dot", kind: "image" }, RED_PNG);
    put(sh.user, { id: "dot", kind: "image" }, BLUE_PNG);
    put(sh.user, { id: "swatch", kind: "stock", box: [0, 0, 2, 2] }, BLUE_PNG);
    put(sh.house, { id: "paper", kind: "stock", box: [0, 0, 2, 2] }, RED_PNG);
  });
  afterEach(() => {
    sh.cleanup();
    process.env = { ...envBefore };
  });

  const blob = (root: string, sha: string) => join(root, "blobs", `${sha}.png`);

  it("parses ids and pins, and refuses what is neither", () => {
    expect(parseAssetSrc("asset:teapot")).toEqual({ id: "teapot" });
    expect(parseAssetSrc("asset:teapot@611b2de0b430")).toEqual({ id: "teapot", pin: "611b2de0b430" });
    expect(parseAssetSrc("asset:pack:ink-cat")).toEqual({ id: "pack:ink-cat" });
    expect(parseAssetSrc("global:assets/x.png")).toBeNull();
    expect(() => parseAssetSrc("asset:Tea Pot")).toThrow(/not an asset src/);
    expect(() => parseAssetSrc("asset:teapot@abc")).toThrow(/12 or more hex/);
  });

  it("resolves an id on the project shelf, which shadows the user's", () => {
    const got = resolveLibraryAsset("asset:dot", { project: sh.project, env: sh.env });
    expect(got.path).toBe(blob(join(sh.project, "assets"), dot));
    expect(got.shelf).toBe("project");
    expect(got.record).toMatchObject({ id: "dot", kind: "image", shadowed: ["user"] });
  });

  it("falls through to the user pool and the house shelf", () => {
    expect(resolveLibraryAsset("asset:swatch", { project: sh.project, env: sh.env }).shelf).toBe("user");
    expect(resolveLibraryAsset("asset:paper", { project: sh.project, env: sh.env }).shelf).toBe("house");
    // No project: the user's dot wins.
    expect(resolveLibraryAsset("asset:dot", { env: sh.env }).shelf).toBe("user");
  });

  it("takes the project from $DAVIDUP_PROJECT when none is named", () => {
    expect(resolveLibraryAsset("asset:dot", { env: { ...sh.env, DAVIDUP_PROJECT: sh.project } }).shelf).toBe("project");
  });

  it("renders only the pinned bytes: a matching pin resolves, a moved record is E_ASSET_STALE", () => {
    const opts = { project: sh.project, env: sh.env };
    expect(resolveLibraryAsset(`asset:dot@${dot.slice(0, 12)}`, opts).path).toBe(blob(join(sh.project, "assets"), dot));
    expect(resolveLibraryAsset(`asset:dot@${dot}`, opts).shelf).toBe("project");
    const stale = "0123456789ab";
    const err = (() => {
      try {
        resolveLibraryAsset(`asset:dot@${stale}`, opts);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(AssetRefError);
    expect(err).toMatchObject({ code: "E_ASSET_STALE" });
    expect((err as Error).message).toContain(`asset:dot@${dot.slice(0, 12)}`);
  });

  it("E_ASSET_MISSING names every shelf searched", () => {
    try {
      resolveLibraryAsset("asset:teapot", { project: sh.project, env: sh.env });
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ code: "E_ASSET_MISSING" });
      const msg = (e as Error).message;
      for (const s of [`project (${join(sh.project, "assets")})`, `user (${sh.user})`, `house (${sh.house})`]) expect(msg).toContain(s);
    }
  });

  it("E_ASSET_INVALID for a src that is not an id", () => {
    expect(() => resolveLibraryAsset("asset:Nope!", { env: sh.env })).toThrow(expect.objectContaining({ code: "E_ASSET_INVALID" }));
  });

  it("resolveGlobalSrc resolves asset: where it resolves global:", () => {
    process.env.DAVIDUP_ASSETS = sh.user;
    process.env.DAVIDUP_HOUSE = sh.house;
    expect(resolveGlobalSrc("asset:dot", undefined, { project: sh.project })).toBe(blob(join(sh.project, "assets"), dot));
    expect(resolveGlobalSrc("global:assets/x.png", "/lib")).toBe(join("/lib", "assets/x.png"));
    expect(resolveGlobalSrc("./x.png")).toBe("./x.png");
  });

  it("NodeAssetLoader loads the blob of an asset: src", async () => {
    process.env.DAVIDUP_ASSETS = sh.user;
    process.env.DAVIDUP_HOUSE = sh.house;
    const skia = fakeSkia();
    const loader = new NodeAssetLoader({ skiaCanvas: skia, project: sh.project });
    await loader.preloadAll([{ id: "d", type: "image", src: "asset:dot" }]);
    expect(skia.loadImage).toHaveBeenCalledWith(blob(join(sh.project, "assets"), dot));
  });

  it("resolveAssetSrcAgainst leaves asset: srcs symbolic", () => {
    expect(resolveAssetSrcAgainst("asset:dot@0123456789ab", "/project")).toBe("asset:dot@0123456789ab");
  });

  it("assetProjectOf takes a directory only when it holds a catalogue", () => {
    expect(assetProjectOf(sh.project)).toBe(sh.project);
    expect(assetProjectOf(sh.user)).toBeUndefined();
  });

  it("assetFileProblem: null when the file is there, the reason when not", () => {
    const opts = { project: sh.project, env: sh.env };
    expect(assetFileProblem("asset:dot", opts)).toBeNull();
    expect(assetFileProblem("asset:teapot", opts)).toMatch(/^E_ASSET_MISSING: .*no asset 'teapot'/);
    expect(assetFileProblem("asset:dot@0123456789ab", opts)).toMatch(/^E_ASSET_STALE/);
    rmSync(blob(join(sh.project, "assets"), dot));
    expect(assetFileProblem("asset:dot", opts)).toMatch(/^no file at .*\.png$/);
    expect(assetFileProblem("global:assets/nothing.png", { globalLibraryRoot: sh.user })).toMatch(/^no file at /);
    expect(assetFileProblem("./local.png", opts)).toBeNull();
  });
});
