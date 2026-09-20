// Scratch-surface sizing (v1.3 G8, finding P-1).
//
// The claim these tests have to protect is that the box is a *superset* of
// what gets painted: a surface cut too small silently clips someone's glow.
// So the arithmetic is pinned exactly where it is knowable, and every case
// the renderer cannot know has to come back `undefined` (→ whole canvas).

import { describe, expect, it } from "vitest";

import {
  effectsReach,
  itemPaintBounds,
  scratchSurfaceRect,
} from "../../src/engine/bounds.js";
import { blurReach } from "../../src/engine/blur.js";
import type { ResolvedScene } from "../../src/engine/resolver.js";
import type { Effect, Item } from "../../src/schema/types.js";

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const T = (over: Partial<Item["transform"]> = {}) => ({
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0,
  anchorY: 0,
  opacity: 1,
  ...over,
});

function scene(items: Record<string, Item>, width = 400, height = 300): ResolvedScene {
  return {
    composition: { width, height, fps: 30, duration: 1, background: "#000" },
    layers: [],
    items,
  };
}

const rect = (over: Partial<Item> = {}): Item =>
  ({
    type: "shape",
    kind: "rect",
    width: 20,
    height: 10,
    fillColor: "#fff",
    transform: T(),
    ...over,
  }) as Item;

const box = (item: Item, items: Record<string, Item> = {}, m = IDENTITY) =>
  itemPaintBounds(item, scene({ s: item, ...items }), m);

describe("effectsReach", () => {
  it("is zero without effects", () => {
    expect(effectsReach(undefined)).toBe(0);
    expect(effectsReach([])).toBe(0);
  });

  it("uses the blur kernel's own reach", () => {
    expect(effectsReach([{ type: "blur", radius: 3 }])).toBe(blurReach(3));
    expect(effectsReach([{ type: "blur", radius: 0 }])).toBe(0);
  });

  it("gives a shadow its offset plus twice its blur, and a glow four times its radius", () => {
    expect(
      effectsReach([{ type: "shadow", color: "#000", blur: 6, offsetX: 3, offsetY: -9 }]),
    ).toBe(9 + 12);
    // `applyShadowState` sets shadowBlur = 2 × radius, and the spread allows 2 × that.
    expect(effectsReach([{ type: "glow", color: "#0ff", radius: 5 }])).toBe(20);
  });

  it("adds the stack up, because each pass works on the last one's output", () => {
    const stack: Effect[] = [
      { type: "blur", radius: 4 },
      { type: "glow", color: "#0ff", radius: 5 },
    ];
    expect(effectsReach(stack)).toBe(blurReach(4) + 20);
  });
});

describe("itemPaintBounds", () => {
  it("measures a rect, a circle and a polygon in local space", () => {
    expect(box(rect())).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 10 });
    // §3.2: a circle's `width` is its diameter on both axes.
    expect(box(rect({ kind: "circle", width: 30, height: undefined }))).toEqual({
      minX: 0,
      minY: 0,
      maxX: 30,
      maxY: 30,
    });
    expect(
      box(rect({ kind: "polygon", points: [[5, 5], [25, 9], [10, 40]], width: undefined })),
    ).toEqual({ minX: 5, minY: 5, maxX: 25, maxY: 40 });
  });

  it("grows a stroked shape by half its width, and a polygon by the miter limit", () => {
    expect(box(rect({ strokeColor: "#f00", strokeWidth: 4 }))).toEqual({
      minX: -2,
      minY: -2,
      maxX: 22,
      maxY: 12,
    });
    // A stroke width with no stroke colour paints nothing, so it adds nothing.
    expect(box(rect({ strokeWidth: 4 }))).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 10 });
    // Canvas2D's default miterLimit is 10, i.e. 5 stroke widths of spike.
    expect(
      box(
        rect({
          kind: "polygon",
          points: [[0, 0], [10, 0], [5, 10]],
          width: undefined,
          strokeColor: "#f00",
          strokeWidth: 2,
        }),
      ),
    ).toEqual({ minX: -10, minY: -10, maxX: 20, maxY: 20 });
  });

  it("applies the item's transform in the order drawItem does", () => {
    // translate → rotate → scale → anchor, so the anchor shift is scaled.
    expect(box(rect({ transform: T({ x: 100, y: 50, scaleX: 2, scaleY: 3 }) }))).toEqual({
      minX: 100,
      minY: 50,
      maxX: 140,
      maxY: 80,
    });
    expect(
      box(rect({ transform: T({ x: 100, y: 50, scaleX: 2, anchorX: 0.5, anchorY: 1 }) })),
    ).toEqual({ minX: 80, minY: 40, maxX: 120, maxY: 50 });

    const quarter = box(rect({ transform: T({ rotation: Math.PI / 2 }) }))!;
    expect(quarter.minX).toBeCloseTo(-10, 9);
    expect(quarter.maxX).toBeCloseTo(0, 9);
    expect(quarter.maxY).toBeCloseTo(20, 9);
  });

  it("carries the inherited matrix", () => {
    expect(box(rect(), {}, { a: 2, b: 0, c: 0, d: 2, e: 30, f: 40 })).toEqual({
      minX: 30,
      minY: 40,
      maxX: 70,
      maxY: 60,
    });
  });

  it("unions a group's children and grows each by its own effects' reach", () => {
    const group: Item = {
      type: "group",
      items: ["big", "small"],
      transform: T({ x: 10 }),
    } as Item;
    const big = rect({ width: 200, height: 200 });
    // Well inside `big`, but its blur reaches far past it — which a running
    // union grown once at the end would miss.
    const small = rect({
      width: 4,
      height: 4,
      transform: T({ x: 100, y: 100 }),
      effects: [{ type: "blur", radius: 40 }],
    });
    const reach = blurReach(40);

    // `big` covers canvas (10, 0)–(210, 200); the 4 px `small` sits at
    // (110, 100)–(114, 104) and its blur reaches past that on every side.
    expect(box(group, { big, small })).toEqual({
      minX: 110 - reach,
      minY: 100 - reach,
      maxX: 114 + reach,
      maxY: 104 + reach,
    });
  });

  it("refuses a subtree that casts a host shadow, wherever it sits", () => {
    // A shadow or glow rasterizes slightly differently depending on the
    // surface it lands on, so the box must stay the canvas — including when
    // the effect is on a descendant, whose own surface is cut from this one.
    const group: Item = { type: "group", items: ["a", "b"], transform: T() } as Item;
    expect(
      box(group, { a: rect(), b: rect({ effects: [{ type: "glow", color: "#0ff", radius: 3 }] }) }),
    ).toBeUndefined();
    expect(
      box(group, {
        a: rect(),
        b: rect({ effects: [{ type: "shadow", color: "#000", blur: 2 }] }),
      }),
    ).toBeUndefined();
    // A blurred descendant is fine: the blur is the engine's own code on raw
    // pixels and reads nothing outside its buffer.
    expect(
      box(group, { a: rect(), b: rect({ effects: [{ type: "blur", radius: 3 }] }) }),
    ).toBeDefined();
  });

  it("skips children that are hidden or missing", () => {
    const group: Item = {
      type: "group",
      items: ["shown", "hidden", "ghost"],
      transform: T(),
    } as Item;
    expect(
      box(group, {
        shown: rect(),
        hidden: rect({ width: 999, height: 999, visible: false }),
      }),
    ).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 10 });
  });

  it("refuses to answer for text, wherever it sits in the subtree", () => {
    const text: Item = {
      type: "text",
      text: "hello",
      font: "f",
      fontSize: 24,
      color: "#fff",
      transform: T(),
    } as Item;
    expect(box(text)).toBeUndefined();

    const group: Item = { type: "group", items: ["a", "t"], transform: T() } as Item;
    expect(box(group, { a: rect(), t: text })).toBeUndefined();
  });

  it("gives up rather than recurse forever through a group cycle", () => {
    const outer: Item = { type: "group", items: ["inner"], transform: T() } as Item;
    const inner: Item = { type: "group", items: ["outer"], transform: T() } as Item;
    expect(itemPaintBounds(outer, scene({ outer, inner }), IDENTITY)).toBeUndefined();
  });
});

describe("scratchSurfaceRect", () => {
  it("covers the item plus its effects' reach, in whole pixels", () => {
    const item = rect({
      transform: T({ x: 100.4, y: 80.5 }),
      effects: [{ type: "blur", radius: 3 }],
    });
    const r = scratchSurfaceRect(item, scene({ s: item }), IDENTITY, 400, 300)!;
    const reach = blurReach(3);
    expect(Number.isInteger(r.x) && Number.isInteger(r.y)).toBe(true);
    expect(r.x).toBeLessThanOrEqual(100.4 - reach);
    expect(r.y).toBeLessThanOrEqual(80.5 - reach);
    expect(r.x + r.width).toBeGreaterThanOrEqual(120.4 + reach);
    expect(r.y + r.height).toBeGreaterThanOrEqual(90.5 + reach);
  });

  it("clamps to the canvas, which is where the surface clipped anyway", () => {
    const item = rect({ width: 200, height: 200, transform: T({ x: -80, y: -60 }) });
    const r = scratchSurfaceRect(item, scene({ s: item }), IDENTITY, 400, 300)!;
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.x + r.width).toBeLessThanOrEqual(400);
    expect(r.y + r.height).toBeLessThanOrEqual(300);
  });

  it("keeps the whole canvas when the box would cover almost all of it", () => {
    const item = rect({ width: 400, height: 300 });
    expect(scratchSurfaceRect(item, scene({ s: item }), IDENTITY, 400, 300)).toBeUndefined();
  });

  it("keeps the whole canvas for a stack with a shadow or a glow in it", () => {
    const glow = rect({ effects: [{ type: "glow", color: "#0ff", radius: 2 }] });
    expect(scratchSurfaceRect(glow, scene({ s: glow }), IDENTITY, 400, 300)).toBeUndefined();
    const stacked = rect({
      effects: [
        { type: "blur", radius: 2 },
        { type: "shadow", color: "#000", blur: 2, offsetX: 1, offsetY: 1 },
      ],
    });
    expect(scratchSurfaceRect(stacked, scene({ s: stacked }), IDENTITY, 400, 300)).toBeUndefined();
  });

  it("keeps the whole canvas for an unknown extent, and for an empty group", () => {
    const text: Item = {
      type: "text",
      text: "x",
      font: "f",
      fontSize: 10,
      color: "#fff",
      transform: T(),
    } as Item;
    expect(scratchSurfaceRect(text, scene({ s: text }), IDENTITY, 400, 300)).toBeUndefined();

    const empty: Item = { type: "group", items: [], transform: T() } as Item;
    expect(scratchSurfaceRect(empty, scene({ s: empty }), IDENTITY, 400, 300)).toBeUndefined();
  });

  it("keeps the whole canvas for an item that has scrolled off it", () => {
    const item = rect({ transform: T({ x: 900, y: 900 }) });
    expect(scratchSurfaceRect(item, scene({ s: item }), IDENTITY, 400, 300)).toBeUndefined();
  });
});
