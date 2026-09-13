// v1.1 S5 — the browser driver threads an optional `video` provider into every
// paint, so the editor stage can draw video items (previously they drew
// nothing because `attach` never passed one).

import { describe, expect, it } from "vitest";

import { attach } from "../../src/drivers/browser/index.js";
import type { AssetLoader } from "../../src/assets/index.js";
import type {
  Canvas2DContext,
  VideoClip,
  VideoFrameProvider,
} from "../../src/engine/types.js";
import type { Composition } from "../../src/schema/types.js";
import { FakeContext } from "../engine/fakeContext.js";

function videoComp(): Composition {
  return {
    version: "0.1",
    composition: { width: 32, height: 32, fps: 5, duration: 2, background: "#000000" },
    assets: [
      { id: "clip", type: "video", src: "/project-files/clip.mp4", duration: 1, width: 320, height: 240, fps: 30 },
    ],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["v"] }],
    items: {
      v: {
        type: "video",
        asset: "clip",
        width: 32,
        height: 32,
        start: 0,
        trimIn: 0,
        trimOut: 1,
        fit: "fill",
        loop: false,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
      },
    },
    tweens: [],
  };
}

const stubLoader = {
  preloadAll: async () => {},
  load: async () => {},
  has: () => false,
  clear: () => {},
  getImage: () => undefined,
  getFontFamily: () => undefined,
} as unknown as AssetLoader;

function mount(video?: VideoFrameProvider) {
  const ctx = new FakeContext();
  const canvas = { getContext: (_: "2d"): Canvas2DContext | null => ctx };
  const handle = attach(videoComp(), canvas, {
    loader: stubLoader,
    now: () => 0,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    ...(video ? { video } : {}),
  });
  return { ctx, handle };
}

function drawn(ctx: FakeContext): unknown[] {
  return ctx.calls.flatMap((c) => (c.op === "drawImage" ? [c.image] : []));
}

describe("browser attach — video frame provider", () => {
  it("draws the provider's frame for the playhead, and re-resolves on seek", async () => {
    const requested: number[] = [];
    const clip: VideoClip = {
      frameCount: 5,
      width: 320,
      height: 240,
      getFrame: (i) => {
        requested.push(i);
        return { frame: i };
      },
    };
    const { ctx, handle } = mount({ getClip: (id) => (id === "v" ? clip : undefined) });
    const h = await handle;
    h.pause();

    expect(drawn(ctx)).toEqual([{ frame: 1 }]);

    ctx.calls.length = 0;
    h.seek(0.5); // floor(0.5 * 5) + 1
    expect(drawn(ctx)).toEqual([{ frame: 3 }]);

    ctx.calls.length = 0;
    h.seek(1.5); // past the 5-frame clip, no loop → freezes on the last frame
    expect(drawn(ctx)).toEqual([{ frame: 5 }]);
    expect(requested).toEqual([1, 3, 5]);
    h.stop();
  });

  it("a provider miss draws nothing; the next seek picks the frame up", async () => {
    let ready = false;
    const { ctx, handle } = mount({
      getClip: () => ({
        frameCount: 5,
        width: 320,
        height: 240,
        getFrame: () => (ready ? { frame: "late" } : undefined),
      }),
    });
    const h = await handle;
    h.pause();
    expect(drawn(ctx)).toEqual([]);

    ready = true;
    h.seek(0);
    expect(drawn(ctx)).toEqual([{ frame: "late" }]);
    h.stop();
  });

  it("without a provider, video items still draw nothing", async () => {
    const { ctx, handle } = mount();
    const h = await handle;
    expect(drawn(ctx)).toEqual([]);
    h.stop();
  });
});
