// Browser preview driver — Canvas2D + requestAnimationFrame loop (per design-doc §5.6).
//
// Pipeline per frame:
//   1. Compute t = (now() - startTime) / 1000.
//   2. If t > duration → stop scheduling (last rendered frame holds on screen).
//   3. renderFrame(comp, t, ctx) — same engine as the server driver.
//   4. Schedule next frame via requestAnimationFrame.
//
// Before the loop starts, the driver runs `precompile()` (COMPOSITION_PRIMITIVES
// §10.3) so callers can hand authored v0.2 JSON containing `$ref` / `$behavior`
// markers directly. For canonical v0.1 input the precompile call is a no-op.
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
import { precompile } from "../../compose/index.js";
import type { ReadFile } from "../../compose/imports.js";
import { indexTweens, renderFrame } from "../../engine/index.js";
import type { Canvas2DContext, OffscreenSurface } from "../../engine/types.js";
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
  // Test injection point. Defaults to a DOM <canvas>; tests pass a fake.
  createOffscreen?: (w: number, h: number) => OffscreenSurface;

  /**
   * Path of the file the composition was loaded from. Required only when the
   * composition contains `$ref` markers — relative refs resolve against this
   * file's directory (COMPOSITION_PRIMITIVES.md §5.3).
   */
  sourcePath?: string;
  /**
   * Custom file reader used by the `$ref` resolver. The browser has no
   * file system; pass an in-memory map (e.g. `(p) => Promise.resolve(map[p])`)
   * to satisfy this when authored compositions reference external files.
   */
  readFile?: ReadFile;
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

  const compiled = (await precompile(comp, {
    ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
    ...(options.readFile !== undefined ? { readFile: options.readFile } : {}),
  })) as Composition;

  const loader = options.loader ?? new BrowserAssetLoader();
  await loader.preloadAll(compiled.assets);

  const now = options.now ?? defaultNow;
  const raf = options.requestAnimationFrame ?? defaultRaf;
  const caf = options.cancelAnimationFrame ?? defaultCaf;
  const createOffscreen = options.createOffscreen ?? defaultCreateOffscreen;
  const tweenIndex = indexTweens(compiled);
  const duration = compiled.composition.duration;

  let startTime = now() - (options.startAt ?? 0) * 1000;
  let rafId: number | null = null;
  let cancelled = false;

  const tick = (): void => {
    rafId = null;
    if (cancelled) return;
    const t = (now() - startTime) / 1000;
    if (t > duration) return;
    renderFrame(compiled, t, ctx, {
      assets: loader,
      index: tweenIndex,
      createOffscreen,
    });
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
      if (cancelled) return;
      // The loop self-stops once t > duration; seeking back into bounds must
      // re-prime it. tick() always clears rafId before doing work, so the
      // null-check guarantees we never double-schedule.
      if (rafId === null) {
        rafId = raf(tick);
      }
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

function defaultCreateOffscreen(width: number, height: number): OffscreenSurface {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) {
    throw new Error(
      "browser driver: no document — cannot create offscreen canvas for sprite tinting",
    );
  }
  const c = doc.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) {
    throw new Error("browser driver: offscreen canvas getContext('2d') returned null");
  }
  return { context: ctx as unknown as Canvas2DContext, source: c };
}
