// getItemBoundsAt tests (editor v1.0, step 20.18).
//
// `getItemBoundsAt(id, t?)` walks the resolved scene the same way the
// picker does, accumulates the renderer's translate/rotate/scale/anchor
// chain into a 3×3 affine, and emits the four world-space corners of the
// item's local rectangle (or, for groups, the AABB of all descendants).
//
// The tests below feed the driver compositions whose expected corners we
// can compute by hand (translated rects, anchored rects, rotated rects,
// scaled rects, groups with nested transforms, tweened positions) and
// assert the corners come back to within sub-pixel precision.

import { describe, expect, it } from "vitest";

import { attach } from "../../src/drivers/browser/index.js";
import type { AssetLoader } from "../../src/assets/index.js";
import type { Asset, Composition } from "../../src/schema/types.js";
import type { Canvas2DContext } from "../../src/engine/types.js";
import { FakeContext } from "../engine/fakeContext.js";

class FakeCanvas {
  ctx = new FakeContext();
  getContext(_kind: "2d"): Canvas2DContext | null {
    return this.ctx;
  }
}

function makeFakeRaf() {
  let nextId = 1;
  const queue = new Map<number, (t: number) => void>();
  return {
    schedule(cb: (t: number) => void): number {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    cancel(id: number): void {
      queue.delete(id);
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

// Two non-overlapping rects on a single layer — used to assert basic
// translated AABBs.
function twoRectComp(): Composition {
  return {
    version: "0.1",
    composition: { width: 200, height: 200, fps: 60, duration: 1, background: "#000" },
    assets: [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["a", "b"] }],
    items: {
      a: {
        type: "shape",
        kind: "rect",
        width: 40,
        height: 30,
        fillColor: "#f00",
        transform: { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
      },
      b: {
        type: "sprite",
        asset: "x",
        width: 20,
        height: 20,
        transform: { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
      },
    },
    tweens: [],
  } as Composition;
}

// Centered-anchor rect rotated 90° about its center. The 4 corners of the
// 40×30 local rect rotate around the anchor.
function rotatedAnchoredRectComp(): Composition {
  return {
    version: "0.1",
    composition: { width: 200, height: 200, fps: 60, duration: 1, background: "#000" },
    assets: [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["r"] }],
    items: {
      r: {
        type: "shape",
        kind: "rect",
        width: 40,
        height: 30,
        fillColor: "#fff",
        transform: {
          x: 100,
          y: 100,
          scaleX: 1,
          scaleY: 1,
          rotation: Math.PI / 2,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 1,
        },
      },
    },
    tweens: [],
  } as Composition;
}

// Scaled rect — checks the scale step in the matrix chain.
function scaledRectComp(): Composition {
  return {
    version: "0.1",
    composition: { width: 200, height: 200, fps: 60, duration: 1, background: "#000" },
    assets: [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["s"] }],
    items: {
      s: {
        type: "shape",
        kind: "rect",
        width: 20,
        height: 10,
        fillColor: "#0f0",
        transform: {
          x: 50,
          y: 50,
          scaleX: 2,
          scaleY: 3,
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

// Group + child — the child reports world-space corners that include the
// group's translation. The group's own bounds collapse to that child's AABB.
function groupComp(): Composition {
  return {
    version: "0.1",
    composition: { width: 200, height: 200, fps: 60, duration: 1, background: "#000" },
    assets: [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["g"] }],
    items: {
      g: {
        type: "group",
        items: ["child"],
        transform: { x: 50, y: 50, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
      } as Composition["items"][string],
      child: {
        type: "shape",
        kind: "rect",
        width: 10,
        height: 20,
        fillColor: "#00f",
        transform: { x: 5, y: 5, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
      },
    },
    tweens: [],
  } as Composition;
}

// Moving rect — exercises the time arg threading.
function movingRectComp(): Composition {
  return {
    version: "0.1",
    composition: { width: 200, height: 100, fps: 60, duration: 1, background: "#000" },
    assets: [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["m"] }],
    items: {
      m: {
        type: "shape",
        kind: "rect",
        width: 20,
        height: 20,
        fillColor: "#fff",
        transform: { x: 0, y: 40, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
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
        duration: 1,
        easing: "linear",
      },
    ],
  } as Composition;
}

// Polygon — its AABB tracks the point cloud, not item.width.
function polygonComp(): Composition {
  return {
    version: "0.1",
    composition: { width: 200, height: 200, fps: 60, duration: 1, background: "#000" },
    assets: [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["p"] }],
    items: {
      p: {
        type: "shape",
        kind: "polygon",
        points: [
          [0, 0],
          [30, 0],
          [15, 20],
        ],
        fillColor: "#ff0",
        transform: { x: 10, y: 10, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
      },
    },
    tweens: [],
  } as Composition;
}

function approx(actual: number, expected: number, eps = 1e-6): void {
  expect(Math.abs(actual - expected)).toBeLessThan(eps);
}

function approxCorners(
  got: ReadonlyArray<readonly [number, number]>,
  want: ReadonlyArray<[number, number]>,
): void {
  expect(got.length).toBe(want.length);
  for (let i = 0; i < want.length; i++) {
    approx(got[i]![0], want[i]![0], 1e-5);
    approx(got[i]![1], want[i]![1], 1e-5);
  }
}

async function attachComp(comp: Composition) {
  const canvas = new FakeCanvas();
  const clock = new FakeClock(0);
  const raf = makeFakeRaf();
  return attach(comp, canvas, {
    loader: noopLoader(),
    now: clock.now,
    requestAnimationFrame: raf.schedule,
    cancelAnimationFrame: raf.cancel,
  });
}

describe("getItemBoundsAt", () => {
  it("returns null for an unknown item id", async () => {
    const handle = await attachComp(twoRectComp());
    expect(handle.getItemBoundsAt("missing", 0)).toBeNull();
    handle.stop();
  });

  it("translates a top-level rect to its world position", async () => {
    const handle = await attachComp(twoRectComp());
    const a = handle.getItemBoundsAt("a", 0);
    expect(a).not.toBeNull();
    // 40×30 rect at (10, 20), no anchor offset → corners (10,20)(50,20)(50,50)(10,50).
    approxCorners(a!.corners, [
      [10, 20],
      [50, 20],
      [50, 50],
      [10, 50],
    ]);
    handle.stop();
  });

  it("includes the sprite's width/height in its corners", async () => {
    const handle = await attachComp(twoRectComp());
    const b = handle.getItemBoundsAt("b", 0);
    approxCorners(b!.corners, [
      [100, 100],
      [120, 100],
      [120, 120],
      [100, 120],
    ]);
    handle.stop();
  });

  it("rotates around a centered anchor", async () => {
    const handle = await attachComp(rotatedAnchoredRectComp());
    // Local rect: 40×30. Anchor (0.5, 0.5) centers the rect on (100,100).
    // After 90° rotation, local x maps to world y and local y maps to world -x.
    // Corner (0,0) → translated by anchor to (-20,-15), then rotated 90° → (15,-20),
    // then translated by (100,100) → (115, 80).
    const r = handle.getItemBoundsAt("r", 0);
    approxCorners(r!.corners, [
      [115, 80],
      [115, 120],
      [85, 120],
      [85, 80],
    ]);
    handle.stop();
  });

  it("applies non-uniform scale before producing world corners", async () => {
    const handle = await attachComp(scaledRectComp());
    // 20×10 local rect, scale (2,3), translate (50,50), no anchor → 40×30 at (50,50).
    const s = handle.getItemBoundsAt("s", 0);
    approxCorners(s!.corners, [
      [50, 50],
      [90, 50],
      [90, 80],
      [50, 80],
    ]);
    handle.stop();
  });

  it("composes group + child transforms", async () => {
    const handle = await attachComp(groupComp());
    // Group at (50,50). Child at (5,5) within the group → (55,55), size 10×20.
    const child = handle.getItemBoundsAt("child", 0);
    approxCorners(child!.corners, [
      [55, 55],
      [65, 55],
      [65, 75],
      [55, 75],
    ]);
    handle.stop();
  });

  it("group bounds wrap the AABB of all descendants", async () => {
    const handle = await attachComp(groupComp());
    const g = handle.getItemBoundsAt("g", 0);
    // Only one child → group AABB equals the child's bounds.
    approxCorners(g!.corners, [
      [55, 55],
      [65, 55],
      [65, 75],
      [55, 75],
    ]);
    handle.stop();
  });

  it("threads the time arg so tweens move the bounds", async () => {
    const handle = await attachComp(movingRectComp());
    const t0 = handle.getItemBoundsAt("m", 0);
    approxCorners(t0!.corners, [
      [0, 40],
      [20, 40],
      [20, 60],
      [0, 60],
    ]);
    const t1 = handle.getItemBoundsAt("m", 1);
    approxCorners(t1!.corners, [
      [80, 40],
      [100, 40],
      [100, 60],
      [80, 60],
    ]);
    handle.stop();
  });

  it("polygons take their AABB from the point cloud", async () => {
    const handle = await attachComp(polygonComp());
    // Points (0,0),(30,0),(15,20) translated by (10,10) → AABB (10,10)..(40,30).
    const p = handle.getItemBoundsAt("p", 0);
    approxCorners(p!.corners, [
      [10, 10],
      [40, 10],
      [40, 30],
      [10, 30],
    ]);
    handle.stop();
  });

  it("returns null after stop()", async () => {
    const handle = await attachComp(twoRectComp());
    handle.stop();
    expect(handle.getItemBoundsAt("a", 0)).toBeNull();
  });
});
