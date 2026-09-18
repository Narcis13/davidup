// Pixel-level proof of isolated group compositing (v1.1 S18).
//
// The call-recording tests in render.test.ts show *that* the renderer takes
// the offscreen path; this one shows the reason it exists. Two overlapping
// opaque children in a half-transparent group:
//
//   default (multiplicative) — each child composites separately, so the union
//     region reads 0.5 alpha and the overlap reads 0.5 + 0.5·(1−0.5) = 0.75.
//     The seam between them is visible, which is R-20.
//   isolate: true            — the children flatten at full alpha first, then
//     the flattened result composites once at 0.5. Every covered pixel reads
//     0.5. No seam.
//
// Rendered through skia-canvas so this measures real pixels, not a fake
// context's bookkeeping. The background is "transparent" so the alpha channel
// carries the answer directly.
//
// Drives skia directly rather than reusing the determinism harness: these
// compositions have no assets and no video, so the driver's loader and
// frame-extraction machinery buy nothing here, and staying out of that module
// graph keeps this file from perturbing the process-global font registry the
// golden-frame hashes depend on (see goldenFrames.integration.test.ts).

import { describe, expect, it } from "vitest";
import { renderFrame } from "../../src/engine/index.js";
import type { Canvas2DContext, OffscreenSurface } from "../../src/engine/types.js";
import type { Composition, GroupItem, Item } from "../../src/schema/types.js";

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

/** Paint `comp` at t = 0 and hand back the raw RGBA buffer. */
async function renderRaw(comp: Composition): Promise<Uint8Array> {
  const skia = await skiaCanvas();
  const canvas = new skia.Canvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  const createOffscreen = (w: number, h: number): OffscreenSurface => {
    const off = new skia.Canvas(w, h);
    return { context: off.getContext("2d"), source: off };
  };
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  renderFrame(comp, 0, ctx, { createOffscreen });
  return await Promise.resolve(canvas.toBuffer("raw"));
}

const WIDTH = 120;
const HEIGHT = 60;

// Two 40×40 red squares at x=10 and x=30: they overlap on x ∈ [30, 50).
const LEFT_ONLY = { x: 20, y: 30 };
const OVERLAP = { x: 40, y: 30 };
const RIGHT_ONLY = { x: 60, y: 30 };
const OUTSIDE = { x: 100, y: 30 };

function square(x: number): Item {
  return {
    type: "shape",
    kind: "rect",
    width: 40,
    height: 40,
    fillColor: "#ff0000",
    transform: {
      x,
      y: 10,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0,
      anchorY: 0,
      opacity: 1,
    },
  };
}

function compWithGroup(extra: Partial<GroupItem>): Composition {
  const group: GroupItem = {
    type: "group",
    items: ["a", "b"],
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0,
      anchorY: 0,
      opacity: 0.5,
    },
    ...extra,
  };
  return {
    version: "0.1",
    composition: {
      width: WIDTH,
      height: HEIGHT,
      fps: 30,
      duration: 1,
      background: "transparent",
    },
    assets: [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["g"] }],
    items: { g: group, a: square(10), b: square(30) },
    tweens: [],
  };
}

/** Alpha (0..255) of the pixel at (x, y) in a raw RGBA buffer. */
function alphaAt(data: Uint8Array, x: number, y: number): number {
  return data[(y * WIDTH + x) * 4 + 3]!;
}

// 0.5 · 255 is 127.5, and the two paths land on either side of it (a direct
// fill rounds down, the composited surface rounds up). Which way skia breaks
// the tie is not the claim under test — the uniformity is — so allow both.
function expectHalfAlpha(actual: number): void {
  expect(actual).toBeGreaterThanOrEqual(127);
  expect(actual).toBeLessThanOrEqual(128);
}

describe("isolated group compositing — pixels (v1.1 S18)", () => {
  it("shows the overlap seam on the default multiplicative path", async () => {
    const data = await renderRaw(compWithGroup({}));

    // Each child composites on its own, so the overlap stacks two 50 % draws.
    const left = alphaAt(data, LEFT_ONLY.x, LEFT_ONLY.y);
    const right = alphaAt(data, RIGHT_ONLY.x, RIGHT_ONLY.y);
    expectHalfAlpha(left);
    expectHalfAlpha(right);
    // 0.5 + 0.5·(1−0.5) = 0.75 → the seam the isolated path removes.
    expect(alphaAt(data, OVERLAP.x, OVERLAP.y)).toBe(191);
    expect(alphaAt(data, OUTSIDE.x, OUTSIDE.y)).toBe(0);
  });

  it("produces uniform alpha across the whole group when isolated", async () => {
    const data = await renderRaw(compWithGroup({ isolate: true }));

    const left = alphaAt(data, LEFT_ONLY.x, LEFT_ONLY.y);
    const overlap = alphaAt(data, OVERLAP.x, OVERLAP.y);
    const right = alphaAt(data, RIGHT_ONLY.x, RIGHT_ONLY.y);

    expectHalfAlpha(left);
    expectHalfAlpha(right);
    // The seam is gone: the overlap is no brighter than either child alone.
    expect(overlap).toBe(left);
    expect(overlap).toBe(right);
    // Isolation composites the group, it doesn't spill past it.
    expect(alphaAt(data, OUTSIDE.x, OUTSIDE.y)).toBe(0);
  });

  it("nests: an isolated group inside another still flattens correctly", async () => {
    // The inner group's scratch surface is seeded from the outer surface's
    // CTM, and composites back at that surface's identity frame — which is
    // the canvas frame, because every scratch surface is composition-sized.
    // Get this wrong and the inner children land somewhere else entirely.
    const base = compWithGroup({ isolate: true });
    const inner = base.items.g as GroupItem;
    base.items.inner = inner;
    base.items.g = {
      type: "group",
      items: ["inner"],
      isolate: true,
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
    };

    const data = await renderRaw(base);
    const left = alphaAt(data, LEFT_ONLY.x, LEFT_ONLY.y);
    expectHalfAlpha(left);
    expect(alphaAt(data, OVERLAP.x, OVERLAP.y)).toBe(left);
    expect(alphaAt(data, RIGHT_ONLY.x, RIGHT_ONLY.y)).toBe(left);
    expect(alphaAt(data, OUTSIDE.x, OUTSIDE.y)).toBe(0);
  });

  it("leaves an opaque isolated group pixel-identical to the default path", async () => {
    const opaque = {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0,
      anchorY: 0,
      opacity: 1,
    };
    const plain = await renderRaw(compWithGroup({ transform: opaque }));
    const isolated = await renderRaw(compWithGroup({ transform: opaque, isolate: true }));
    // Flattening is a no-op when nothing is transparent and no child blends —
    // the guarantee that makes `isolate` safe to turn on.
    expect(Buffer.from(isolated)).toEqual(Buffer.from(plain));
  });

  it("places an isolated group's children under the group's own transform", async () => {
    // The scratch surface is seeded with the inherited matrix, so shifting the
    // group must move its children exactly as it does un-isolated.
    const shifted = {
      x: 20,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0,
      anchorY: 0,
      opacity: 1,
    };
    const plain = await renderRaw(compWithGroup({ transform: shifted }));
    const isolated = await renderRaw(compWithGroup({ transform: shifted, isolate: true }));
    expect(Buffer.from(isolated)).toEqual(Buffer.from(plain));
    // …and the shift actually happened (left edge now empty, right edge lit).
    expect(alphaAt(isolated, 15, 30)).toBe(0);
    expect(alphaAt(isolated, 85, 30)).toBe(255);
  });
});
