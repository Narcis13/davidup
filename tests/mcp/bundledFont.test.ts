// Bundled default font (R-30, v1.1 S24): a fresh standalone session can place
// text with zero setup. `font:default` (Inter Regular, shipped in fonts/)
// resolves in the validator and every loader without a `register_asset`, and
// `add_text` falls back to it when `font` is omitted.

import { existsSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_FONT_ASSET,
  DEFAULT_FONT_ID,
  BrowserAssetLoader,
  NodeAssetLoader,
  __resetFontClaimsForTests,
  bundledFileName,
  resolveGlobalSrc,
  withBundledAssets,
  type SkiaCanvasModule,
} from "../../src/assets/index.js";
import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";
import { validate } from "../../src/schema/validator.js";
import type { Composition } from "../../src/schema/types.js";

function getTool(name: string): ToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

async function call(deps: ToolDeps, name: string, args: Record<string, unknown>) {
  const out = await dispatchTool(getTool(name), args, deps);
  if (!out.ok) throw new Error(`${name} failed: ${JSON.stringify(out.error)}`);
  return out.result as Record<string, unknown>;
}

function compWithText(font: string, assets: Composition["assets"] = []): Composition {
  return {
    version: "0.1",
    composition: { width: 64, height: 64, fps: 30, duration: 1, background: "#000000" },
    assets,
    layers: [{ id: "l", z: 0, opacity: 1, blendMode: "normal", items: ["t"] }],
    items: {
      t: {
        type: "text",
        text: "Hi",
        font,
        fontSize: 24,
        color: "#ffffff",
        transform: {
          x: 0, y: 32, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1,
        },
      },
    },
    tweens: [],
  } as Composition;
}

describe("bundled font file", () => {
  it("ships fonts/Inter-Regular.ttf under 200 KB and resolves bundled: srcs to it", () => {
    const path = resolveGlobalSrc(DEFAULT_FONT_ASSET.src);
    expect(path.endsWith("fonts/Inter-Regular.ttf")).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeLessThan(200 * 1024);
  });

  it("rejects bundled: srcs that try to leave fonts/", () => {
    expect(bundledFileName("bundled:../package.json")).toBeUndefined();
    expect(bundledFileName("bundled:a/b.ttf")).toBeUndefined();
    expect(bundledFileName("bundled:")).toBeUndefined();
    expect(bundledFileName("fonts/Inter-Regular.ttf")).toBeUndefined();
    expect(resolveGlobalSrc("bundled:../x.ttf")).toBe("bundled:../x.ttf");
  });
});

describe("withBundledAssets", () => {
  it("adds the default font only when a text item references it", () => {
    expect(withBundledAssets(compWithText("brand"))).toEqual([]);
    expect(withBundledAssets(compWithText(DEFAULT_FONT_ID))).toEqual([DEFAULT_FONT_ASSET]);
  });

  it("leaves a composition-defined font:default alone", () => {
    const own = { id: DEFAULT_FONT_ID, type: "font" as const, src: "own.ttf", family: "Own" };
    expect(withBundledAssets(compWithText(DEFAULT_FONT_ID, [own]))).toEqual([own]);
  });
});

describe("validator", () => {
  it("accepts font:default with no registered asset, without W_FONT_UNREGISTERED", () => {
    const result = validate(compWithText(DEFAULT_FONT_ID));
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code)).not.toContain("W_FONT_UNREGISTERED");
  });

  it("still rejects other unregistered font ids", () => {
    const result = validate(compWithText("nope"));
    expect(result.errors.map((e) => e.code)).toContain("E_ASSET_MISSING");
  });
});

describe("loaders", () => {
  it("NodeAssetLoader registers the bundled file under family Inter", async () => {
    __resetFontClaimsForTests();
    const used: Array<[string, ReadonlyArray<string> | string]> = [];
    const skia: SkiaCanvasModule = {
      loadImage: async () => ({}),
      FontLibrary: { use: (family, paths) => used.push([family, paths]), reset: () => {} },
    };
    const loader = new NodeAssetLoader({ skiaCanvas: skia });
    await loader.preloadAll(withBundledAssets(compWithText(DEFAULT_FONT_ID)));
    expect(loader.getFontFamily(DEFAULT_FONT_ID)).toBe("Inter");
    expect(used).toHaveLength(1);
    const [family, paths] = used[0]!;
    expect(family).toBe("Inter");
    expect(existsSync((paths as string[])[0]!)).toBe(true);
    loader.clear();
    __resetFontClaimsForTests();
  });

  it("BrowserAssetLoader fetches the bundled font from /bundled-fonts/ (overridable)", async () => {
    const urls: string[] = [];
    class FakeFontFace {
      constructor(_family: string, src: string) {
        urls.push(src);
      }
      load() {
        return Promise.resolve(this);
      }
    }
    const g = globalThis as { FontFace?: unknown };
    const prev = g.FontFace;
    g.FontFace = FakeFontFace;
    try {
      const doc = { fonts: { add: () => {}, delete: () => {} } } as unknown as Document;
      await new BrowserAssetLoader({ document: doc }).load(DEFAULT_FONT_ASSET);
      await new BrowserAssetLoader({ document: doc, bundledBaseUrl: "/static/fonts" }).load(
        DEFAULT_FONT_ASSET,
      );
    } finally {
      g.FontFace = prev;
    }
    expect(urls).toEqual([
      'url("/bundled-fonts/Inter-Regular.ttf")',
      'url("/static/fonts/Inter-Regular.ttf")',
    ]);
  });
});

describe("MCP: text with zero setup", () => {
  it("list_fonts reports the bundled font", async () => {
    const deps: ToolDeps = { store: new CompositionStore() };
    await call(deps, "create_composition", { width: 64, height: 64, fps: 30, duration: 1 });
    const out = await call(deps, "list_fonts", {});
    expect(out.bundled).toEqual([{ id: "font:default", family: "Inter", bundled: true }]);
    expect(out.hint).toContain("font:default");
  });

  it("create_composition → add_layer → add_text (no font) → validate → preview has glyph pixels", async () => {
    const skia = (await import("skia-canvas")) as unknown as {
      Canvas: new (w: number, h: number) => {
        getContext(t: "2d"): {
          drawImage(img: unknown, x: number, y: number): void;
          getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
        };
      };
      loadImage(src: Buffer): Promise<unknown>;
    };
    // Real skia, injected — the server's own lazy import doesn't run under vitest.
    const deps: ToolDeps = { store: new CompositionStore(), skiaCanvas: skia as never };
    await call(deps, "create_composition", {
      width: 160,
      height: 90,
      fps: 30,
      duration: 1,
      background: "#000000",
    });
    await call(deps, "add_layer", { id: "fg", z: 0 });
    const { itemId } = await call(deps, "add_text", {
      layerId: "fg",
      text: "Hello",
      fontSize: 40,
      color: "#ffffff",
      x: 10,
      y: 60,
    });
    const comp = deps.store.toJSON();
    expect(comp.items[itemId as string]).toMatchObject({ font: "font:default" });
    expect(comp.assets).toEqual([]);

    const validation = await call(deps, "validate", {});
    expect(validation.valid).toBe(true);

    const preview = await call(deps, "render_preview_frame", { time: 0 });
    const img = await skia.loadImage(Buffer.from(preview.image as string, "base64"));
    const canvas = new skia.Canvas(160, 90);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, 160, 90);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! > 128) lit += 1;
    // "Hello" at 40px covers a few hundred pixels; an empty frame has none.
    expect(lit).toBeGreaterThan(200);
  });
});
