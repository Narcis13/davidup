// Browser preview driver — Canvas2D + requestAnimationFrame loop (per design-doc §5.6).
//
// Pipeline per frame:
//   1. Compute t = (now() - startTime) / 1000.
//   2. If t > duration → stop scheduling (last rendered frame holds on screen).
//   3. renderFrame(comp, t, ctx) — same engine as the server driver.
//   4. Schedule next frame via requestAnimationFrame.
//
// Asset preloading runs once before the loop starts: returning the handle is
// awaited on, so callers can rely on images/fonts being ready by the time the
// promise resolves. The tween index is computed once and reused (per §5.7).
//
// Clock and RAF are dependency-injected so tests can drive the loop step-by-step
// without needing a real browser. Defaults fall back to performance.now() and
// the global requestAnimationFrame; setTimeout is used as a last-resort fallback
// for environments without RAF (e.g. JSDOM-less Node).

import {
  BrowserAssetLoader,
  type AssetLoader,
} from "../../assets/index.js";
import { indexTweens, renderFrame } from "../../engine/index.js";
import type { Canvas2DContext } from "../../engine/types.js";
import type { Composition } from "../../schema/types.js";

export interface AttachableCanvas {
  getContext(kind: "2d"): Canvas2DContext | null;
}

export interface AttachOptions {
  loader?: AssetLoader;
  startAt?: number;
  now?: () => number;
  requestAnimationFrame?: (cb: (t: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
}

export interface AttachHandle {
  stop(): void;
  seek(seconds: number): void;
}

export async function attach(
  comp: Composition,
  canvas: AttachableCanvas,
  options: AttachOptions = {},
): Promise<AttachHandle> {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("attach: canvas.getContext('2d') returned null");
  }

  const loader = options.loader ?? new BrowserAssetLoader();
  await loader.preloadAll(comp.assets);

  const now = options.now ?? defaultNow;
  const raf = options.requestAnimationFrame ?? defaultRaf;
  const caf = options.cancelAnimationFrame ?? defaultCaf;
  const tweenIndex = indexTweens(comp);
  const duration = comp.composition.duration;

  let startTime = now() - (options.startAt ?? 0) * 1000;
  let rafId: number | null = null;
  let cancelled = false;

  const tick = (): void => {
    rafId = null;
    if (cancelled) return;
    const t = (now() - startTime) / 1000;
    if (t > duration) return;
    renderFrame(comp, t, ctx, { assets: loader, index: tweenIndex });
    rafId = raf(tick);
  };

  // First paint synchronously — matches the design-doc reference and avoids
  // a one-frame flicker before the RAF callback fires.
  tick();

  return {
    stop(): void {
      if (cancelled) return;
      cancelled = true;
      if (rafId !== null) {
        caf(rafId);
        rafId = null;
      }
    },
    seek(seconds: number): void {
      startTime = now() - seconds * 1000;
    },
  };
}

function defaultNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function defaultRaf(cb: (t: number) => void): number {
  const g = globalThis as {
    requestAnimationFrame?: (cb: (t: number) => void) => number;
  };
  if (typeof g.requestAnimationFrame === "function") {
    return g.requestAnimationFrame(cb);
  }
  return setTimeout(() => cb(defaultNow()), 16) as unknown as number;
}

function defaultCaf(id: number): void {
  const g = globalThis as {
    cancelAnimationFrame?: (id: number) => void;
  };
  if (typeof g.cancelAnimationFrame === "function") {
    g.cancelAnimationFrame(id);
    return;
  }
  clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}
