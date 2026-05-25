// Stage hit-testing tests (editor v1.0, step 16).
//
// `pickItemAt` renders a hidden ID buffer where each item is painted with a
// unique solid color, then reads back the pixel at the picked point and maps
// the color back to an item id. The tests below feed the driver a tiny
// composition, drive it with a fake pick buffer that simulates rasterization
// for axis-aligned rect shapes (the only geometry we need to assert
// pick-correctness), and check that:
//
//   - clicks on a visible item return its id
//   - clicks on empty pixels return null
//   - layer order matters — the topmost item under the cursor wins
//   - group children resolve to the *child* id, not the parent group
//   - the time-arg threads through to `computeStateAt` so picking honors
//     tweens
//   - source-map emission lights up the `source` field on hits

import { describe, expect, it } from "vitest";

import { attach, type PickSurface } from "../../src/drivers/browser/index.js";
import type { AssetLoader } from "../../src/assets/index.js";
import type { Asset, Composition } from "../../src/schema/types.js";
import type { Canvas2DContext } from "../../src/engine/types.js";
import { FakeContext } from "../engine/fakeContext.js";

// Two non-overlapping rects on two layers (fg above bg).
function twoRectComp(): Composition {
  return {
    version: "0.1",
    composition: {
      width: 100,
      height: 100,
      fps: 60,
      duration: 1.0,
      background: "#000000",
    },
    assets: [],
    layers: [
      { id: "bg", z: 0, opacity: 1, blendMode: "normal", items: ["a"] },
      { id: "fg", z: 10, opacity: 1, blendMode: "normal", items: ["b"] },
    ],
    items: {
      a: {
        type: "shape",
        kind: "rect",
        width: 40,
        height: 40,
        fillColor: "#ff0000",
        transform: {
          x: 10,
          y: 10,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
      b: {
        type: "shape",
        kind: "rect",
        width: 30,
        height: 30,
        fillColor: "#00ff00",
        transform: {
          x: 60,
          y: 60,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
    },
    tweens: [],
  } as Composition;
}

// Overlapping rects, b on top of a — used to assert layer-order priority.
function overlappingComp(): Composition {
  return {
    version: "0.1",
    composition: {
      width: 100,
      height: 100,
      fps: 60,
      duration: 1.0,
      background: "#000000",
    },
    assets: [],
    layers: [
      { id: "bg", z: 0, opacity: 1, blendMode: "normal", items: ["a"] },
      { id: "fg", z: 10, opacity: 1, blendMode: "normal", items: ["b"] },
    ],
    items: {
      a: {
        type: "shape",
        kind: "rect",
        width: 60,
        height: 60,
        fillColor: "#ff0000",
        transform: {
          x: 20,
          y: 20,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
      b: {
        type: "shape",
        kind: "rect",
        width: 60,
        height: 60,
        fillColor: "#00ff00",
        transform: {
          x: 25,
          y: 25,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
    },
    tweens: [],
  } as Composition;
}

// One rect that moves horizontally over 1s — used to assert the time arg.
function movingRectComp(): Composition {
  return {
    version: "0.1",
    composition: {
      width: 100,
      height: 100,
      fps: 60,
      duration: 1.0,
      background: "#000000",
    },
    assets: [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["m"] }],
    items: {
      m: {
        type: "shape",
        kind: "rect",
        width: 20,
        height: 20,
        fillColor: "#ffffff",
        transform: {
          x: 0,
          y: 40,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
    },
    tweens: [
      {
        id: "move",
        target: "m",
        property: "transform.x",
        from: 0,
        to: 80,
        start: 0,
        duration: 1.0,
        easing: "linear",
      },
    ],
  } as Composition;
}

// A group with one child; the child should be the pick target.
function groupComp(): Composition {
  return {
    version: "0.1",
    composition: {
      width: 100,
      height: 100,
      fps: 60,
      duration: 1.0,
      background: "#000000",
    },
    assets: [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["g"] }],
    items: {
      g: {
        type: "group",
        items: ["child"],
        transform: {
          x: 10,
          y: 10,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      } as Composition["items"][string],
      child: {
        type: "shape",
        kind: "rect",
        width: 20,
        height: 20,
        fillColor: "#00ffff",
        transform: {
          x: 5,
          y: 5,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
    },
    tweens: [],
  } as Composition;
}

// Authored comp using a $behavior tween so we can prove `emitSourceMap`
// produces a SourceLocation on the hit.
function compWithSourceMap(): Composition {
  return {
    version: "0.1",
    composition: {
      width: 100,
      height: 100,
      fps: 60,
      duration: 1.0,
      background: "#000000",
    },
    assets: [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["s"] }],
    items: {
      s: {
        type: "shape",
        kind: "rect",
        width: 40,
        height: 40,
        fillColor: "#ff00ff",
        transform: {
          x: 30,
          y: 30,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
    },
    tweens: [],
  } as Composition;
}

class FakeCanvas {
  ctx = new FakeContext();
  getContext(_kind: "2d"): Canvas2DContext | null {
    return this.ctx;
  }
}

interface FakeRaf {
  schedule: (cb: (t: number) => void) => number;
  cancel: (id: number) => void;
  pending: () => number;
}

function makeFakeRaf(): FakeRaf {
  let nextId = 1;
  const queue = new Map<number, (t: number) => void>();
  return {
    schedule(cb) {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    cancel(id) {
      queue.delete(id);
    },
    pending() {
      return queue.size;
    },
  };
}

class FakeClock {
  constructor(private t: number = 0) {}
  now = (): number => this.t;
  set(ms: number): void {
    this.t = ms;
  }
}

function noopLoader(): AssetLoader {
  return {
    async load() {},
    async preloadAll(_assets: ReadonlyArray<Asset>) {},
    has() {
      return false;
    },
    clear() {},
    getImage() {
      return undefined;
    },
    getFontFamily() {
      return undefined;
    },
  };
}

// ──────────────── Rasterizing fake pick buffer ────────────────
//
// Limited to rect paths under translate-only transforms — that matches the
// fixtures above (no rotation/scale). We track:
//
//   - `currentFillStyle` mirroring the ctx state
//   - the cumulative translate accumulator with a save/restore stack
//   - rect bounds set by `rect(x, y, w, h)` since the most recent beginPath
//
// On `fill()` we resolve the current rect to world coords (rect + translate)
// and paint into a pixel grid as (r, g, b, 255). `clearRect` zeroes the
// alpha. `fillRect` paints directly without needing a path.
//
// This is enough to cover sprite-bounds (paintSpriteBounds uses fillRect)
// and shape rects (paintShapePath uses beginPath + rect + fill).

interface FakePickState {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  translateX: number;
  translateY: number;
  stack: Array<{
    translateX: number;
    translateY: number;
    fillStyle: string;
  }>;
  fillStyle: string;
  pathRect: { x: number; y: number; w: number; h: number } | null;
}

function makeFakePickBuffer(width: number, height: number): PickSurface {
  const state: FakePickState = {
    pixels: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    translateX: 0,
    translateY: 0,
    stack: [],
    fillStyle: "#000000",
    pathRect: null,
  };

  function parseColor(s: string): [number, number, number] {
    // Handles the two shapes the driver produces: "rgb(r, g, b)" for ID
    // colors. Anything else falls back to opaque black for the purposes of
    // the fake.
    const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(s);
    if (m) return [Number(m[1]!), Number(m[2]!), Number(m[3]!)];
    return [0, 0, 0];
  }

  function paint(x: number, y: number, w: number, h: number, color: string): void {
    const [r, g, b] = parseColor(color);
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(state.width, Math.floor(x + w));
    const y1 = Math.min(state.height, Math.floor(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const idx = (py * state.width + px) * 4;
        state.pixels[idx] = r;
        state.pixels[idx + 1] = g;
        state.pixels[idx + 2] = b;
        state.pixels[idx + 3] = 255;
      }
    }
  }

  function clear(x: number, y: number, w: number, h: number): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(state.width, Math.floor(x + w));
    const y1 = Math.min(state.height, Math.floor(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const idx = (py * state.width + px) * 4;
        state.pixels[idx] = 0;
        state.pixels[idx + 1] = 0;
        state.pixels[idx + 2] = 0;
        state.pixels[idx + 3] = 0;
      }
    }
  }

  const ctx: Canvas2DContext = {
    save() {
      state.stack.push({
        translateX: state.translateX,
        translateY: state.translateY,
        fillStyle: state.fillStyle,
      });
    },
    restore() {
      const popped = state.stack.pop();
      if (popped) {
        state.translateX = popped.translateX;
        state.translateY = popped.translateY;
        state.fillStyle = popped.fillStyle;
      }
    },
    translate(x, y) {
      state.translateX += x;
      state.translateY += y;
    },
    rotate(_a) {
      throw new Error("FakePickBuffer: rotate() not supported in tests");
    },
    scale(sx, sy) {
      if (sx !== 1 || sy !== 1) {
        throw new Error("FakePickBuffer: non-identity scale not supported in tests");
      }
    },
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    fillRect(x, y, w, h) {
      paint(state.translateX + x, state.translateY + y, w, h, state.fillStyle);
    },
    strokeRect() {
      /* ignore — picking doesn't stroke */
    },
    clearRect(x, y, w, h) {
      clear(state.translateX + x, state.translateY + y, w, h);
    },
    beginPath() {
      state.pathRect = null;
    },
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {
      // Polygon/circle fills approximated via fillRect aren't used in the
      // test fixtures; ignore.
    },
    rect(x, y, w, h) {
      state.pathRect = { x, y, w, h };
    },
    fill() {
      if (state.pathRect !== null) {
        paint(
          state.translateX + state.pathRect.x,
          state.translateY + state.pathRect.y,
          state.pathRect.w,
          state.pathRect.h,
          state.fillStyle,
        );
      }
    },
    stroke() {},
    font: "10px sans-serif",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillText() {
      /* text picking unused in these tests */
    },
    drawImage() {
      /* not used */
    },
  };

  // The interface keeps fillStyle as a plain property; route writes back so
  // paint() sees the latest value. The naive `fillStyle: '#000000'` field
  // above would shadow assignments — wrap with a defineProperty.
  Object.defineProperty(ctx, "fillStyle", {
    get() {
      return state.fillStyle;
    },
    set(v: string) {
      state.fillStyle = v;
    },
  });

  return {
    context: ctx,
    readPixelRgba(x, y) {
      const px = Math.max(0, Math.min(state.width - 1, Math.floor(x)));
      const py = Math.max(0, Math.min(state.height - 1, Math.floor(y)));
      const idx = (py * state.width + px) * 4;
      return {
        r: state.pixels[idx]!,
        g: state.pixels[idx + 1]!,
        b: state.pixels[idx + 2]!,
        a: state.pixels[idx + 3]!,
      };
    },
  };
}

async function attachWith(
  comp: Composition,
  pickBuffer: PickSurface,
  opts: { emitSourceMap?: boolean } = {},
) {
  const canvas = new FakeCanvas();
  const clock = new FakeClock(0);
  const raf = makeFakeRaf();
  const handle = await attach(comp, canvas, {
    loader: noopLoader(),
    now: clock.now,
    requestAnimationFrame: raf.schedule,
    cancelAnimationFrame: raf.cancel,
    createPickBuffer: () => pickBuffer,
    ...opts,
  });
  return { handle, canvas, clock, raf };
}

describe("pickItemAt", () => {
  it("returns the item id at a covered pixel", async () => {
    const buf = makeFakePickBuffer(100, 100);
    const { handle } = await attachWith(twoRectComp(), buf);

    // 'a' rect spans (10..50, 10..50). Pick well inside it.
    const hitA = handle.pickItemAt(20, 20, 0);
    expect(hitA?.itemId).toBe("a");
    // 'b' rect spans (60..90, 60..90).
    const hitB = handle.pickItemAt(75, 75, 0);
    expect(hitB?.itemId).toBe("b");

    handle.stop();
  });

  it("returns null on empty pixels", async () => {
    const buf = makeFakePickBuffer(100, 100);
    const { handle } = await attachWith(twoRectComp(), buf);

    // (55, 55) is outside both rects.
    expect(handle.pickItemAt(55, 55, 0)).toBeNull();
    handle.stop();
  });

  it("returns null for out-of-bounds coordinates", async () => {
    const buf = makeFakePickBuffer(100, 100);
    const { handle } = await attachWith(twoRectComp(), buf);

    expect(handle.pickItemAt(-1, 50, 0)).toBeNull();
    expect(handle.pickItemAt(200, 50, 0)).toBeNull();
    expect(handle.pickItemAt(50, -1, 0)).toBeNull();
    expect(handle.pickItemAt(50, 200, 0)).toBeNull();
    expect(handle.pickItemAt(Number.NaN, 50, 0)).toBeNull();
    handle.stop();
  });

  it("the topmost layer wins where items overlap", async () => {
    const buf = makeFakePickBuffer(100, 100);
    const { handle } = await attachWith(overlappingComp(), buf);

    // (50, 50) is inside both 'a' (20..80) and 'b' (25..85). 'b' is on the
    // upper layer (z=10) so it should win.
    expect(handle.pickItemAt(50, 50, 0)?.itemId).toBe("b");
    // (22, 22) is inside 'a' only.
    expect(handle.pickItemAt(22, 22, 0)?.itemId).toBe("a");
    handle.stop();
  });

  it("group children resolve to the child id, not the parent group", async () => {
    const buf = makeFakePickBuffer(100, 100);
    const { handle } = await attachWith(groupComp(), buf);

    // child world-space: group(10,10) + child-local(5,5..25,25) → (15,15)..(35,35)
    expect(handle.pickItemAt(20, 20, 0)?.itemId).toBe("child");
    handle.stop();
  });

  it("honors the time arg so tweens move the hit target", async () => {
    const buf = makeFakePickBuffer(100, 100);
    const { handle } = await attachWith(movingRectComp(), buf);

    // At t=0 the rect is at x=0 → spans 0..20 horizontally.
    expect(handle.pickItemAt(5, 50, 0)?.itemId).toBe("m");
    expect(handle.pickItemAt(75, 50, 0)).toBeNull();

    // At t=1 the rect is at x=80 → spans 80..100 horizontally.
    expect(handle.pickItemAt(5, 50, 1)).toBeNull();
    expect(handle.pickItemAt(85, 50, 1)?.itemId).toBe("m");
    handle.stop();
  });

  it("getSourceMap returns null when emitSourceMap is off", async () => {
    const buf = makeFakePickBuffer(100, 100);
    const { handle } = await attachWith(twoRectComp(), buf);
    expect(handle.getSourceMap()).toBeNull();
    const hit = handle.pickItemAt(20, 20, 0);
    expect(hit?.source).toBeUndefined();
    handle.stop();
  });

  it("attaches a source location to the hit when emitSourceMap is on", async () => {
    const buf = makeFakePickBuffer(100, 100);
    const { handle } = await attachWith(compWithSourceMap(), buf, {
      emitSourceMap: true,
    });
    const map = handle.getSourceMap();
    expect(map).not.toBeNull();
    expect(map?.items["s"]).toBeDefined();
    expect(map?.items["s"]?.jsonPointer).toBe("/items/s");

    const hit = handle.pickItemAt(40, 40, 0);
    expect(hit?.itemId).toBe("s");
    expect(hit?.source?.jsonPointer).toBe("/items/s");
    expect(hit?.source?.originKind).toBe("literal");
    handle.stop();
  });

  it("returns null after stop()", async () => {
    const buf = makeFakePickBuffer(100, 100);
    const { handle } = await attachWith(twoRectComp(), buf);
    handle.stop();
    expect(handle.pickItemAt(20, 20, 0)).toBeNull();
  });
});
