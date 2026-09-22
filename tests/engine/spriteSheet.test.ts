// Sprite sheets (hand-drawn film 4.0 D2): an image asset with a `sheet` is a
// grid of frames, and a sprite item on it shows one — a named `cycle` played
// from its `enter` at the sheet's fps, or a tweenable `frame`. Covers the
// frame math, the renderer's crop, the validator and the MCP surface.

import { describe, expect, it } from "vitest";

import {
  computeStateAt,
  renderFrame,
  spriteFrameIndex,
  spriteFrameRect,
  type AssetRegistry,
} from "../../src/engine/index.js";
import { CompositionStore, TOOLS, dispatchTool, type ToolDeps } from "../../src/mcp/index.js";
import { validate } from "../../src/schema/validator.js";
import type { Composition, SpriteItem, SpriteSheet } from "../../src/schema/types.js";
import { FakeContext } from "./fakeContext.js";

// 4 columns of 30x40 frames, 10 in all: idle 0..3, walk 4..8, happy 9 (held).
const SHEET: SpriteSheet = {
  frameWidth: 30,
  frameHeight: 40,
  columns: 4,
  count: 10,
  fps: 12,
  cycles: {
    idle: { start: 0, count: 4 },
    walk: { start: 4, count: 5, speed: 60 },
    happy: { start: 9, count: 1, loop: false },
    wave: { start: 5, count: 3, loop: false },
  },
  anchor: { x: 0.5, y: 0.95 },
};

const T0 = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 };

function sprite(over: Partial<SpriteItem> = {}): SpriteItem {
  return { type: "sprite", asset: "sam", width: 60, height: 80, transform: { ...T0 }, ...over };
}

function comp(item: SpriteItem, over: Partial<Composition> = {}): Composition {
  return {
    version: "0.1",
    composition: { width: 200, height: 100, fps: 24, duration: 4, background: "#000" },
    assets: [{ id: "sam", type: "image", src: "sam.png", sheet: SHEET }],
    layers: [{ id: "l", z: 0, opacity: 1, blendMode: "normal", items: ["s"] }],
    items: { s: item },
    tweens: [],
    ...over,
  };
}

describe("spriteFrameIndex", () => {
  it("shows frame 0 with neither cycle nor frame", () => {
    expect(spriteFrameIndex(SHEET, sprite(), 1.3)).toBe(0);
  });

  it("plays a looping cycle at the sheet's fps from enter", () => {
    const s = sprite({ cycle: "walk", enter: 1 });
    // 12 fps: frame k of the cycle at enter + k/12.
    expect([0, 1, 2, 3, 4, 5, 6].map((k) => spriteFrameIndex(SHEET, s, 1 + k / 12))).toEqual([4, 5, 6, 7, 8, 4, 5]);
    // Before enter the clock is negative and wraps (the item is hidden there anyway).
    expect(spriteFrameIndex(SHEET, s, 1 - 1 / 12)).toBe(8);
  });

  it("holds the last frame of a cycle that does not loop", () => {
    const s = sprite({ cycle: "wave" });
    expect([0, 1, 2, 3, 10].map((k) => spriteFrameIndex(SHEET, s, k / 12))).toEqual([5, 6, 7, 7, 7]);
  });

  it("takes frame over the clock, within the cycle or the sheet", () => {
    expect(spriteFrameIndex(SHEET, sprite({ cycle: "walk", frame: 2.7 }), 3)).toBe(6);
    expect(spriteFrameIndex(SHEET, sprite({ cycle: "walk", frame: 7 }), 0)).toBe(6);   // wraps
    expect(spriteFrameIndex(SHEET, sprite({ cycle: "wave", frame: 9 }), 0)).toBe(7);   // held
    expect(spriteFrameIndex(SHEET, sprite({ frame: 9 }), 0)).toBe(9);
    expect(spriteFrameIndex(SHEET, sprite({ frame: 42 }), 0)).toBe(9);
  });

  it("reads an unknown cycle as none", () => {
    expect(spriteFrameIndex(SHEET, sprite({ cycle: "fly" }), 2)).toBe(0);
  });

  it("finds a frame's rectangle in the grid", () => {
    expect(spriteFrameRect(SHEET, 0)).toEqual([0, 0, 30, 40]);
    expect(spriteFrameRect(SHEET, 6)).toEqual([60, 40, 30, 40]);
    expect(spriteFrameRect(SHEET, 9)).toEqual([30, 80, 30, 40]);
  });
});

const assets: AssetRegistry = {
  getImage: (id) => (id === "sam" ? { __image: id } : undefined),
  getFontFamily: () => undefined,
};

function drawn(c: Composition, t: number, opts: Parameters<typeof renderFrame>[3] = {}) {
  const ctx = new FakeContext();
  renderFrame(c, t, ctx, { assets, ...opts });
  return ctx.calls.filter((x) => x.op === "drawImage");
}

describe("renderFrame — a sprite on a sheet", () => {
  it("crops the cycle's frame at t into the sprite's box", () => {
    const [di] = drawn(comp(sprite({ cycle: "walk" })), 2 / 12);
    expect(di).toMatchObject({ sx: 60, sy: 40, sw: 30, sh: 40, dx: 0, dy: 0, dw: 60, dh: 80 });
  });

  it("follows a tween on frame", () => {
    const c = comp(sprite({ frame: 0 }), {
      tweens: [{ id: "f", target: "s", property: "frame", from: 0, to: 10, start: 0, duration: 1 }],
    });
    expect(computeStateAt(c, 0.35).sheets?.get("sam")).toBe(SHEET);
    expect(drawn(c, 0.35)[0]).toMatchObject({ sx: 90, sy: 0 });   // frame 3
  });

  it("crops inside the tint's offscreen too", () => {
    const off = new FakeContext();
    const c = comp(sprite({ cycle: "happy", tint: "#ff0000" }));
    const main = drawn(c, 0.5, { createOffscreen: () => ({ context: off, source: { off: true } }) });
    expect(off.calls.find((x) => x.op === "drawImage")).toMatchObject({ sx: 30, sy: 80, sw: 30, sh: 40, dw: 60, dh: 80 });
    expect(main[0]).toMatchObject({ image: { off: true }, dw: 60, dh: 80 });
    expect(main[0]).not.toHaveProperty("sx");
  });

  it("draws a plain image whole, as before", () => {
    const c = comp(sprite(), { assets: [{ id: "sam", type: "image", src: "sam.png" }] });
    expect(computeStateAt(c, 0).sheets).toBeUndefined();
    const [di] = drawn(c, 0);
    expect(di).not.toHaveProperty("sx");
    expect(di).toMatchObject({ dw: 60, dh: 80 });
  });
});

describe("validate — sprite sheets", () => {
  const codes = (c: unknown) => validate(c).errors.map((e) => `${e.code} ${e.path}`);

  it("accepts a sheet and a sprite playing one of its cycles", () => {
    expect(validate(comp(sprite({ cycle: "walk" }))).errors).toEqual([]);
  });

  it("reports a cycle past the sheet's frames", () => {
    const bad = { ...SHEET, cycles: { walk: { start: 8, count: 5 } } };
    expect(codes(comp(sprite(), { assets: [{ id: "sam", type: "image", src: "sam.png", sheet: bad }] })))
      .toEqual(["E_SPRITE_SHEET assets.0.sheet.cycles.walk"]);
  });

  it("reports a cycle the sheet does not name", () => {
    const v = validate(comp(sprite({ cycle: "fly" })));
    expect(v.errors.map((e) => e.code)).toEqual(["E_SPRITE_SHEET"]);
    expect(v.errors[0]!.message).toContain("has idle, walk, happy, wave");
  });

  it("reports cycle or frame on an image with no sheet", () => {
    const plain = { assets: [{ id: "sam", type: "image" as const, src: "sam.png" }] };
    expect(codes(comp(sprite({ cycle: "walk" }), plain))).toEqual(["E_SPRITE_SHEET items.s.cycle"]);
    expect(codes(comp(sprite({ frame: 2 }), plain))).toEqual(["E_SPRITE_SHEET items.s.frame"]);
  });

  it("rejects a malformed sheet as a schema error", () => {
    const bad = { ...SHEET, columns: 0 };
    expect(codes(comp(sprite(), { assets: [{ id: "sam", type: "image", src: "sam.png", sheet: bad }] }))[0])
      .toMatch(/^E_SCHEMA assets\.0\.sheet\.columns/);
  });
});

describe("MCP — sheets through register_asset, add_sprite, update_item", () => {
  const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
  const call = (deps: ToolDeps, name: string, args: Record<string, unknown>) => dispatchTool(tool(name), args, deps);

  async function setup(): Promise<ToolDeps> {
    const deps: ToolDeps = { store: new CompositionStore() };
    await call(deps, "create_composition", { width: 640, height: 360, fps: 24, duration: 4 });
    await call(deps, "add_layer", { z: 0, id: "fg" });
    return deps;
  }

  it("registers a sheet, places a walking sprite and round-trips both", async () => {
    const deps = await setup();
    expect((await call(deps, "register_asset", { id: "sam", type: "image", src: "sam.png", sheet: SHEET })).ok).toBe(true);
    const out = await call(deps, "add_sprite", { layerId: "fg", id: "s", asset: "sam", x: 0, y: 300, width: 60, height: 80, cycle: "walk" });
    expect(out.ok).toBe(true);
    const doc = deps.store.toJSON();
    expect(doc.assets[0]).toEqual({ id: "sam", type: "image", src: "sam.png", sheet: SHEET });
    expect(doc.items.s).toMatchObject({ type: "sprite", cycle: "walk" });
    expect(validate(doc).errors).toEqual([]);
    // The store hands out copies: editing one does not reach the next.
    (deps.store.listAssets()[0] as { sheet: SpriteSheet }).sheet.fps = 1;
    expect((deps.store.listAssets()[0] as { sheet: SpriteSheet }).sheet.fps).toBe(12);
  });

  it("update_item sets and clears cycle and frame", async () => {
    const deps = await setup();
    await call(deps, "register_asset", { id: "sam", type: "image", src: "sam.png", sheet: SHEET });
    await call(deps, "add_sprite", { layerId: "fg", id: "s", asset: "sam", x: 0, y: 0, width: 60, height: 80, cycle: "walk" });
    expect((await call(deps, "update_item", { id: "s", props: { cycle: "happy", frame: 0 } })).ok).toBe(true);
    expect(deps.store.toJSON().items.s).toMatchObject({ cycle: "happy", frame: 0 });
    await call(deps, "update_item", { id: "s", props: { cycle: null, frame: null } });
    const s = deps.store.toJSON().items.s as SpriteItem;
    expect(s.cycle).toBeUndefined();
    expect(s.frame).toBeUndefined();
  });

  it("refuses a sheet on a font and a cycle past the frames", async () => {
    const deps = await setup();
    const font = await call(deps, "register_asset", { id: "f", type: "font", src: "f.ttf", family: "F", sheet: SHEET });
    expect(font.ok).toBe(false);
    const past = await call(deps, "register_asset", {
      id: "sam", type: "image", src: "sam.png", sheet: { ...SHEET, cycles: { walk: { start: 9, count: 2 } } },
    });
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.error.message).toContain("past the sheet's 10 frames");
  });

  it("lists frame among the sprite's tweenables", async () => {
    const deps = await setup();
    const caps = await call(deps, "list_engine_capabilities", {});
    expect(caps.ok).toBe(true);
    if (caps.ok) {
      const r = caps.result as { tweenable: { sprite: Array<{ path?: string; property?: string }> }; spriteSheets: unknown };
      expect(JSON.stringify(r.tweenable.sprite)).toContain("frame");
      expect(r.spriteSheets).toEqual({ assetField: "sheet", itemFields: ["cycle", "frame"] });
    }
  });
});
