// An asset's credit and licence (hand-drawn film 4.0 rough edges, RE-14): the
// schema on every asset type, register_asset and list_assets, and the
// W_ASSET_CREDIT warning for an attribution licence with nothing to attribute.

import { describe, expect, it } from "vitest";

import { ASSET_LICENCES, validateComposition } from "../../src/schema/index.js";
import type { Composition } from "../../src/schema/types.js";
import { CompositionStore, dispatchTool, TOOLS, type ToolDeps } from "../../src/mcp/index.js";

const MOON = "FullMoon2010.jpg by Gregory H. Revera, CC BY-SA 3.0, via Wikimedia Commons";

function comp(assets: unknown[]): Composition {
  return {
    version: "0.1",
    composition: { width: 640, height: 360, fps: 30, duration: 2, background: "#000" },
    assets: assets as Composition["assets"],
    layers: [],
    items: {},
    tweens: [],
  };
}

describe("asset credit and licence", () => {
  it("any asset type takes them", () => {
    const r = validateComposition(comp([
      { id: "moon", type: "image", src: "moon.jpg", credit: MOON, licence: "CC-BY-SA" },
      { id: "hand", type: "font", src: "hand.ttf", family: "hand", licence: "PD", credit: "The Hershey Fonts" },
      { id: "pad", type: "audio", src: "pad.wav", licence: "own" },
      { id: "clip", type: "video", src: "clip.mp4", licence: "CC0" },
    ]));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("the licence is one of the store's", () => {
    expect([...ASSET_LICENCES]).toEqual(["CC0", "CC-BY", "CC-BY-SA", "OFL", "PD", "own", "unknown"]);
    const r = validateComposition(comp([{ id: "moon", type: "image", src: "moon.jpg", licence: "CC BY-SA 3.0" }]));
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatchObject({ code: "E_SCHEMA", path: "assets.0.licence" });
  });

  it("warns W_ASSET_CREDIT for CC-BY and CC-BY-SA with no credit, and only those", () => {
    const r = validateComposition(comp([
      { id: "a", type: "image", src: "a.jpg", licence: "CC-BY" },
      { id: "b", type: "image", src: "b.jpg", licence: "CC-BY-SA" },
      { id: "c", type: "image", src: "c.jpg", licence: "CC0" },
      { id: "d", type: "image", src: "d.jpg", licence: "unknown" },
      { id: "e", type: "image", src: "e.jpg" },
    ]));
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => [w.code, w.path])).toEqual([
      ["W_ASSET_CREDIT", "assets.0.credit"],
      ["W_ASSET_CREDIT", "assets.1.credit"],
    ]);
  });
});

describe("register_asset with a credit", () => {
  const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
  function session() {
    const deps: ToolDeps = { store: new CompositionStore(), probeAudio: async () => ({}), probeVideo: async () => ({}) };
    return async (name: string, args: Record<string, unknown>) => {
      const r = await dispatchTool(tool(name), args, deps);
      if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
      return r.result as Record<string, any>;
    };
  }

  it("keeps it on the asset, and list_assets and the document carry it", async () => {
    const call = session();
    await call("create_composition", { width: 640, height: 360, fps: 30, duration: 2 });
    expect(await call("register_asset", { id: "moon", type: "image", src: "moon.jpg", credit: MOON, licence: "CC-BY-SA" })).toEqual({ ok: true });
    await call("register_asset", { id: "pad", type: "audio", src: "pad.wav", licence: "own" });
    await call("register_asset", { id: "clip", type: "video", src: "clip.webm", credit: "sam", licence: "own" });
    await call("register_asset", { id: "hand", type: "font", src: "hand.ttf", family: "hand", licence: "PD" });
    const { assets } = await call("list_assets", {});
    expect(assets).toEqual([
      { id: "moon", type: "image", src: "moon.jpg", credit: MOON, licence: "CC-BY-SA" },
      { id: "pad", type: "audio", src: "pad.wav", licence: "own" },
      { id: "clip", type: "video", src: "clip.webm", credit: "sam", licence: "own" },
      { id: "hand", type: "font", src: "hand.ttf", family: "hand", licence: "PD" },
    ]);
    const v = await call("validate", {});
    expect(v.warnings).toEqual([]);
  });

  it("without one, a CC-BY-SA asset warns at registration and in validate", async () => {
    const call = session();
    await call("create_composition", { width: 640, height: 360, fps: 30, duration: 2 });
    const r = await call("register_asset", { id: "moon", type: "image", src: "moon.jpg", licence: "CC-BY-SA" });
    expect(r.warnings).toEqual([expect.stringMatching(/"moon" is CC-BY-SA but has no credit/)]);
    const v = await call("validate", {});
    expect(v.warnings.map((w: { code: string }) => w.code)).toEqual(["W_ASSET_CREDIT"]);
  });

  it("refuses a licence outside the list", async () => {
    const call = session();
    await call("create_composition", { width: 640, height: 360, fps: 30, duration: 2 });
    await expect(call("register_asset", { id: "moon", type: "image", src: "moon.jpg", licence: "GPL" })).rejects.toThrow(/E_/);
  });
});
