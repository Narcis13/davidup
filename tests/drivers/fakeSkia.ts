// Drop-in skia-canvas substitute used by the node-driver unit tests.
// Wraps the existing FakeContext so we get a real Canvas2D-shaped state stack
// for renderFrame to draw into, while toBuffer hands back a deterministic
// RGBA byte array sized to the canvas.

import { vi } from "vitest";

import type { SkiaDriverModule } from "../../src/drivers/node/index.js";
import type { Canvas2DContext } from "../../src/engine/types.js";
import { FakeContext } from "../engine/fakeContext.js";

export interface FakeCanvasInstance {
  width: number;
  height: number;
  ctx: FakeContext;
  toBufferCalls: number;
  getContext(kind: "2d"): Canvas2DContext;
  toBuffer(format: "raw"): Promise<Uint8Array>;
}

export function makeFakeSkia(): SkiaDriverModule & {
  loadImage: ReturnType<typeof vi.fn>;
  FontLibrary: { use: ReturnType<typeof vi.fn> };
  canvases: FakeCanvasInstance[];
} {
  const canvases: FakeCanvasInstance[] = [];

  class Canvas implements FakeCanvasInstance {
    width: number;
    height: number;
    ctx: FakeContext = new FakeContext();
    toBufferCalls = 0;

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      canvases.push(this);
    }

    getContext(_kind: "2d"): Canvas2DContext {
      return this.ctx;
    }

    async toBuffer(_format: "raw"): Promise<Uint8Array> {
      this.toBufferCalls++;
      return new Uint8Array(this.width * this.height * 4);
    }
  }

  return {
    Canvas: Canvas as unknown as SkiaDriverModule["Canvas"],
    loadImage: vi.fn(async (src: string) => ({ src })),
    FontLibrary: { use: vi.fn() },
    canvases,
  };
}
