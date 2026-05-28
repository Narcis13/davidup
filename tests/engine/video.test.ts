// Render-time video drawing (v0.2 §S8). Golden frame-by-frame checks at the
// key times from the plan: t=0, t=mid, t=end-1, t=after-trim (freeze), and
// t=after-trim (loop). Plus the `fit` dst/src-rect math, sprite/text parity,
// and that every existing tween (x, y, opacity, width, height) drives a video
// item exactly as it would a sprite.
//
// These run against the FakeContext + an injected VideoFrameProvider, so they
// are fully deterministic and need no skia / ffmpeg native build.

import { describe, expect, it } from "vitest";

import {
  computeFitRects,
  renderFrame,
  videoFrameIndex,
  type AssetRegistry,
} from "../../src/engine/index.js";
import type {
  Composition,
  SpriteItem,
  TextItem,
  Tween,
  VideoItem,
} from "../../src/schema/types.js";
import type { VideoFrameProvider } from "../../src/engine/types.js";
import { FakeContext } from "./fakeContext.js";

// ─────────────────────────────── helpers ───────────────────────────────────

const IDENTITY = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0,
  anchorY: 0,
  opacity: 1,
} as const;

function videoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    type: "video",
    asset: "clip",
    width: 100,
    height: 100,
    start: 0,
    fit: "fill",
    loop: false,
    transform: { ...IDENTITY },
    ...overrides,
  };
}

function compWith(
  items: Composition["items"],
  layers: Composition["layers"],
  opts: { fps?: number; duration?: number; tweens?: Tween[] } = {},
): Composition {
  return {
    version: "0.1",
    composition: {
      width: 200,
      height: 200,
      fps: opts.fps ?? 10,
      duration: opts.duration ?? 3,
      background: "#000000",
    },
    assets: [],
    layers,
    items,
    tweens: opts.tweens ?? [],
  };
}

interface ClipSpec {
  frameCount: number;
  width: number;
  height: number;
}

// A provider whose frames are tagged objects { __frame: i } so a test can read
// back exactly which 1-based frame index the renderer chose to draw.
function fakeProvider(clips: Record<string, ClipSpec>): VideoFrameProvider {
  const map = new Map(
    Object.entries(clips).map(([id, c]) => [
      id,
      {
        frameCount: c.frameCount,
        width: c.width,
        height: c.height,
        getFrame: (i: number): unknown =>
          i >= 1 && i <= c.frameCount ? { __frame: i } : undefined,
      },
    ]),
  );
  return { getClip: (id: string) => map.get(id) };
}

const oneVideoLayer: Composition["layers"] = [
  { id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["v"] },
];

// Pull the single video frame drawImage call (image tagged { __frame }).
function frameDraw(ctx: FakeContext) {
  return ctx.calls.find(
    (c) =>
      c.op === "drawImage" &&
      typeof c.image === "object" &&
      c.image !== null &&
      "__frame" in (c.image as Record<string, unknown>),
  );
}

function drawnFrameIndex(ctx: FakeContext): number | undefined {
  const d = frameDraw(ctx);
  if (d && d.op === "drawImage") {
    return (d.image as { __frame: number }).__frame;
  }
  return undefined;
}

// ─────────────────────────── videoFrameIndex (pure) ────────────────────────

describe("videoFrameIndex", () => {
  it("maps t=start to the first frame (1-based)", () => {
    expect(videoFrameIndex(0, 0, 10, 10, false)).toBe(1);
  });

  it("floors localTime*fps then +1", () => {
    expect(videoFrameIndex(0.5, 0, 10, 10, false)).toBe(6); // floor(5)+1
    expect(videoFrameIndex(0.9, 0, 10, 10, false)).toBe(10); // floor(9)+1
  });

  it("freezes on the last frame once content is exhausted (loop=false)", () => {
    expect(videoFrameIndex(1.0, 0, 10, 10, false)).toBe(10); // floor(10) → clamp
    expect(videoFrameIndex(5.0, 0, 10, 10, false)).toBe(10);
  });

  it("wraps with modulo once content is exhausted (loop=true)", () => {
    expect(videoFrameIndex(1.0, 0, 10, 10, true)).toBe(1); // 10 % 10 = 0 → frame 1
    expect(videoFrameIndex(1.5, 0, 10, 10, true)).toBe(6); // 15 % 10 = 5 → frame 6
  });

  it("returns undefined before the clip start", () => {
    expect(videoFrameIndex(0.5, 1, 10, 10, false)).toBeUndefined();
  });

  it("honours a non-zero start", () => {
    expect(videoFrameIndex(2.0, 2, 10, 10, false)).toBe(1);
    expect(videoFrameIndex(2.5, 2, 10, 10, false)).toBe(6);
  });

  it("recovers the intended frame across float error from t = i/fps", () => {
    const fps = 30;
    for (let i = 0; i < 30; i++) {
      const t = i / fps;
      expect(videoFrameIndex(t, 0, fps, 30, false)).toBe(i + 1);
    }
  });
});

// ─────────────────────── golden frame selection over time ──────────────────

describe("renderFrame — video frame selection (golden key times)", () => {
  // 10 frames @ 10fps ⇒ content spans localTime [0, 1).
  const clip: ClipSpec = { frameCount: 10, width: 100, height: 100 };

  function renderAt(t: number, loop: boolean): FakeContext {
    const ctx = new FakeContext();
    const comp = compWith({ v: videoItem({ loop }) }, oneVideoLayer);
    renderFrame(comp, t, ctx, { video: fakeProvider({ v: clip }) });
    return ctx;
  }

  it("t=0 → frame 1", () => {
    expect(drawnFrameIndex(renderAt(0, false))).toBe(1);
  });

  it("t=mid (0.5) → frame 6", () => {
    expect(drawnFrameIndex(renderAt(0.5, false))).toBe(6);
  });

  it("t=end-1 (0.9, last content frame) → frame 10", () => {
    expect(drawnFrameIndex(renderAt(0.9, false))).toBe(10);
  });

  it("t after trim, loop=false → freezes on the last frame (10)", () => {
    expect(drawnFrameIndex(renderAt(1.5, false))).toBe(10);
    expect(drawnFrameIndex(renderAt(2.8, false))).toBe(10);
  });

  it("t after trim, loop=true → wraps (1.5 → frame 6)", () => {
    expect(drawnFrameIndex(renderAt(1.5, true))).toBe(6);
    expect(drawnFrameIndex(renderAt(2.0, true))).toBe(1);
  });
});

// ─────────────────────────── temporal gating ───────────────────────────────

describe("renderFrame — video temporal window", () => {
  const clip: ClipSpec = { frameCount: 10, width: 100, height: 100 };

  it("draws nothing before the clip start", () => {
    const ctx = new FakeContext();
    const comp = compWith({ v: videoItem({ start: 1 }) }, oneVideoLayer);
    renderFrame(comp, 0.5, ctx, { video: fakeProvider({ v: clip }) });
    expect(frameDraw(ctx)).toBeUndefined();
  });

  it("starts at frame 1 exactly at the clip start", () => {
    const ctx = new FakeContext();
    const comp = compWith({ v: videoItem({ start: 1 }) }, oneVideoLayer);
    renderFrame(comp, 1, ctx, { video: fakeProvider({ v: clip }) });
    expect(drawnFrameIndex(ctx)).toBe(1);
  });

  it("draws nothing at or after `end` (half-open window)", () => {
    const ctx = new FakeContext();
    const comp = compWith({ v: videoItem({ start: 0, end: 1 }) }, oneVideoLayer);
    renderFrame(comp, 1, ctx, { video: fakeProvider({ v: clip }) });
    expect(frameDraw(ctx)).toBeUndefined();
  });

  it("still draws (freeze) inside `end` after content is exhausted", () => {
    // content spans [0,1); end=2 ⇒ [1,2) freezes on last frame.
    const ctx = new FakeContext();
    const comp = compWith({ v: videoItem({ start: 0, end: 2 }) }, oneVideoLayer);
    renderFrame(comp, 1.5, ctx, { video: fakeProvider({ v: clip }) });
    expect(drawnFrameIndex(ctx)).toBe(10);
  });
});

// ───────────────────────────── missing provider ────────────────────────────

describe("renderFrame — video without a frame source draws nothing", () => {
  it("no provider → no drawImage", () => {
    const ctx = new FakeContext();
    const comp = compWith({ v: videoItem() }, oneVideoLayer);
    renderFrame(comp, 0, ctx); // options.video omitted
    expect(ctx.calls.some((c) => c.op === "drawImage")).toBe(false);
  });

  it("provider with no clip for the item → no drawImage", () => {
    const ctx = new FakeContext();
    const comp = compWith({ v: videoItem() }, oneVideoLayer);
    renderFrame(comp, 0, ctx, { video: fakeProvider({ other: { frameCount: 3, width: 10, height: 10 } }) });
    expect(ctx.calls.some((c) => c.op === "drawImage")).toBe(false);
  });
});

// ────────────────────────────── fit (pure math) ────────────────────────────

describe("computeFitRects", () => {
  // intrinsic 200×100 (2:1) into a 100×100 box.
  it("fill stretches the whole frame to the box", () => {
    expect(computeFitRects("fill", 200, 100, 100, 100)).toEqual({
      sx: 0, sy: 0, sw: 200, sh: 100, dx: 0, dy: 0, dw: 100, dh: 100,
    });
  });

  it("contain fits inside the box and letterboxes (whole frame visible)", () => {
    expect(computeFitRects("contain", 200, 100, 100, 100)).toEqual({
      sx: 0, sy: 0, sw: 200, sh: 100, dx: 0, dy: 25, dw: 100, dh: 50,
    });
  });

  it("cover fills the box and crops the source overflow", () => {
    expect(computeFitRects("cover", 200, 100, 100, 100)).toEqual({
      sx: 50, sy: 0, sw: 100, sh: 100, dx: 0, dy: 0, dw: 100, dh: 100,
    });
  });

  it("none draws 1:1, cropping the centre when the frame is larger", () => {
    expect(computeFitRects("none", 200, 100, 100, 100)).toEqual({
      sx: 50, sy: 0, sw: 100, sh: 100, dx: 0, dy: 0, dw: 100, dh: 100,
    });
  });

  it("none centres (letterbox) when the frame is smaller than the box", () => {
    expect(computeFitRects("none", 50, 50, 100, 100)).toEqual({
      sx: 0, sy: 0, sw: 50, sh: 50, dx: 25, dy: 25, dw: 50, dh: 50,
    });
  });

  it("degenerate inputs fall back to a full→full map", () => {
    expect(computeFitRects("contain", 0, 0, 100, 100)).toEqual({
      sx: 0, sy: 0, sw: 0, sh: 0, dx: 0, dy: 0, dw: 100, dh: 100,
    });
  });
});

describe("renderFrame — video fit issues a 9-arg drawImage", () => {
  it("passes the computed cover src+dst rects to drawImage", () => {
    const ctx = new FakeContext();
    // box 100×100, intrinsic 200×100 → cover crops horizontally.
    const comp = compWith(
      { v: videoItem({ fit: "cover", width: 100, height: 100 }) },
      oneVideoLayer,
    );
    renderFrame(comp, 0, ctx, {
      video: fakeProvider({ v: { frameCount: 4, width: 200, height: 100 } }),
    });
    const d = frameDraw(ctx);
    expect(d).toBeDefined();
    if (d && d.op === "drawImage") {
      expect({ sx: d.sx, sy: d.sy, sw: d.sw, sh: d.sh }).toEqual({
        sx: 50, sy: 0, sw: 100, sh: 100,
      });
      expect({ dx: d.dx, dy: d.dy, dw: d.dw, dh: d.dh }).toEqual({
        dx: 0, dy: 0, dw: 100, dh: 100,
      });
    }
  });
});

// ─────────────────────────────── tween parity ──────────────────────────────

describe("renderFrame — video honours the same tweens as a sprite", () => {
  const clip: ClipSpec = { frameCount: 10, width: 100, height: 100 };

  it("x / y tween moves the box (translate)", () => {
    const ctx = new FakeContext();
    const comp = compWith({ v: videoItem() }, oneVideoLayer, {
      tweens: [
        { id: "tx", target: "v", property: "transform.x", from: 0, to: 80, start: 0, duration: 1, easing: "linear" },
        { id: "ty", target: "v", property: "transform.y", from: 0, to: 40, start: 0, duration: 1, easing: "linear" },
      ],
    });
    renderFrame(comp, 0.5, ctx, { video: fakeProvider({ v: clip }) });
    const firstTranslate = ctx.calls.find((c) => c.op === "translate");
    expect(firstTranslate && firstTranslate.op === "translate" && {
      x: firstTranslate.x,
      y: firstTranslate.y,
    }).toEqual({ x: 40, y: 20 });
  });

  it("opacity tween multiplies into the frame's globalAlpha", () => {
    const ctx = new FakeContext();
    const comp = compWith({ v: videoItem() }, oneVideoLayer, {
      tweens: [
        { id: "to", target: "v", property: "transform.opacity", from: 0, to: 1, start: 0, duration: 1, easing: "linear" },
      ],
    });
    renderFrame(comp, 0.5, ctx, { video: fakeProvider({ v: clip }) });
    const d = frameDraw(ctx);
    expect(d && d.op === "drawImage" && d.alpha).toBeCloseTo(0.5, 10);
  });

  it("width / height tween resizes the destination box (fill)", () => {
    const ctx = new FakeContext();
    const comp = compWith({ v: videoItem({ fit: "fill", width: 100, height: 100 }) }, oneVideoLayer, {
      tweens: [
        { id: "tw", target: "v", property: "width", from: 100, to: 200, start: 0, duration: 1, easing: "linear" },
        { id: "th", target: "v", property: "height", from: 100, to: 50, start: 0, duration: 1, easing: "linear" },
      ],
    });
    renderFrame(comp, 0.5, ctx, { video: fakeProvider({ v: clip }) });
    const d = frameDraw(ctx);
    expect(d && d.op === "drawImage" && { dw: d.dw, dh: d.dh }).toEqual({ dw: 150, dh: 75 });
  });
});

// ──────────────────── combined golden: video + sprite + text ───────────────

describe("renderFrame — video + sprite + text compose correctly", () => {
  const stubAssets: AssetRegistry = {
    getImage: (id) => (id === "logo" ? { __image: id } : undefined),
    getFontFamily: (id) => (id === "inter" ? "Inter" : undefined),
  };

  function combinedComp(): Composition {
    const v = videoItem({ width: 120, height: 80, transform: { ...IDENTITY, x: 10, y: 20 } });
    const sprite: SpriteItem = {
      type: "sprite",
      asset: "logo",
      width: 64,
      height: 64,
      transform: { ...IDENTITY, x: 130, y: 100 },
    };
    const text: TextItem = {
      type: "text",
      text: "Hello",
      font: "inter",
      fontSize: 24,
      color: "#ffffff",
      transform: { ...IDENTITY, x: 5, y: 180 },
    };
    return compWith(
      { v, logo: sprite, title: text },
      [
        { id: "video", z: 0, opacity: 1, blendMode: "normal", items: ["v"] },
        { id: "fg", z: 1, opacity: 1, blendMode: "normal", items: ["logo", "title"] },
      ],
    );
  }

  it("draws the right video frame, the sprite, and the text together at t=mid", () => {
    const ctx = new FakeContext();
    const comp = combinedComp();
    renderFrame(comp, 0.5, ctx, {
      assets: stubAssets,
      video: fakeProvider({ v: { frameCount: 10, width: 120, height: 80 } }),
    });

    // Video: frame 6 at t=0.5, fill into the 120×80 box.
    expect(drawnFrameIndex(ctx)).toBe(6);
    const vd = frameDraw(ctx);
    if (vd && vd.op === "drawImage") {
      expect({ dw: vd.dw, dh: vd.dh }).toEqual({ dw: 120, dh: 80 });
    }

    // Sprite: its own drawImage with the logo image, 64×64.
    const spriteDraw = ctx.calls.find(
      (c) => c.op === "drawImage" && (c.image as { __image?: string })?.__image === "logo",
    );
    expect(spriteDraw).toBeDefined();
    if (spriteDraw && spriteDraw.op === "drawImage") {
      expect({ dw: spriteDraw.dw, dh: spriteDraw.dh }).toEqual({ dw: 64, dh: 64 });
    }

    // Text: a fillText with the resolved font family.
    const text = ctx.calls.find((c) => c.op === "fillText");
    expect(text).toBeDefined();
    if (text && text.op === "fillText") {
      expect(text.text).toBe("Hello");
      expect(text.font).toContain("Inter");
    }
  });

  it("advances the video frame across the timeline while sprite/text stay put", () => {
    const provider = fakeProvider({ v: { frameCount: 10, width: 120, height: 80 } });
    const frames = [0, 0.5, 0.9, 1.5].map((t) => {
      const ctx = new FakeContext();
      renderFrame(combinedComp(), t, ctx, { assets: stubAssets, video: provider });
      return drawnFrameIndex(ctx);
    });
    // t=0→1, mid→6, end-1→10, freeze→10.
    expect(frames).toEqual([1, 6, 10, 10]);
  });
});
