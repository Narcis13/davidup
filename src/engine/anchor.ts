// The box `transform.anchorX/anchorY` are fractions of.
//
// Its own module rather than a corner of render.ts so `engine/bounds.ts` can
// pivot an item exactly the way the renderer does without importing the
// renderer back (v1.3 G8). `render.ts` re-exports both, so every existing
// importer — the browser driver's hit-testing and selection-ring math, the
// engine index — is unaffected.

import type { Item } from "../schema/types.js";

/**
 * The box `transform.anchorX/anchorY` are fractions of. Zero on both axes
 * means the item has no box and the anchor is inert.
 *
 * A group's box is declarative and optional (v1.3, L-3): it is whatever the
 * author (or scene expansion, from the scene's `size`) put on `width`/`height`
 * — *not* the children's measured extent, which the renderer never computes.
 * Absent ⇒ 0 ⇒ the pre-v1.3 behaviour, so no existing frame moves. Text is
 * absent here on purpose: it measures its own block and applies the anchor
 * itself in `drawText`, because the measurement needs the font on the context.
 *
 * Exported so the browser driver's hit-testing and selection-ring math pivot
 * on exactly the same box the renderer draws on.
 */
export function anchorWidth(item: Item): number {
  if (item.type === "sprite") return item.width;
  // Video is spatially a sprite: its anchor pivots on the [width, height] box.
  if (item.type === "video") return item.width;
  if (item.type === "shape") return item.width ?? 0;
  if (item.type === "group") return item.width ?? 0;
  return 0;
}

/** Vertical half of {@link anchorWidth}. */
export function anchorHeight(item: Item): number {
  if (item.type === "sprite") return item.height;
  if (item.type === "video") return item.height;
  if (item.type === "shape") {
    // §3.2: a circle's `width` is its diameter on both axes, and `height` is
    // intentionally not authored. Fall back to width so anchorY actually
    // shifts the circle vertically.
    if (item.kind === "circle") return item.height ?? item.width ?? 0;
    return item.height ?? 0;
  }
  // A group declares each axis on its own — there is no circle-style fallback
  // to guess a missing one from.
  if (item.type === "group") return item.height ?? 0;
  return 0;
}
