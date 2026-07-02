// Canvas2D-only renderer. Platform-agnostic: receives a Canvas2DContext that
// both browsers and skia-canvas implement. No DOM-specific calls.
//
// Pipeline (per design-doc §5.2):
//   1. Resolve scene state at time t.
//   2. Paint background.
//   3. For each layer (sorted by z): save → set alpha & blend → draw items → restore.
//
// drawItem performs the per-item Canvas2D dance: translate to (x,y), rotate,
// scale, multiply opacity, then translate by anchor offset before delegating
// to the type-specific draw function. Groups recurse — Canvas2D's save/restore
// stack handles transform matrix composition for free (per §5.4).

import type {
  BlendMode,
  GroupItem,
  Item,
  Layer,
  ShapeItem,
  SpriteItem,
  TextItem,
  VideoFit,
  VideoItem,
} from "../schema/types.js";
import type { Composition } from "../schema/types.js";
import {
  computeStateAt,
  type ResolvedScene,
  type TweenIndex,
} from "./resolver.js";
import type {
  AssetRegistry,
  Canvas2DContext,
  OffscreenSurface,
  RenderOptions,
  VideoFrameProvider,
} from "./types.js";

// Subset of RenderOptions plumbed through the per-item draw functions. Built
// once per renderFrame call so we don't reach back into the public options
// shape from deep in the call tree.
interface DrawContext {
  assets: AssetRegistry | undefined;
  createOffscreen: ((w: number, h: number) => OffscreenSurface) | undefined;
  // Composition time (seconds) of the frame being painted. Video items map it
  // through their `start`/trim window to a frame index; every other item type
  // ignores it. Defaults to 0 for legacy callers that don't render video.
  time: number;
  // Resolves pre-extracted frames for video items; undefined ⇒ video draws
  // nothing. See {@link VideoFrameProvider}.
  video: VideoFrameProvider | undefined;
}

const COMPOSITE_NORMAL = "source-over";

// Guards `floor(localTime * fps)` against the float error in `t = i / fps`
// round-tripped back through `* fps`: e.g. frame 29 can surface as 28.9999999
// and floor to 28. A 1e-6 nudge recovers the intended integer without ever
// bumping a genuinely sub-frame time up to the next index.
const FRAME_EPSILON = 1e-6;

export function renderFrame(
  comp: Composition,
  t: number,
  ctx: Canvas2DContext,
  options: RenderOptions = {},
): void {
  const scene = computeStateAt(comp, t, options.index);
  drawScene(scene, ctx, options.assets, options.createOffscreen, {
    time: t,
    ...(options.video !== undefined ? { video: options.video } : {}),
  });
}

// Optional video render context for `drawScene`. `time` is the composition
// time of the frame; `video` resolves a clip's frames. Omitting it (legacy
// callers / non-video scenes) makes video items draw nothing.
export interface VideoRenderContext {
  time: number;
  video?: VideoFrameProvider;
}

export function drawScene(
  scene: ResolvedScene,
  ctx: Canvas2DContext,
  assets: AssetRegistry | undefined,
  createOffscreen?: (w: number, h: number) => OffscreenSurface,
  video?: VideoRenderContext,
): void {
  drawBackground(
    ctx,
    scene.composition.background,
    scene.composition.width,
    scene.composition.height,
  );

  const dc: DrawContext = {
    assets,
    createOffscreen,
    time: video?.time ?? 0,
    video: video?.video,
  };

  const sorted = sortLayersByZ(scene.layers);
  for (const layer of sorted) {
    // §M visibility: absent ≡ visible. Skipping early avoids the save/restore
    // pair and any descendant draws — a hidden layer is truly free at render.
    if (layer.visible === false) continue;
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * layer.opacity;
    applyBlendMode(ctx, layer.blendMode);
    for (const itemId of layer.items) {
      const item = scene.items[itemId];
      if (!item) continue;
      if (item.visible === false) continue;
      drawItem(ctx, item, scene, assets, dc, itemId);
    }
    ctx.restore();
  }
}

export function drawItem(
  ctx: Canvas2DContext,
  item: Item,
  scene: ResolvedScene,
  assets: AssetRegistry | undefined,
  dc: DrawContext = {
    assets,
    createOffscreen: undefined,
    time: 0,
    video: undefined,
  },
  itemId?: string,
): void {
  const tr = item.transform;
  ctx.save();

  ctx.translate(tr.x, tr.y);
  if (tr.rotation !== 0) ctx.rotate(tr.rotation);
  if (tr.scaleX !== 1 || tr.scaleY !== 1) ctx.scale(tr.scaleX, tr.scaleY);
  ctx.globalAlpha = ctx.globalAlpha * tr.opacity;

  const w = anchorWidth(item);
  const h = anchorHeight(item);
  if (w !== 0 || h !== 0) {
    ctx.translate(-tr.anchorX * w, -tr.anchorY * h);
  }

  switch (item.type) {
    case "sprite":
      drawSprite(ctx, item, dc);
      break;
    case "text":
      drawText(ctx, item, assets);
      break;
    case "shape":
      drawShape(ctx, item);
      break;
    case "video":
      drawVideo(ctx, item, scene, dc, itemId);
      break;
    case "group":
      drawGroupChildren(ctx, item, scene, dc);
      break;
  }

  ctx.restore();
}

function sortLayersByZ(layers: ReadonlyArray<Layer>): ReadonlyArray<Layer> {
  // Stable sort by z; layers tied at the same z keep their declaration order.
  const indexed = layers.map((layer, idx) => ({ layer, idx }));
  indexed.sort((a, b) => {
    if (a.layer.z !== b.layer.z) return a.layer.z - b.layer.z;
    return a.idx - b.idx;
  });
  return indexed.map((x) => x.layer);
}

function drawBackground(
  ctx: Canvas2DContext,
  color: string,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = COMPOSITE_NORMAL;
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function applyBlendMode(ctx: Canvas2DContext, mode: BlendMode): void {
  // CSS-style "normal" maps to Canvas2D's default "source-over"; everything
  // else is a validated Canvas2D composite op (see CANVAS2D_COMPOSITE_OPS).
  ctx.globalCompositeOperation = mode === "normal" ? COMPOSITE_NORMAL : mode;
}

function anchorWidth(item: Item): number {
  if (item.type === "sprite") return item.width;
  // Video is spatially a sprite: its anchor pivots on the [width, height] box.
  if (item.type === "video") return item.width;
  if (item.type === "shape") return item.width ?? 0;
  return 0;
}

function anchorHeight(item: Item): number {
  if (item.type === "sprite") return item.height;
  if (item.type === "video") return item.height;
  if (item.type === "shape") {
    // §3.2: a circle's `width` is its diameter on both axes, and `height` is
    // intentionally not authored. Fall back to width so anchorY actually
    // shifts the circle vertically.
    if (item.kind === "circle") return item.height ?? item.width ?? 0;
    return item.height ?? 0;
  }
  return 0;
}

function drawSprite(
  ctx: Canvas2DContext,
  item: SpriteItem,
  dc: DrawContext,
): void {
  const image = dc.assets?.getImage(item.asset);
  if (image === undefined) return;
  const tint = item.tint;
  // No tint, identity (white) tint, or no offscreen factory wired by the
  // driver → just paint the image. Skipping the offscreen on white avoids
  // a per-frame allocation when the tween parks on its identity colour.
  if (tint === undefined || isIdentityTint(tint) || !dc.createOffscreen) {
    ctx.drawImage(image, 0, 0, item.width, item.height);
    return;
  }

  // Paint a `source-atop` opaque tint fill onto the image (whose alpha channel
  // we keep verbatim by drawing it first). Earlier code used `multiply` then
  // `destination-in` to mask back, which double-counted the source alpha on
  // semi-transparent PNGs (E2): the multiply blend tints through partially-
  // transparent pixels, and the destination-in mask re-applies image alpha on
  // top of the outer `globalAlpha × tr.opacity`. Trade-off: flat tint over the
  // silhouette rather than a luminance-preserving multiply.
  const off = dc.createOffscreen(item.width, item.height);
  const oc = off.context;
  oc.drawImage(image, 0, 0, item.width, item.height);
  oc.globalCompositeOperation = "source-atop";
  oc.fillStyle = tint;
  oc.fillRect(0, 0, item.width, item.height);
  // Restore default for any reuse of the offscreen by other code paths.
  oc.globalCompositeOperation = "source-over";
  ctx.drawImage(off.source, 0, 0, item.width, item.height);
}

function isIdentityTint(tint: string): boolean {
  // Cheap match for common spellings of pure white. Anything ambiguous takes
  // the multiply path — multiply by an actual #ffffff is a no-op anyway, so
  // false negatives only cost an offscreen allocation, not correctness.
  const norm = tint.replace(/\s+/g, "").toLowerCase();
  return (
    norm === "#ffffff" ||
    norm === "#fff" ||
    norm === "white" ||
    norm === "rgb(255,255,255)" ||
    norm === "rgba(255,255,255,1)"
  );
}

// Video clip drawing (v0.2 §S8). A VideoItem is a sprite-shaped texture whose
// pixels come from a pre-extracted PNG sequence (§S7). The transform stack
// (position, rotation, scale, anchor, opacity) has already been applied by
// drawItem exactly as for a sprite — so x/y/opacity/width/height tweens behave
// identically. Here we only resolve WHICH frame to paint at this composition
// time and HOW it fills the box.
//
// Frame selection (per the §S8 spec):
//   localFrame = floor((t - start) * fps)            // 0-based offset into clip
//   when localFrame ≥ frameCount (content exhausted):
//     loop  → wrap with modulo
//     else  → freeze on the last available frame
//   frameIndex = localFrame + 1                       // 1-based, matches %05d.png
//
// The clip's available `frameCount` is the authority for the trim window: it
// already equals round((trimOut - trimIn) * fps), so we never have to re-derive
// the window from trimIn/trimOut (and it stays correct when trimOut was EOF).
function drawVideo(
  ctx: Canvas2DContext,
  item: VideoItem,
  scene: ResolvedScene,
  dc: DrawContext,
  itemId: string | undefined,
): void {
  if (dc.video === undefined || itemId === undefined) return;
  const clip = dc.video.getClip(itemId);
  if (!clip || clip.frameCount < 1) return;

  const t = dc.time;
  // Temporal window [start, end): nothing to paint before the clip begins or
  // once its placement ends (freeze/loop only fills the gap up to `end`).
  if (t < item.start) return;
  if (item.end !== undefined && t >= item.end) return;

  const fps = scene.composition.fps;
  const frameIndex = videoFrameIndex(
    t,
    item.start,
    fps,
    clip.frameCount,
    item.loop,
  );
  if (frameIndex === undefined) return;

  const image = clip.getFrame(frameIndex);
  if (image === undefined) return;

  const r = computeFitRects(item.fit, clip.width, clip.height, item.width, item.height);
  if (r.sw <= 0 || r.sh <= 0 || r.dw <= 0 || r.dh <= 0) return;
  ctx.drawImage(image, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
}

/**
 * 1-based frame index (matching ffmpeg's `%05d.png`) to paint for a video clip
 * at composition time `t`, or undefined when `t` precedes the clip's `start`.
 *
 * Pure and exported for unit testing. `frameCount` is the number of frames
 * available in the pre-extracted sequence; `loop` wraps past the end, otherwise
 * the last frame freezes.
 */
export function videoFrameIndex(
  t: number,
  start: number,
  fps: number,
  frameCount: number,
  loop: boolean,
): number | undefined {
  if (frameCount < 1) return undefined;
  const localFrame = Math.floor((t - start) * fps + FRAME_EPSILON);
  if (localFrame < 0) return undefined;
  let idx0: number;
  if (localFrame >= frameCount) {
    idx0 = loop
      ? ((localFrame % frameCount) + frameCount) % frameCount
      : frameCount - 1;
  } else {
    idx0 = localFrame;
  }
  return idx0 + 1;
}

/** A source rect (crop) + destination rect for a `drawImage` 9-arg call. */
export interface FitRects {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Map a frame of intrinsic size `iw × ih` into a `bw × bh` box per CSS
 * `object-fit` semantics, returning the source-crop + destination rects for a
 * 9-arg `drawImage`. Pure and exported for unit testing.
 *
 *   fill    — stretch to the box (aspect not preserved).
 *   contain — scale to fit inside the box, letterboxed (whole frame visible).
 *   cover   — scale to cover the box, cropping the overflow (box fully filled).
 *   none    — 1:1 pixels, centered; crops if larger than the box, letterboxes
 *             if smaller. No scaling.
 *
 * cover/none crop via the source rect rather than overflowing, so a clip never
 * paints outside its own box onto neighbouring items.
 */
export function computeFitRects(
  fit: VideoFit,
  iw: number,
  ih: number,
  bw: number,
  bh: number,
): FitRects {
  // Degenerate inputs: fall back to a plain full→full map (the caller skips a
  // zero-area result anyway).
  if (iw <= 0 || ih <= 0 || bw <= 0 || bh <= 0) {
    return {
      sx: 0,
      sy: 0,
      sw: Math.max(0, iw),
      sh: Math.max(0, ih),
      dx: 0,
      dy: 0,
      dw: Math.max(0, bw),
      dh: Math.max(0, bh),
    };
  }

  switch (fit) {
    case "fill":
      return { sx: 0, sy: 0, sw: iw, sh: ih, dx: 0, dy: 0, dw: bw, dh: bh };
    case "contain": {
      const s = Math.min(bw / iw, bh / ih);
      const dw = iw * s;
      const dh = ih * s;
      return { sx: 0, sy: 0, sw: iw, sh: ih, dx: (bw - dw) / 2, dy: (bh - dh) / 2, dw, dh };
    }
    case "cover": {
      const s = Math.max(bw / iw, bh / ih);
      const sw = bw / s;
      const sh = bh / s;
      return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh, dx: 0, dy: 0, dw: bw, dh: bh };
    }
    case "none": {
      const vw = Math.min(iw, bw);
      const vh = Math.min(ih, bh);
      return {
        sx: (iw - vw) / 2,
        sy: (ih - vh) / 2,
        sw: vw,
        sh: vh,
        dx: (bw - vw) / 2,
        dy: (bh - vh) / 2,
        dw: vw,
        dh: vh,
      };
    }
  }
}

function drawText(
  ctx: Canvas2DContext,
  item: TextItem,
  assets: AssetRegistry | undefined,
): void {
  const family = assets?.getFontFamily(item.font) ?? item.font;
  ctx.font = `${item.fontSize}px "${family}"`;
  ctx.textAlign = item.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = item.color;
  ctx.fillText(item.text, 0, 0);
}

function drawShape(ctx: Canvas2DContext, item: ShapeItem): void {
  switch (item.kind) {
    case "rect": {
      const w = item.width ?? 0;
      const h = item.height ?? 0;
      const r = item.cornerRadius ?? 0;
      if (r > 0) {
        roundRectPath(ctx, 0, 0, w, h, r);
      } else {
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
      }
      paintShape(ctx, item);
      break;
    }
    case "circle": {
      // §3.2: width is the diameter for circles.
      const d = item.width ?? 0;
      const r = d / 2;
      ctx.beginPath();
      ctx.arc(r, r, r, 0, Math.PI * 2);
      paintShape(ctx, item);
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
      paintShape(ctx, item);
      break;
    }
  }
}

function paintShape(ctx: Canvas2DContext, item: ShapeItem): void {
  if (item.fillColor !== undefined) {
    ctx.fillStyle = item.fillColor;
    ctx.fill();
  }
  const sw = item.strokeWidth ?? 0;
  if (item.strokeColor !== undefined && sw > 0) {
    ctx.strokeStyle = item.strokeColor;
    ctx.lineWidth = sw;
    ctx.stroke();
  }
}

function drawGroupChildren(
  ctx: Canvas2DContext,
  item: GroupItem,
  scene: ResolvedScene,
  dc: DrawContext,
): void {
  for (const childId of item.items) {
    const child = scene.items[childId];
    if (!child) continue;
    if (child.visible === false) continue;
    drawItem(ctx, child, scene, dc.assets, dc, childId);
  }
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
