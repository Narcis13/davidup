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
//
// ──────────────── Stage hit-testing (editor v1.0, step 16) ────────────────
//
// Beyond rendering, the driver exposes `pickItemAt(x, y, t)`: given a point in
// composition coordinates (top-left origin, pixels) and a time, it answers
// "which item is at that pixel right now?" via a hidden ID-buffer canvas.
// Each pickable item is assigned a unique 24-bit RGB color and the whole
// scene is re-rendered at full opacity into an offscreen canvas; reading the
// pixel back gives the item id. Group children get their own ids — clicking
// inside a group returns the *child*, not the parent (mirrors how
// `drawScene` recurses).
//
// When `emitSourceMap: true` is passed at attach time, the driver also
// retains the source map produced by precompile and exposes
// `getSourceMap()` plus a `source` field on the pick result so callers (the
// editor's Stage component) can light up the inspector + reveal-in-source.

import {
  BrowserAssetLoader,
  type AssetLoader,
} from "../../assets/index.js";
import { precompile } from "../../compose/index.js";
import type { ReadFile } from "../../compose/imports.js";
import {
  computeStateAt,
  indexTweens,
  renderFrame,
  type ResolvedScene,
} from "../../engine/index.js";
import type {
  Canvas2DContext,
  OffscreenSurface,
  SourceLocation,
  SourceMap,
} from "../../engine/types.js";
import type {
  Composition,
  GroupItem,
  Item,
  Layer,
  ShapeItem,
  TextItem,
} from "../../schema/types.js";

export interface AttachableCanvas {
  getContext(kind: "2d"): Canvas2DContext | null;
}

/**
 * A scratch surface used by `pickItemAt` for ID-buffer rendering. The surface
 * MUST support pixel readback (DOM canvases satisfy this via `getImageData`).
 * Tests can swap in a fake that records the calls and returns canned pixels.
 */
export interface PickSurface {
  context: Canvas2DContext;
  /** Read a single RGBA pixel from the surface. */
  readPixelRgba(x: number, y: number): { r: number; g: number; b: number; a: number };
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
   * Factory for the hidden ID-buffer canvas used by `pickItemAt`. Defaults to
   * a DOM `<canvas>` with a real `getImageData`-capable 2D context. Tests
   * supply a fake that records the calls and returns canned pixels.
   */
  createPickBuffer?: (w: number, h: number) => PickSurface;

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
  /**
   * When `true`, run precompile with source-map emission on and retain the
   * map. The handle's `pickItemAt` then includes a `source` field on hits,
   * and `getSourceMap()` returns the full map. Off by default — preserves
   * the legacy zero-allocation precompile fast path.
   */
  emitSourceMap?: boolean;
}

export interface PickHit {
  itemId: string;
  source?: SourceLocation;
}

export interface AttachHandle {
  stop(): void;
  seek(seconds: number): void;
  /**
   * Hit-test a single point in composition coordinates. Returns the resolved
   * item id at (x, y) at the given time `t` (seconds; defaults to the current
   * playhead), or `null` if no item was rendered there. Children of a group
   * resolve to their own id, not the parent group's. `source` is present
   * only when the handle was attached with `emitSourceMap: true`.
   */
  pickItemAt(x: number, y: number, t?: number): PickHit | null;
  /**
   * Returns the source map produced by precompile, or `null` if the handle
   * was not attached with `emitSourceMap: true`.
   */
  getSourceMap(): SourceMap | null;
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

  let compiled: Composition;
  let sourceMap: SourceMap | null = null;
  const precompileOpts = {
    ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
    ...(options.readFile !== undefined ? { readFile: options.readFile } : {}),
  };
  if (options.emitSourceMap === true) {
    const result = await precompile(comp, { ...precompileOpts, emitSourceMap: true });
    compiled = result.resolved as Composition;
    sourceMap = result.sourceMap;
  } else {
    compiled = (await precompile(comp, precompileOpts)) as Composition;
  }

  const loader = options.loader ?? new BrowserAssetLoader();
  await loader.preloadAll(compiled.assets);

  const now = options.now ?? defaultNow;
  const raf = options.requestAnimationFrame ?? defaultRaf;
  const caf = options.cancelAnimationFrame ?? defaultCaf;
  const createOffscreen = options.createOffscreen ?? defaultCreateOffscreen;
  const createPickBuffer = options.createPickBuffer ?? defaultCreatePickBuffer;
  const tweenIndex = indexTweens(compiled);
  const duration = compiled.composition.duration;

  let startTime = now() - (options.startAt ?? 0) * 1000;
  let rafId: number | null = null;
  let cancelled = false;

  // Pick buffer is created lazily on the first pickItemAt call so callers
  // that never hit-test don't allocate it. The composition's canvas size
  // doesn't change for the lifetime of an attach() so a single buffer is
  // enough.
  let pickBuffer: PickSurface | null = null;
  // Track the most recent t we actually rendered. Background-tab RAF
  // throttling can leave wall-clock arbitrarily far ahead of the last
  // painted frame; pickItemAt() defaults to this value so picks always
  // match the visible state on screen, not a hypothetical frame the
  // engine never drew.
  let lastRenderedT = options.startAt ?? 0;

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
    lastRenderedT = t;
    rafId = raf(tick);
  };

  // First paint synchronously — matches the design-doc reference and avoids
  // a one-frame flicker before the RAF callback fires.
  tick();

  function currentT(): number {
    // Default to the last frame we *actually rendered*, not (now() -
    // startTime), so picks line up with what's on screen even when the
    // render loop has been stalled (background tab, paused, self-
    // terminated past duration).
    const t = lastRenderedT;
    if (t < 0) return 0;
    if (duration > 0 && t > duration) return duration;
    return t;
  }

  function pickItemAt(x: number, y: number, tArg?: number): PickHit | null {
    if (cancelled) return null;
    const width = compiled.composition.width;
    const height = compiled.composition.height;
    // Composition-space bounds check. The caller is expected to clip CSS
    // coords against the canvas rect before calling, but we double-check so
    // out-of-range inputs are a safe `null` rather than an exception from
    // getImageData.
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x >= width ||
      y >= height
    ) {
      return null;
    }
    if (pickBuffer === null) {
      pickBuffer = createPickBuffer(width, height);
    }
    const t = tArg !== undefined ? tArg : currentT();
    const scene = computeStateAt(compiled, t, tweenIndex);
    const idForColor = renderPickBuffer(scene, pickBuffer.context);
    const px = Math.floor(x);
    const py = Math.floor(y);
    const rgba = pickBuffer.readPixelRgba(px, py);
    // Alpha 0 → no item painted at this pixel.
    if (rgba.a === 0) return null;
    const key = (rgba.r << 16) | (rgba.g << 8) | rgba.b;
    if (key === 0) return null;
    const itemId = idForColor.get(key);
    if (itemId === undefined) return null;
    const hit: PickHit = { itemId };
    if (sourceMap !== null) {
      const src = sourceMap.items[itemId];
      if (src !== undefined) hit.source = src;
    }
    return hit;
  }

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
      // Update the pick-time fallback immediately so a click that lands
      // between seek() and the next RAF still resolves against the seeked
      // frame, not the prior one.
      lastRenderedT = seconds;
      if (cancelled) return;
      // The loop self-stops once t > duration; seeking back into bounds must
      // re-prime it. tick() always clears rafId before doing work, so the
      // null-check guarantees we never double-schedule.
      if (rafId === null) {
        rafId = raf(tick);
      }
    },
    pickItemAt,
    getSourceMap(): SourceMap | null {
      return sourceMap;
    },
  };
}

// ──────────────── ID-buffer rendering ────────────────
//
// Mirror of `drawScene` that paints every pickable item with a unique solid
// color. Layer ordering and per-item transforms must match the visible
// renderer exactly so a click that lands on a visible pixel maps to the same
// item the renderer drew there. Differences:
//
//   - globalAlpha is forced to 1 everywhere — semi-transparent items are
//     still pickable, and the renderer's opacity-multiply collapse cannot
//     accidentally make a foreground item invisible to the picker.
//   - Composite mode stays "source-over"; blend modes change visual
//     appearance but not which item painted on top.
//   - Sprites pick by their bounding rect (the destination size from
//     `drawImage`). Pixel-perfect alpha picking on sprites would require
//     re-decoding the image into the ID buffer, which is overkill for the
//     editor's needs and complicates the offscreen factory contract.
//   - Text picks by a filled `fillText` call at the same coords — the
//     filled glyphs are the pick target.
//   - Strokes are not drawn — they don't materially change the pickable
//     region (a 1-pixel stroke outside a 200-pixel rect is below the
//     editor's interaction grid).

function renderPickBuffer(
  scene: ResolvedScene,
  ctx: Canvas2DContext,
): ReadonlyMap<number, string> {
  // Clear with fully-transparent black so empty pixels are unambiguous.
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  // clearRect makes the pixels transparent (alpha=0) — we rely on alpha=0 as
  // the "no hit" sentinel rather than reserving an RGB color for it.
  ctx.clearRect(0, 0, scene.composition.width, scene.composition.height);
  ctx.restore();

  const idForColor = new Map<number, string>();
  let nextId = 1;

  const colorFor = (itemId: string): string => {
    const key = nextId++;
    idForColor.set(key, itemId);
    const r = (key >> 16) & 0xff;
    const g = (key >> 8) & 0xff;
    const b = key & 0xff;
    return `rgb(${r}, ${g}, ${b})`;
  };

  const sorted = sortLayersByZ(scene.layers);
  for (const layer of sorted) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    for (const itemId of layer.items) {
      const item = scene.items[itemId];
      if (!item) continue;
      drawPickItem(ctx, item, itemId, scene, colorFor);
    }
    ctx.restore();
  }

  return idForColor;
}

function drawPickItem(
  ctx: Canvas2DContext,
  item: Item,
  itemId: string,
  scene: ResolvedScene,
  colorFor: (id: string) => string,
): void {
  const tr = item.transform;
  ctx.save();

  ctx.translate(tr.x, tr.y);
  if (tr.rotation !== 0) ctx.rotate(tr.rotation);
  if (tr.scaleX !== 1 || tr.scaleY !== 1) ctx.scale(tr.scaleX, tr.scaleY);
  // Note: globalAlpha is intentionally NOT multiplied by tr.opacity here —
  // semi-transparent items are still pickable.
  ctx.globalAlpha = 1;

  const w = anchorWidth(item);
  const h = anchorHeight(item);
  if (w !== 0 || h !== 0) {
    ctx.translate(-tr.anchorX * w, -tr.anchorY * h);
  }

  switch (item.type) {
    case "sprite":
      paintSpriteBounds(ctx, item.width, item.height, colorFor(itemId));
      break;
    case "text":
      paintTextHitArea(ctx, item, colorFor(itemId));
      break;
    case "shape":
      paintShapePath(ctx, item, colorFor(itemId));
      break;
    case "group":
      paintGroupChildren(ctx, item, scene, colorFor);
      break;
  }

  ctx.restore();
}

function paintSpriteBounds(
  ctx: Canvas2DContext,
  width: number,
  height: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
}

function paintTextHitArea(
  ctx: Canvas2DContext,
  item: TextItem,
  color: string,
): void {
  // Mirror the renderer's font + alignment exactly so the painted glyphs land
  // on the same pixels that show up on screen. We don't have access to the
  // asset registry here, but the renderer falls back to the raw font id when
  // the registry has no mapping — `ctx.font` will just use whatever the
  // browser knows by that name. Pickable area is the inked region of the
  // glyphs.
  ctx.font = `${item.fontSize}px "${item.font}"`;
  ctx.textAlign = item.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color;
  ctx.fillText(item.text, 0, 0);
}

function paintShapePath(
  ctx: Canvas2DContext,
  item: ShapeItem,
  color: string,
): void {
  ctx.fillStyle = color;
  switch (item.kind) {
    case "rect": {
      const w = item.width ?? 0;
      const h = item.height ?? 0;
      const r = item.cornerRadius ?? 0;
      if (r > 0) {
        roundRectPath(ctx, 0, 0, w, h, r);
        ctx.fill();
      } else {
        // beginPath + rect + fill (rather than fillRect) so we use the same
        // path-fill code path as the renderer's rounded variant.
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.fill();
      }
      break;
    }
    case "circle": {
      const d = item.width ?? 0;
      const r = d / 2;
      ctx.beginPath();
      ctx.arc(r, r, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "polygon": {
      const pts = item.points ?? [];
      if (pts.length === 0) break;
      ctx.beginPath();
      const head = pts[0]!;
      ctx.moveTo(head[0], head[1]);
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i]!;
        ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
}

function paintGroupChildren(
  ctx: Canvas2DContext,
  item: GroupItem,
  scene: ResolvedScene,
  colorFor: (id: string) => string,
): void {
  for (const childId of item.items) {
    const child = scene.items[childId];
    if (!child) continue;
    drawPickItem(ctx, child, childId, scene, colorFor);
  }
}

function sortLayersByZ(layers: ReadonlyArray<Layer>): ReadonlyArray<Layer> {
  // Stable sort by z; layers tied at the same z keep their declaration order.
  // Identical to the renderer's sort so the painter's algorithm matches.
  const indexed = layers.map((layer, idx) => ({ layer, idx }));
  indexed.sort((a, b) => {
    if (a.layer.z !== b.layer.z) return a.layer.z - b.layer.z;
    return a.idx - b.idx;
  });
  return indexed.map((x) => x.layer);
}

function anchorWidth(item: Item): number {
  if (item.type === "sprite") return item.width;
  if (item.type === "shape") return item.width ?? 0;
  return 0;
}

function anchorHeight(item: Item): number {
  if (item.type === "sprite") return item.height;
  if (item.type === "shape") {
    if (item.kind === "circle") return item.height ?? item.width ?? 0;
    return item.height ?? 0;
  }
  return 0;
}

function roundRectPath(
  ctx: Canvas2DContext,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arc(x + w - radius, y + radius, radius, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2);
  ctx.lineTo(x + radius, y + h);
  ctx.arc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + radius);
  ctx.arc(x + radius, y + radius, radius, Math.PI, (3 * Math.PI) / 2);
  ctx.closePath();
}

// ──────────────── Default factory implementations ────────────────

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

function defaultCreatePickBuffer(width: number, height: number): PickSurface {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) {
    throw new Error(
      "browser driver: no document — cannot create offscreen canvas for pickItemAt",
    );
  }
  const c = doc.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d", { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!ctx) {
    throw new Error("browser driver: pick-buffer getContext('2d') returned null");
  }
  return {
    context: ctx as unknown as Canvas2DContext,
    readPixelRgba(x: number, y: number) {
      const data = ctx.getImageData(x, y, 1, 1).data;
      return { r: data[0]!, g: data[1]!, b: data[2]!, a: data[3]! };
    },
  };
}
