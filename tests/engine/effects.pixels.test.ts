// Pixel-level proof of per-item effects (v1.1 S21).
//
// The call-recording tests in render.test.ts show the pass structure; these
// render through real skia-canvas and read the pixels that structure
// produces: a blur spreads alpha past the item's edge, a shadow lands at its
// offset in its colour, a glow surrounds the item evenly, and an effect item
// fades as one unit (the shadow with it, not under it).
//
// Drives skia directly for the same reason isolatedGroup.pixels.test.ts does:
// no assets, and staying out of the driver's module graph keeps this file from
// perturbing the font registry the golden-frame hashes depend on.

import { describe, expect, it } from "vitest";
import { renderFrame } from "../../src/engine/index.js";
import type { Canvas2DContext, OffscreenSurface } from "../../src/engine/types.js";
import type { Composition, Effect, Item } from "../../src/schema/types.js";

interface SkiaModule {
  Canvas: new (
    width: number,
    height: number,
  ) => {
    getContext(kind: "2d"): Canvas2DContext;
    toBuffer(format: "raw"): Promise<Uint8Array> | Uint8Array;
  };
}

let cachedSkia: SkiaModule | undefined;

async function skiaCanvas(): Promise<SkiaModule> {
  if (!cachedSkia) {
    const specifier = "skia-canvas";
    cachedSkia = (await import(/* @vite-ignore */ specifier)) as SkiaModule;
  }
  return cachedSkia;
}

const WIDTH = 120;
const HEIGHT = 80;

/** Paint `comp` at `t` and hand back the raw RGBA buffer. */
async function renderRaw(comp: Composition, t = 0): Promise<Uint8Array> {
  const skia = await skiaCanvas();
  const canvas = new skia.Canvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  const createOffscreen = (w: number, h: number): OffscreenSurface => {
    const off = new skia.Canvas(w, h);
    return { context: off.getContext("2d"), source: off };
  };
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  renderFrame(comp, t, ctx, { createOffscreen });
  return await Promise.resolve(canvas.toBuffer("raw"));
}

// A 40×40 white square at (40, 20): covers x ∈ [40, 80), y ∈ [20, 60).
function square(effects?: Effect[], opacity = 1): Item {
  return {
    type: "shape",
    kind: "rect",
    width: 40,
    height: 40,
    fillColor: "#ffffff",
    ...(effects !== undefined ? { effects } : {}),
    transform: {
      x: 40,
      y: 20,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0,
      anchorY: 0,
      opacity,
    },
  };
}

function comp(item: Item, tweens: Composition["tweens"] = []): Composition {
  return {
    version: "0.1",
    composition: { width: WIDTH, height: HEIGHT, fps: 30, duration: 1, background: "transparent" },
    assets: [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["s"] }],
    items: { s: item },
    tweens,
  };
}

function px(data: Uint8Array, x: number, y: number): [number, number, number, number] {
  const i = (y * WIDTH + x) * 4;
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
}

const alpha = (data: Uint8Array, x: number, y: number): number => px(data, x, y)[3];

describe("per-item effects — pixels (v1.1 S21)", () => {
  it("blur softens the edge: alpha leaks outside the item and drops inside it", async () => {
    const plain = await renderRaw(comp(square()));
    const blurred = await renderRaw(comp(square([{ type: "blur", radius: 4 }])));

    // Plain: hard edge.
    expect(alpha(plain, 36, 40)).toBe(0);
    expect(alpha(plain, 41, 40)).toBe(255);
    // Blurred: the pixel just outside picks up coverage, the one just inside
    // loses some, and the centre (5σ from every edge) is still solid. σ = 4
    // puts the pixel centre 3.5 px out at ≈ Φ(−0.875) ≈ 19 % coverage.
    expect(alpha(blurred, 36, 40)).toBeGreaterThan(40);
    expect(alpha(blurred, 36, 40)).toBeLessThan(60);
    expect(alpha(blurred, 41, 40)).toBeLessThan(255);
    expect(alpha(blurred, 41, 40)).toBeGreaterThan(alpha(blurred, 36, 40));
    expect(alpha(blurred, 60, 40)).toBe(255);
    // Far from the item, nothing.
    expect(alpha(blurred, 5, 5)).toBe(0);
  });

  it("shadow lands at its offset, in its colour, under the item", async () => {
    const data = await renderRaw(
      comp(square([{ type: "shadow", color: "#ff0000", offsetX: 10, offsetY: 10 }])),
    );
    // Inside the item: the item itself, untouched.
    expect(px(data, 60, 40)).toEqual([255, 255, 255, 255]);
    // Right of / below the item but inside the offset square: pure shadow.
    expect(px(data, 85, 50)).toEqual([255, 0, 0, 255]);
    expect(px(data, 60, 65)).toEqual([255, 0, 0, 255]);
    // Up-left of the item, where the offset shadow can't reach.
    expect(alpha(data, 35, 15)).toBe(0);
  });

  it("glow surrounds the item evenly in its colour", async () => {
    const data = await renderRaw(comp(square([{ type: "glow", color: "#00ff00", radius: 4 }])));
    // Two pixels out on each side carry the same green halo.
    const left = px(data, 37, 40);
    const right = px(data, 82, 40);
    const top = px(data, 60, 17);
    const bottom = px(data, 60, 62);
    for (const p of [left, right, top, bottom]) {
      expect(p[3]).toBeGreaterThan(40);
      expect(p[1]).toBe(255);
      expect(p[0]).toBe(0);
    }
    expect(left[3]).toBe(right[3]);
    expect(top[3]).toBe(bottom[3]);
    // The item on top is unchanged.
    expect(px(data, 60, 40)).toEqual([255, 255, 255, 255]);
  });

  it("fades the item and its shadow together as one unit", async () => {
    const data = await renderRaw(
      comp(square([{ type: "shadow", color: "#ff0000", offsetX: 10, offsetY: 10 }], 0.5)),
    );
    // Where the item overlaps its own shadow, only the item shows: the shadow
    // was composited under it on the scratch surface before the fade. Drawn
    // with a per-draw shadow instead, the red would bleed through at 50 %.
    const inside = px(data, 70, 50);
    expect(inside[3]).toBeGreaterThanOrEqual(127);
    expect(inside[3]).toBeLessThanOrEqual(128);
    // Premultiplied storage aside, no red tint on the overlap.
    expect(inside[0]).toBe(inside[1]);
    // The exposed shadow fades by the same 0.5.
    const shadow = alpha(data, 85, 50);
    expect(shadow).toBeGreaterThanOrEqual(127);
    expect(shadow).toBeLessThanOrEqual(128);
  });

  it("tweens an effect parameter through the resolver", async () => {
    const item = square([{ type: "blur", radius: 0 }]);
    const tweens: Composition["tweens"] = [
      {
        id: "blur-in",
        target: "s",
        property: "effects.0.radius",
        from: 0,
        to: 6,
        start: 0,
        duration: 1,
        easing: "linear",
      },
    ];
    const plain = await renderRaw(comp(square()));
    const atStart = await renderRaw(comp(item, tweens), 0);
    const midway = await renderRaw(comp(item, tweens), 0.5);

    // radius 0 at t=0 is skipped outright — byte-identical to no effects.
    expect(Buffer.from(atStart)).toEqual(Buffer.from(plain));
    // radius 3 at t=0.5 blurs the edge.
    expect(alpha(midway, 36, 40)).toBeGreaterThan(0);
  });
});
