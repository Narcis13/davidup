// Where an item's paint can land on the canvas (v1.3 G8, finding P-1).
//
// `drawIsolatedGroup` and `drawWithEffects` flatten onto a scratch surface and
// composite it once. Until now that surface was always composition-sized: a
// 120 px badge with a glow on a 4K canvas allocated, cleared and composited
// 8.3 megapixels, of which it used 0.02. This module answers "which pixels
// could this item actually touch", so the surface can be cut to that box.
//
// Two rules keep the answer safe to build a surface from:
//
//   1. It is a *superset*, never an estimate. Stroke widths, miter spikes and
//      the reach of every effect in the stack are added on; the box is then
//      clamped to the canvas, which is where the old surface clipped anyway.
//      Blur sums coverage from inside its own buffer only, so as long as
//      nothing that could paint falls outside the box, the pixels that come
//      out are the ones the composition-sized surface produced — byte for
//      byte, which is what the golden hashes check.
//
//   2. It is `undefined` whenever the renderer cannot know, or whenever a
//      smaller surface would not be equivalent. Text is the first case: its
//      extent comes from measuring glyphs against a font that is only on the
//      context at draw time, and guessing it would be guessing where someone's
//      title ends. Shadow and glow are the second — see
//      {@link mustUseWholeCanvas}. `undefined` means "use the whole canvas",
//      i.e. exactly the pre-v1.3 behaviour.

import type { Effect, Item } from "../schema/types.js";
import type { ResolvedScene } from "./resolver.js";
import type { CanvasMatrix } from "./types.js";
import { blurReach } from "./blur.js";
import { anchorHeight, anchorWidth } from "./anchor.js";

/** An axis-aligned box in canvas pixels. */
export interface PaintBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * How far past its own geometry a Canvas2D shadow of `shadowBlur` can carry
 * coverage, in pixels.
 *
 * The spec defines the shadow as a Gaussian of standard deviation
 * `shadowBlur / 2`; implementations approximate it, and both hosts do so with
 * a support of about 3σ. 4σ — i.e. twice `shadowBlur` — leaves a whole
 * standard deviation of headroom, because the cost of over-reaching is a few
 * wasted pixels and the cost of under-reaching is a clipped halo.
 */
function shadowSpread(shadowBlur: number): number {
  return Math.max(0, shadowBlur) * 2;
}

/**
 * Whether an item carrying these effects has to flatten onto a whole-canvas
 * surface rather than a box cut to its own paint.
 *
 * Blur is the engine's own code on raw pixels (engine/blur.ts): it reads only
 * what is inside its buffer, so a buffer that contains everything the item can
 * paint produces the same bytes as a canvas-sized one. Shadow and glow are the
 * *host's* Canvas2D shadow state, and both hosts rasterize a shadow slightly
 * differently depending on the surface it lands on — measured with skia-canvas,
 * the same 6 px glow drawn into a 90 × 80 surface and into a 120 × 80 one
 * disagrees by one unit of alpha on about twenty pixels of the halo.
 *
 * One unit of alpha is invisible, but it is not the same frame, and a scratch
 * surface's size is an implementation detail that must not reach the output.
 * So a stack with a shadow or a glow in it keeps the surface it has always
 * had, and only the in-engine blur gets the smaller one. That is also where
 * the time is: the blur is the pass that reads and rewrites every pixel.
 */
export function mustUseWholeCanvas(effects: readonly Effect[] | undefined): boolean {
  if (effects === undefined) return false;
  for (const effect of effects) {
    if (effect.type === "shadow" || effect.type === "glow") return true;
  }
  return false;
}

/**
 * Pixels an `effects` stack can carry coverage beyond the item's own paint.
 *
 * The stack applies in order and each pass works on the last one's output, so
 * the reaches add rather than max.
 */
export function effectsReach(effects: readonly Effect[] | undefined): number {
  if (effects === undefined) return 0;
  let reach = 0;
  for (const effect of effects) {
    switch (effect.type) {
      case "blur":
        reach += blurReach(effect.radius);
        break;
      case "shadow":
        reach +=
          Math.max(Math.abs(effect.offsetX ?? 0), Math.abs(effect.offsetY ?? 0)) +
          shadowSpread(effect.blur ?? 0);
        break;
      case "glow":
        // `applyShadowState` sets shadowBlur to twice the glow radius.
        reach += shadowSpread(effect.radius * 2);
        break;
    }
  }
  return reach;
}

/**
 * The box `item` and its descendants can paint inside, in canvas pixels, given
 * `m` — the matrix in force *before* the item's own transform, i.e. what
 * `ctx.getTransform()` reads at the top of `drawItem`. Its own `effects` are
 * not included; the caller adds that reach, because it also decides how the
 * result is clamped.
 *
 * `undefined` means "this subtree cannot be flattened onto a cut-down
 * surface" — either something in it has an extent the renderer does not know,
 * or something in it casts a host shadow ({@link mustUseWholeCanvas}). See the
 * module header.
 */
export function itemPaintBounds(
  item: Item,
  scene: ResolvedScene,
  m: CanvasMatrix,
): PaintBounds | undefined {
  const out = empty();
  return accumulate(item, scene, m, out, 0) ? out : undefined;
}

// Depth cap: a malformed composition can list a group inside itself, and the
// renderer's own recursion is bounded by the stack rather than by a check.
// Giving up (→ full canvas) is the safe answer, and matches what the surface
// did before this module existed.
const MAX_DEPTH = 64;

function accumulate(
  item: Item,
  scene: ResolvedScene,
  parent: CanvasMatrix,
  out: PaintBounds,
  depth: number,
): boolean {
  if (depth > MAX_DEPTH) return false;
  const m = multiply(parent, itemMatrix(item));

  if (item.type === "group") {
    for (const childId of item.items) {
      const child = scene.items[childId];
      if (!child) continue;
      if (child.visible === false) continue;
      // Each child is measured on its own, because its effects spread in
      // canvas pixels around *its* box — growing the running union instead
      // would miss a heavily blurred child that sits inside a bigger sibling.
      // A descendant that casts a host shadow pins the whole flatten to the
      // canvas, because its own scratch surface is cut from this one.
      if (mustUseWholeCanvas(child.effects)) return false;
      const childBounds = empty();
      if (!accumulate(child, scene, m, childBounds, depth + 1)) return false;
      if (childBounds.maxX < childBounds.minX) continue;
      const reach = effectsReach(child.effects);
      union(out, childBounds, reach);
    }
    return true;
  }

  const box = localPaintBox(item);
  if (box === undefined) return false;
  pushCorners(out, m, box);
  return true;
}

function empty(): PaintBounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function union(out: PaintBounds, add: PaintBounds, grow: number): void {
  if (add.minX - grow < out.minX) out.minX = add.minX - grow;
  if (add.minY - grow < out.minY) out.minY = add.minY - grow;
  if (add.maxX + grow > out.maxX) out.maxX = add.maxX + grow;
  if (add.maxY + grow > out.maxY) out.maxY = add.maxY + grow;
}

/** The item's own transform, in the order `drawItem` applies it. */
function itemMatrix(item: Item): CanvasMatrix {
  const tr = item.transform;
  let m: CanvasMatrix = { a: 1, b: 0, c: 0, d: 1, e: tr.x, f: tr.y };
  if (tr.rotation !== 0) {
    const cos = Math.cos(tr.rotation);
    const sin = Math.sin(tr.rotation);
    m = multiply(m, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
  }
  if (tr.scaleX !== 1 || tr.scaleY !== 1) {
    m = multiply(m, { a: tr.scaleX, b: 0, c: 0, d: tr.scaleY, e: 0, f: 0 });
  }
  const aw = anchorWidth(item);
  const ah = anchorHeight(item);
  if (aw !== 0 || ah !== 0) {
    m = multiply(m, { a: 1, b: 0, c: 0, d: 1, e: -tr.anchorX * aw, f: -tr.anchorY * ah });
  }
  return m;
}

/**
 * Local-space box a non-group item paints inside, or undefined when unknown.
 * A `[0, 0, 0, 0]` box is a real answer (an item that paints nothing), not a
 * refusal.
 */
function localPaintBox(item: Item): readonly [number, number, number, number] | undefined {
  switch (item.type) {
    case "sprite":
    case "video":
      // `drawImage` never paints outside its destination rect.
      return [0, 0, item.width, item.height];
    case "text":
      // Measured at draw time against a font the engine does not have here.
      return undefined;
    case "shape": {
      const stroke = item.strokeColor !== undefined ? (item.strokeWidth ?? 0) : 0;
      switch (item.kind) {
        case "rect": {
          const half = stroke / 2;
          return [-half, -half, (item.width ?? 0) + stroke, (item.height ?? 0) + stroke];
        }
        case "circle": {
          const half = stroke / 2;
          const d = item.width ?? 0;
          return [-half, -half, d + stroke, d + stroke];
        }
        case "polygon": {
          const pts = item.points ?? [];
          if (pts.length === 0) return [0, 0, 0, 0];
          let x0 = Infinity;
          let y0 = Infinity;
          let x1 = -Infinity;
          let y1 = -Infinity;
          for (const [px, py] of pts) {
            if (px < x0) x0 = px;
            if (px > x1) x1 = px;
            if (py < y0) y0 = py;
            if (py > y1) y1 = py;
          }
          // A miter join at a sharp corner runs past the path by up to
          // `miterLimit` half-widths, and Canvas2D's default miterLimit is 10.
          const spike = stroke * 5;
          return [x0 - spike, y0 - spike, x1 - x0 + spike * 2, y1 - y0 + spike * 2];
        }
      }
      return undefined;
    }
    case "group":
      // Handled by `accumulate`; a group paints no pixels of its own.
      return [0, 0, 0, 0];
  }
}

function pushCorners(
  out: PaintBounds,
  m: CanvasMatrix,
  [x, y, w, h]: readonly [number, number, number, number],
): void {
  push(out, m, x, y);
  push(out, m, x + w, y);
  push(out, m, x, y + h);
  push(out, m, x + w, y + h);
}

function push(out: PaintBounds, m: CanvasMatrix, x: number, y: number): void {
  const px = m.a * x + m.c * y + m.e;
  const py = m.b * x + m.d * y + m.f;
  if (px < out.minX) out.minX = px;
  if (px > out.maxX) out.maxX = px;
  if (py < out.minY) out.minY = py;
  if (py > out.maxY) out.maxY = py;
}

/** `p · q`, in Canvas2D's column-vector convention. */
function multiply(p: CanvasMatrix, q: CanvasMatrix): CanvasMatrix {
  return {
    a: p.a * q.a + p.c * q.b,
    b: p.b * q.a + p.d * q.b,
    c: p.a * q.c + p.c * q.d,
    d: p.b * q.c + p.d * q.d,
    e: p.a * q.e + p.c * q.f + p.e,
    f: p.b * q.e + p.d * q.f + p.f,
  };
}

/**
 * The scratch surface `drawWithEffects` / `drawIsolatedGroup` should allocate
 * for `item`: a whole-pixel canvas-space rect, or undefined to keep the
 * composition-sized surface.
 *
 * `undefined` comes back for an unknown extent, for a stack that has to stay
 * on the canvas-sized surface ({@link mustUseWholeCanvas}), for anything that
 * would still cover most of the canvas (the sub-rect path only earns its keep
 * when it saves real pixels), and for an empty box — an item with nothing to
 * paint is rare enough not to deserve its own surface size.
 */
export function scratchSurfaceRect(
  item: Item,
  scene: ResolvedScene,
  m: CanvasMatrix,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } | undefined {
  if (mustUseWholeCanvas(item.effects)) return undefined;
  const bounds = itemPaintBounds(item, scene, m);
  if (bounds === undefined) return undefined;
  if (!(bounds.maxX >= bounds.minX) || !(bounds.maxY >= bounds.minY)) return undefined;

  const reach = effectsReach(item.effects);
  // One pixel of slack on every side, so a fractional coordinate that lands
  // on a boundary can never round the anti-aliased edge out of the box.
  const pad = reach + 1;
  const x = Math.max(0, Math.floor(bounds.minX - pad));
  const y = Math.max(0, Math.floor(bounds.minY - pad));
  const right = Math.min(width, Math.ceil(bounds.maxX + pad));
  const bottom = Math.min(height, Math.ceil(bounds.maxY + pad));
  const w = right - x;
  const h = bottom - y;
  if (w <= 0 || h <= 0) return undefined;
  if (w * h > width * height * SUB_RECT_MAX_AREA) return undefined;
  return { x, y, width: w, height: h };
}

/**
 * Above this share of the canvas the sub-rect is not worth its own code path:
 * the saving is noise and the full-surface path is the one every existing
 * frame was rendered through.
 */
const SUB_RECT_MAX_AREA = 0.9;
