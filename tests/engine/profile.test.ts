// Paint-time counters (v1.3 G8, finding P-1).
//
// Two claims: the counters describe what the renderer actually did, and
// handing one in changes nothing about what it draws — a profiled paint has
// to be safe to run against production output, or the measurement would be
// measuring a different renderer.

import { describe, expect, it } from "vitest";

import { drawItem } from "../../src/engine/render.js";
import { addRenderProfile, emptyRenderProfile, resetRenderProfile } from "../../src/engine/index.js";
import type { ResolvedScene } from "../../src/engine/resolver.js";
import type { GroupItem, Item, ShapeItem } from "../../src/schema/types.js";
import { FakeContext } from "./fakeContext.js";

const IDENTITY = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0,
  anchorY: 0,
  opacity: 1,
};

function square(overrides: Partial<ShapeItem> = {}): ShapeItem {
  return {
    type: "shape",
    kind: "rect",
    width: 20,
    height: 20,
    fillColor: "#fff",
    transform: { ...IDENTITY },
    ...overrides,
  } as ShapeItem;
}

function scene(items: Record<string, Item>): ResolvedScene {
  return {
    composition: { width: 200, height: 100, fps: 30, duration: 1, background: "#000" },
    layers: [],
    items,
  };
}

function offscreenFactory() {
  const surfaces: Array<{ w: number; h: number; ctx: FakeContext }> = [];
  const createOffscreen = (w: number, h: number) => {
    const ctx = new FakeContext();
    surfaces.push({ w, h, ctx });
    return { context: ctx, source: { __offscreen: surfaces.length } };
  };
  return { createOffscreen, surfaces };
}

function paint(item: Item, extra: Record<string, Item> = {}, profile = emptyRenderProfile()) {
  const ctx = new FakeContext();
  const { createOffscreen, surfaces } = offscreenFactory();
  drawItem(ctx, item, scene({ s: item, ...extra }), undefined, {
    assets: undefined,
    createOffscreen,
    time: 0,
    video: undefined,
    profile,
  }, "s");
  return { ctx, surfaces, profile };
}

describe("render profile counters", () => {
  it("counts the scratch surface and the blur pass an effected item costs", () => {
    const { profile } = paint(square({ effects: [{ type: "blur", radius: 3 }] }));

    expect(profile.effectItems).toBe(1);
    expect(profile.offscreens).toBe(1);
    // One surface, cut to the 20 × 20 square plus the blur's 9 px reach and a
    // pixel of slack (v1.3 G8) — 30 × 30, not the 200 × 100 canvas.
    expect(profile.offscreenPixels).toBe(900);
    expect(profile.shadowPasses).toBe(0);
    // The blur is counted where it runs, past `blurSurface`'s pixel-access
    // guard — a host without getImageData does no blur and reports none.
    expect(profile.blurs).toBe(1);
    expect(profile.blurPixels).toBe(900);
  });

  it("counts a shadow's extra surface once, however many shadows are stacked", () => {
    const { profile } = paint(
      square({
        effects: [
          { type: "shadow", color: "#000", blur: 4, offsetX: 1, offsetY: 1 },
          { type: "glow", color: "#0ff", radius: 5 },
        ],
      }),
    );

    expect(profile.shadowPasses).toBe(2);
    // The flatten surface plus one spare, reused by the second pass.
    expect(profile.offscreens).toBe(2);
  });

  it("counts an isolated group, and skips no-op effects entirely", () => {
    const group: GroupItem = {
      type: "group",
      items: ["a"],
      isolate: true,
      effects: [{ type: "blur", radius: 0 }],
      transform: { ...IDENTITY },
    };
    const { profile } = paint(group, { a: square() });

    // `effects` is non-empty so the item flattens, but the radius-0 blur is
    // skipped — the flatten surface is the only cost.
    expect(profile.effectItems).toBe(1);
    expect(profile.blurs).toBe(0);
    expect(profile.shadowPasses).toBe(0);
    expect(profile.offscreens).toBe(1);
    // The flatten copy drops `isolate`, so the group is never counted twice.
    expect(profile.isolatedGroups).toBe(0);
  });

  it("records the same draw calls with and without a profile attached", () => {
    const item = square({
      effects: [
        { type: "blur", radius: 2 },
        { type: "shadow", color: "#000", blur: 3, offsetX: 2, offsetY: 2 },
      ],
      transform: { ...IDENTITY, x: 17, rotation: 0.3, opacity: 0.4 },
    });
    const profiled = paint(item);
    const ctx = new FakeContext();
    const { createOffscreen } = offscreenFactory();
    drawItem(ctx, item, scene({ s: item }), undefined, {
      assets: undefined,
      createOffscreen,
      time: 0,
      video: undefined,
    }, "s");

    expect(profiled.ctx.calls).toEqual(ctx.calls);
  });
});

describe("profile accumulators", () => {
  it("adds and zeroes every field", () => {
    const a = emptyRenderProfile();
    const b = { ...emptyRenderProfile(), blurs: 2, blurMs: 1.5, offscreens: 3 };
    addRenderProfile(a, b);
    addRenderProfile(a, b);
    expect(a.blurs).toBe(4);
    expect(a.blurMs).toBe(3);
    expect(a.offscreens).toBe(6);

    resetRenderProfile(a);
    expect(a).toEqual(emptyRenderProfile());
    // Every key the interface declares is covered by both helpers.
    expect(Object.keys(a).sort()).toEqual(Object.keys(emptyRenderProfile()).sort());
  });
});
