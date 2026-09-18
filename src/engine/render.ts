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
//
// Group opacity is multiplicative alpha by default (R-20): a group's own
// `transform.opacity` multiplies `ctx.globalAlpha` exactly like any other
// item, then its children draw straight onto the shared canvas. Overlapping
// children inside the same group therefore blend against each other at full
// strength first, and that combined result gets alpha-multiplied again by the
// group's opacity — i.e. it is NOT equivalent to flattening the group to one
// layer and then applying opacity once.
//
// v1.1 S18 makes the flattened reading available as an opt-in: `isolate: true`
// on a group paints its children into a canvas-sized scratch surface (seeded
// with the CTM they would have inherited) and composites that surface once,
// with the group's opacity and its optional `blendMode`. Overlap seams vanish
// and a child's own blend mode sees only its siblings. The default is
// unchanged, so no existing frame moves. Isolation needs both an
// `OffscreenSurface` factory and the optional `getTransform`/`setTransform`
// pair on `Canvas2DContext`; a host missing either silently keeps the
// multiplicative path (see `drawItem`).
//
// v1.1 S21 per-item `effects` (blur / shadow / glow) reuse that machinery: the
// item is flattened onto a scratch surface at full alpha, each effect is
// applied in order, and the result is composited once with the item's opacity
// (see `drawWithEffects`). Shadow and glow are the Canvas2D shadow state,
// which both hosts rasterize alike. Blur is in-engine (engine/blur.ts):
// skia-canvas's `ctx.filter` blur on `drawImage` runs at half Chromium's σ,
// so the editor and the export would disagree.

import type {
  BlendMode,
  Effect,
  GroupItem,
  Item,
  Layer,
  ShapeItem,
  SpriteItem,
  TextItem,
  VideoFit,
  VideoItem,
} from "../schema/types.js";
import { fpsValue } from "../schema/fps.js";
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
  VideoClip,
  VideoFrameProvider,
  VideoFrameRequest,
} from "./types.js";
import { blurPixels } from "./blur.js";
import {
  DEFAULT_LINE_HEIGHT,
  isBoxText,
  layoutText,
  textFontString,
  type TextLayout,
} from "./textLayout.js";

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

/**
 * Warm a video provider for the frame at composition time `t` (v1.1 S6).
 *
 * `renderFrame` draws synchronously, so a provider that keeps only a bounded
 * window of decoded frames must be told which frames are about to be drawn
 * and given the chance to decode them first. Mirrors `drawVideo`'s temporal
 * math exactly (same `[start, end)` window, same `videoFrameIndex`), grouping
 * the requests per clip so items sharing a clip are prepared together. A
 * no-op for providers (or clips) without `prepare`.
 */
export async function prepareVideoFrames(
  comp: Composition,
  t: number,
  provider: VideoFrameProvider | undefined,
): Promise<void> {
  if (provider === undefined) return;
  const byClip = new Map<VideoClip, VideoFrameRequest[]>();
  for (const [id, item] of Object.entries(comp.items)) {
    if (item.type !== "video") continue;
    if (t < item.start) continue;
    if (item.end !== undefined && t >= item.end) continue;
    const clip = provider.getClip(id);
    if (!clip || clip.frameCount < 1 || clip.prepare === undefined) continue;
    const frameIndex = videoFrameIndex(
      t,
      item.start,
      fpsValue(comp.composition.fps),
      clip.frameCount,
      item.loop,
    );
    if (frameIndex === undefined) continue;
    let list = byClip.get(clip);
    if (!list) {
      list = [];
      byClip.set(clip, list);
    }
    list.push({ frameIndex, loop: item.loop });
  }
  await Promise.all([...byClip].map(([clip, reqs]) => clip.prepare!(reqs)));
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

  // v1.1 S21: an item with effects is flattened and post-processed on scratch
  // surfaces, then composited once. A host that can't isolate draws the item
  // plainly — effects are decoration, the item itself must still show.
  if (hasEffects(item) && canIsolate(ctx, dc)) {
    if (drawWithEffects(ctx, item, scene, dc, itemId)) return;
  }

  // v1.1 S18: an isolated group never enters the shared transform/alpha path
  // below — it flattens onto its own surface first, so the group's opacity and
  // blend mode are applied to the composite instead of to each child.
  if (item.type === "group" && item.isolate === true && canIsolate(ctx, dc)) {
    if (drawIsolatedGroup(ctx, item, scene, dc)) return;
    // Scratch surface turned out unusable — fall through to the default path
    // below rather than dropping the group.
  }

  ctx.save();

  ctx.translate(tr.x, tr.y);
  if (tr.rotation !== 0) ctx.rotate(tr.rotation);
  if (tr.scaleX !== 1 || tr.scaleY !== 1) ctx.scale(tr.scaleX, tr.scaleY);
  // For a group, this multiplies into every descendant's own alpha rather
  // than isolating the group and applying opacity once — see the R-20 note in
  // the module header, and `isolate: true` for the flattened reading.
  ctx.globalAlpha = ctx.globalAlpha * tr.opacity;
  // A non-isolated group's blend mode applies to each child's own draw, the
  // way `Layer.blendMode` does. Left alone when absent so the layer's (or an
  // ancestor group's) mode keeps applying.
  if (item.type === "group" && item.blendMode !== undefined) {
    applyBlendMode(ctx, item.blendMode);
  }

  if (item.type === "text") {
    // Text measures its own anchor box, which needs the font on the context
    // first — so it handles the anchor translate itself.
    drawText(ctx, item, assets);
    ctx.restore();
    return;
  }

  const w = anchorWidth(item);
  const h = anchorHeight(item);
  if (w !== 0 || h !== 0) {
    ctx.translate(-tr.anchorX * w, -tr.anchorY * h);
  }

  switch (item.type) {
    case "sprite":
      drawSprite(ctx, item, dc);
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
  // `"transparent"` (v1.1 S9) paints nothing: the frame keeps alpha 0 where
  // no item draws, which alpha codecs (ProRes 4444 / VP9) carry through.
  // Clearing rather than skipping keeps drivers that don't clear between
  // frames (the browser loop) from smearing.
  if (color.trim().toLowerCase() === "transparent") {
    ctx.clearRect(0, 0, width, height);
    return;
  }
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

  const fps = fpsValue(scene.composition.fps);
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

// Text (v1.1 S13): layout lives in textLayout.ts. Fill carries the shadow;
// the stroke is painted over the fill without one (SVG's default paint order),
// so neither pass double-draws the glyphs — a fading item keeps its alpha.
function drawText(
  ctx: Canvas2DContext,
  item: TextItem,
  assets: AssetRegistry | undefined,
): void {
  const family = assets?.getFontFamily(item.font) ?? item.font;
  const layout = applyTextStyle(ctx, item, family);
  const tr = item.transform;
  if (layout.mode === "box") {
    ctx.translate(-tr.anchorX * layout.blockWidth, -tr.anchorY * layout.blockHeight);
  }
  ctx.fillStyle = item.color;

  const shadow = item.shadow;
  if (shadow !== undefined) {
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur ?? 0;
    ctx.shadowOffsetX = shadow.offsetX ?? 0;
    ctx.shadowOffsetY = shadow.offsetY ?? 0;
  }
  for (const line of layout.lines) ctx.fillText(line.text, line.x, line.y);

  const sw = item.strokeWidth ?? 0;
  if (item.strokeColor !== undefined && sw > 0) {
    if (shadow !== undefined) {
      ctx.shadowColor = "rgba(0, 0, 0, 0)";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
    ctx.strokeStyle = item.strokeColor;
    ctx.lineWidth = sw;
    ctx.lineJoin = "round";
    for (const line of layout.lines) ctx.strokeText(line.text, line.x, line.y);
  }
}

/**
 * Set font, alignment, baseline and letter spacing for `item` on `ctx`, then
 * lay the text out with that context's metrics. Shared with the browser
 * driver's pick buffer so hit areas match the rendered glyphs.
 */
export function applyTextStyle(
  ctx: Canvas2DContext,
  item: TextItem,
  family: string,
): TextLayout {
  ctx.font = textFontString(item, family);
  ctx.textBaseline = "alphabetic";
  if (item.letterSpacing !== undefined && "letterSpacing" in ctx) {
    ctx.letterSpacing = `${item.letterSpacing}px`;
  }
  const box = isBoxText(item);
  ctx.textAlign = box ? "left" : (item.align ?? "left");
  // A lone point-mode line needs no measurement (the v1.0 fast path); its
  // width and blockWidth are reported as 0, i.e. unmeasured.
  if (!box && !item.text.includes("\n")) {
    return {
      mode: "point",
      lines: [{ text: item.text, x: 0, y: 0, width: 0 }],
      blockWidth: 0,
      blockHeight: (item.lineHeight ?? DEFAULT_LINE_HEIGHT) * item.fontSize,
    };
  }
  return layoutText(item, (t) => ctx.measureText(t).width);
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

// Everything an isolated group needs beyond the default path: a scratch
// surface to flatten into, and the ability to copy the inherited CTM onto it
// (and to get back to the canvas's own frame for the composite). A host that
// wires neither — a bare test double, a driver without `createOffscreen` —
// falls back to multiplicative alpha rather than dropping the group.
function canIsolate(ctx: Canvas2DContext, dc: DrawContext): boolean {
  return (
    dc.createOffscreen !== undefined &&
    typeof ctx.getTransform === "function" &&
    typeof ctx.setTransform === "function"
  );
}

/**
 * Paint a group's children onto a scratch surface, then composite that
 * surface once (v1.1 S18).
 *
 * The scratch surface is composition-sized and holds canvas-space pixels: it
 * is seeded with the CTM the group inherited, then given the group's own
 * transform, so every child lands on exactly the pixel it would have without
 * isolation. Children draw at `globalAlpha = 1` against transparent black —
 * that is what makes the group read as one layer, and what keeps a child's
 * own blend mode from seeing the canvas backdrop.
 *
 * The composite then runs at the canvas's identity frame (1:1, the same frame
 * `drawBackground` fills), carrying the group's `transform.opacity` on top of
 * the alpha it inherited and its `blendMode` if it declares one. Anything the
 * children painted outside the composition box is clipped — it was off-frame
 * either way.
 *
 * Returns false without drawing when the surface the factory handed back
 * can't take the inherited matrix; the caller then falls back to the default
 * path, since children in the wrong place are worse than an un-isolated group.
 */
function drawIsolatedGroup(
  ctx: Canvas2DContext,
  item: GroupItem,
  scene: ResolvedScene,
  dc: DrawContext,
): boolean {
  const { width, height } = scene.composition;
  const off = dc.createOffscreen!(width, height);
  const oc = off.context;
  if (typeof oc.setTransform !== "function") return false;

  const m = ctx.getTransform!();
  oc.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  oc.save();
  const tr = item.transform;
  oc.translate(tr.x, tr.y);
  if (tr.rotation !== 0) oc.rotate(tr.rotation);
  if (tr.scaleX !== 1 || tr.scaleY !== 1) oc.scale(tr.scaleX, tr.scaleY);
  // A group has no intrinsic box (anchorWidth/anchorHeight are 0 for it), so
  // there is no anchor translate to mirror here — matching `drawItem`.
  oc.globalAlpha = 1;
  oc.globalCompositeOperation = COMPOSITE_NORMAL;
  drawGroupChildren(oc, item, scene, dc);
  oc.restore();

  ctx.save();
  ctx.setTransform!(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = ctx.globalAlpha * tr.opacity;
  if (item.blendMode !== undefined) applyBlendMode(ctx, item.blendMode);
  ctx.drawImage(off.source, 0, 0, width, height);
  ctx.restore();
  return true;
}

function hasEffects(item: Item): boolean {
  return item.effects !== undefined && item.effects.length > 0;
}

/**
 * Draw `item` through its `effects` stack (v1.1 S21).
 *
 * 1. Flatten: paint the item onto a composition-sized scratch surface seeded
 *    with the inherited CTM — exactly as `drawIsolatedGroup` does — at
 *    `globalAlpha = 1` and source-over, via the ordinary `drawItem` path on a
 *    copy with opacity 1 and no effects. A group copy also drops `isolate`
 *    and `blendMode`: flattening already isolates its children, and the
 *    group's blend mode belongs to the final composite.
 * 2. Post-process, in order. A blur rewrites the current surface's pixels
 *    in place (engine/blur.ts). A shadow or glow redraws the current surface
 *    onto a cleared spare at the identity frame with the shadow state set —
 *    the shadow lands under the redrawn pixels — then the two swap. Two
 *    surfaces serve any stack depth.
 * 3. Composite: the result goes onto the canvas at identity, carrying the
 *    inherited alpha × the item's opacity, the inherited composite op (the
 *    layer's blend mode), and a group's own `blendMode` if it has one.
 *
 * Effect lengths are therefore canvas pixels, unaffected by the item's (or an
 * ancestor's) scale and rotation — the same convention as the text shadow.
 *
 * Returns false without drawing when the scratch surface can't take the
 * inherited matrix, so the caller falls back to drawing the item plainly.
 */
function drawWithEffects(
  ctx: Canvas2DContext,
  item: Item,
  scene: ResolvedScene,
  dc: DrawContext,
  itemId: string | undefined,
): boolean {
  const { width, height } = scene.composition;
  let src = dc.createOffscreen!(width, height);
  const oc = src.context;
  if (typeof oc.setTransform !== "function") return false;

  const m = ctx.getTransform!();
  oc.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  oc.globalAlpha = 1;
  oc.globalCompositeOperation = COMPOSITE_NORMAL;
  drawItem(oc, flattenCopy(item), scene, dc.assets, dc, itemId);

  let spare: OffscreenSurface | undefined;
  for (const effect of item.effects!) {
    if (isNoOpEffect(effect)) continue;
    if (effect.type === "blur") {
      blurSurface(src.context, width, height, effect.radius);
      continue;
    }
    spare ??= dc.createOffscreen!(width, height);
    const sc = spare.context;
    sc.setTransform!(1, 0, 0, 1, 0, 0);
    sc.clearRect(0, 0, width, height);
    sc.save();
    sc.globalAlpha = 1;
    sc.globalCompositeOperation = COMPOSITE_NORMAL;
    applyShadowState(sc, effect);
    sc.drawImage(src.source, 0, 0, width, height);
    sc.restore();
    const done = spare;
    spare = src;
    src = done;
  }

  ctx.save();
  ctx.setTransform!(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = ctx.globalAlpha * item.transform.opacity;
  if (item.type === "group" && item.blendMode !== undefined) {
    applyBlendMode(ctx, item.blendMode);
  }
  ctx.drawImage(src.source, 0, 0, width, height);
  ctx.restore();
  return true;
}

// The item as painted onto the flatten surface: full opacity (applied at the
// composite instead) and no effects (or `drawItem` would recurse forever).
function flattenCopy(item: Item): Item {
  const transform = { ...item.transform, opacity: 1 };
  if (item.type === "group") {
    const { effects: _e, isolate: _i, blendMode: _b, ...rest } = item;
    return { ...rest, transform };
  }
  const { effects: _e, ...rest } = item;
  return { ...rest, transform } as Item;
}

// Effects that would redraw the surface unchanged — skipped so a tween parked
// at radius 0 (or a transparent shadow) costs no extra surface pass.
function isNoOpEffect(effect: Effect): boolean {
  switch (effect.type) {
    case "blur":
      return !(effect.radius > 0);
    case "shadow":
      return false;
    case "glow":
      // Un-offset and unblurred, the halo would sit exactly under the item
      // and only tint its anti-aliased edge.
      return !(effect.radius > 0);
  }
}

// Blur a composition-sized scratch surface in place. A host without pixel
// access leaves the surface unblurred — the item still shows, just sharp.
function blurSurface(
  ctx: Canvas2DContext,
  width: number,
  height: number,
  sigma: number,
): void {
  if (typeof ctx.getImageData !== "function" || typeof ctx.putImageData !== "function") {
    return;
  }
  const img = ctx.getImageData(0, 0, width, height);
  blurPixels(img, sigma);
  ctx.putImageData(img, 0, 0);
}

function applyShadowState(
  ctx: Canvas2DContext,
  effect: Exclude<Effect, { type: "blur" }>,
): void {
  switch (effect.type) {
    case "shadow":
      ctx.shadowColor = effect.color;
      ctx.shadowBlur = effect.blur ?? 0;
      ctx.shadowOffsetX = effect.offsetX ?? 0;
      ctx.shadowOffsetY = effect.offsetY ?? 0;
      return;
    case "glow":
      // Canvas2D's shadowBlur is 2σ; `radius` is σ, matching the blur effect.
      ctx.shadowColor = effect.color;
      ctx.shadowBlur = effect.radius * 2;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      return;
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
