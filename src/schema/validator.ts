// Semantic validator. Layered on top of the Zod parse: shape errors come back
// as E_SCHEMA; everything else here is structural / cross-reference / temporal.
//
// Rules implemented (per design-doc §3.5):
//   1. Zod parse                            → E_SCHEMA
//   2. tween.target → existing item          → E_ITEM_MISSING
//      layer.items[*] → existing item        → E_ITEM_MISSING
//      group.items[*] → existing item        → E_ITEM_MISSING
//   3. sprite.asset / text.font / video.asset → existing asset of correct
//      type → E_ASSET_MISSING
//   4. tween.property tweenable for item type → E_PROPERTY_INVALID
//      tween.from / .to value-kind matches   → E_VALUE_KIND
//      color-kind tween.from / .to parseable → E_COLOR_INVALID
//   5. Two tweens on same (target, property) overlap temporally → E_TWEEN_OVERLAP
//   6. tween.start + duration > comp.duration → W_TWEEN_TRUNCATED (warning)
//   7. Layers sorted by z — handled by the renderer, not by validation.
//   8. Cycles in group hierarchy             → E_GROUP_CYCLE
//   9. Video item trim/timing window         → E_VIDEO_RANGE
//      (0 ≤ trimIn < trimOut ≤ asset.duration; end > start)
//  10. Duplicate layer.id                    → E_DUPLICATE_LAYER_ID
//      Duplicate tween.id                    → E_DUPLICATE_TWEEN_ID
//      (tween ids are the MCP addressing key — a duplicate makes
//      update_tween/remove_tween ambiguous about which tween they touch)
//  11. Polygon shape with < 3 points          → E_POLYGON_INVALID
//
// Compose lint (§6.20, Session 26) — warnings for outcomes that are invisible
// to an agent reading the JSON but obvious once rendered:
//  12. Item permanently opacity-0 (own transform, an ancestor group's
//      transform, or its layer — whichever is static and untweened)
//                                              → W_ITEM_INVISIBLE_OPACITY
//  13. Item off-canvas for its entire lifespan → W_ITEM_OFF_CANVAS
//  14. text.font with no resolvable font asset → W_FONT_UNREGISTERED
//      (independent of / in addition to E_ASSET_MISSING — see the check's
//      own comment for why it's worth a second, warning-level signal)
//  15. Scene-instance wrapper group outliving its own content's last tween
//                                              → W_SCENE_INSTANCE_OUTLIVES
//      Video asset ref missing is already E_ASSET_MISSING (since Session 10)
//      and stays an error — not duplicated here.

import type { Composition, Item, Layer } from "./types.js";
import { getTweenable } from "./tweenable.js";
import { CompositionSchema } from "./zod.js";
import { parseColor } from "../color/index.js";

export type ValidationErrorCode =
  | "E_SCHEMA"
  | "E_ASSET_MISSING"
  | "E_ITEM_MISSING"
  | "E_PROPERTY_INVALID"
  | "E_VALUE_KIND"
  | "E_COLOR_INVALID"
  | "E_TWEEN_OVERLAP"
  | "E_GROUP_CYCLE"
  | "E_VIDEO_RANGE"
  | "E_DUPLICATE_LAYER_ID"
  | "E_DUPLICATE_TWEEN_ID"
  | "E_POLYGON_INVALID";

export type ValidationWarningCode =
  | "W_TWEEN_TRUNCATED"
  | "W_ITEM_INVISIBLE_OPACITY"
  | "W_ITEM_OFF_CANVAS"
  | "W_FONT_UNREGISTERED"
  | "W_SCENE_INSTANCE_OUTLIVES";

// 1µs — well below sub-frame tolerance at 120fps (8.3ms/frame). Absorbs
// floating-point drift from chained `start + duration` sums so back-to-back
// segments authored with non-bit-exact durations validate correctly.
// Exported so other layers doing the same "do these two windows overlap"
// comparison (e.g. the MCP store's add_tween/apply_behavior guards) share
// this exact tolerance instead of drifting from a second magic number.
export const OVERLAP_EPS = 1e-6;

export type ValidationError = {
  code: ValidationErrorCode;
  message: string;
  path?: string;
};

export type ValidationWarning = {
  code: ValidationWarningCode;
  message: string;
  path?: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
};

export function validate(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const parsed = CompositionSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        code: "E_SCHEMA",
        message: issue.message,
        path: issue.path.join("."),
      });
    }
    return { valid: false, errors, warnings };
  }

  const comp: Composition = parsed.data;
  const assetMap = new Map(comp.assets.map((a) => [a.id, a]));
  const itemIds = new Set(Object.keys(comp.items));

  validateLayerRefs(comp, itemIds, errors);
  validateItemRefs(comp, assetMap, itemIds, errors);
  validateTweens(comp, itemIds, errors, warnings);
  validateGroupCycles(comp, errors);
  validateVideoRanges(comp, assetMap, errors);
  validateDuplicateIds(comp, errors);
  validateShapes(comp, errors);

  // Compose lint (§6.20) — best-effort warnings, never errors. Each one is
  // independent of the others; a crash-worthy bug in one shouldn't blind the
  // rest, so failures here would be a regression, but they intentionally
  // don't gate `valid`.
  validateInvisibleOpacity(comp, warnings);
  validateOffCanvas(comp, warnings);
  validateFontResolution(comp, assetMap, warnings);
  validateSceneInstanceLifespans(comp, warnings);

  return { valid: errors.length === 0, errors, warnings };
}

// Layer ids are addressed directly by update_layer/remove_layer; tween ids are
// the MCP addressing key for update_tween/remove_tween. Zod only guarantees
// each id is a non-empty, "::"-free string — it can't see across array
// elements to catch duplicates, so a composition with two tweens sharing an id
// parses fine but leaves update_tween/remove_tween unable to tell which tween
// a caller means.
function validateDuplicateIds(
  comp: Composition,
  errors: ValidationError[],
): void {
  const seenLayerIds = new Set<string>();
  for (const layer of comp.layers) {
    if (seenLayerIds.has(layer.id)) {
      errors.push({
        code: "E_DUPLICATE_LAYER_ID",
        message: `Duplicate layer id "${layer.id}".`,
        path: `layers.${layer.id}`,
      });
    }
    seenLayerIds.add(layer.id);
  }

  const seenTweenIds = new Set<string>();
  for (const tween of comp.tweens) {
    if (seenTweenIds.has(tween.id)) {
      errors.push({
        code: "E_DUPLICATE_TWEEN_ID",
        message: `Duplicate tween id "${tween.id}".`,
        path: `tweens.${tween.id}`,
      });
    }
    seenTweenIds.add(tween.id);
  }
}

// A polygon shape needs at least 3 points to describe a non-degenerate
// area; Zod can only check each point is a valid [number, number] tuple, not
// that the array is long enough, since `points` is shared by every shape kind
// and only meaningful for "polygon".
function validateShapes(comp: Composition, errors: ValidationError[]): void {
  for (const [itemId, item] of Object.entries(comp.items)) {
    if (item.type !== "shape" || item.kind !== "polygon") continue;
    const count = item.points?.length ?? 0;
    if (count < 3) {
      errors.push({
        code: "E_POLYGON_INVALID",
        message: `Polygon "${itemId}" has ${count} point(s); a polygon needs at least 3.`,
        path: `items.${itemId}.points`,
      });
    }
  }
}

// ──────────────── Compose lint (§6.20) ────────────────
//
// These four checks are warnings, not errors: they flag outcomes an agent
// authoring JSON blind can't see coming but that render as silently wrong or
// silently invisible. All four are best-effort heuristics over the static
// composition graph — none of them simulate the renderer frame-by-frame.

// True when at least one tween in `comp.tweens` targets `(id, property)`.
// A tween's actual from/to values aren't inspected — the mere existence of a
// tween means the value is not a static constant, so a "permanently X" check
// can't prove its case and should not warn.
function hasTweenOn(
  comp: Composition,
  id: string,
  property: string,
): boolean {
  return comp.tweens.some((t) => t.target === id && t.property === property);
}

// Item permanently opacity-0 (W_ITEM_INVISIBLE_OPACITY). An item is
// invisible for its whole lifespan when every level that multiplies into its
// final on-screen alpha — its own `transform.opacity`, every ancestor
// group's `transform.opacity`, and its layer's `opacity` (layers have no
// tweenable properties at all, so a zero there is always static) — is 0 and
// untweened. Any one static-zero level is enough; we stop at the first one
// found walking outward from the item.
//
// Scoped to the four leaf/visual item types — a group has no pixels of its
// own, only children, so warning about a group's opacity directly (rather
// than at the visual items it affects) would just be noise.
function validateInvisibleOpacity(
  comp: Composition,
  warnings: ValidationWarning[],
): void {
  const parentOf = new Map<string, string>();
  for (const [id, item] of Object.entries(comp.items)) {
    if (item.type !== "group") continue;
    for (const childId of item.items) parentOf.set(childId, id);
  }
  const layerOf = new Map<string, Layer>();
  for (const layer of comp.layers) {
    for (const itemId of layer.items) layerOf.set(itemId, layer);
  }

  for (const [itemId, item] of Object.entries(comp.items)) {
    if (item.type === "group") continue;
    if (item.visible === false) continue;

    let culprit: { kind: "item" | "group" | "layer"; id: string } | null =
      null;

    // Walk the item itself, then each ancestor group, root-outward.
    const guard = new Set<string>();
    let node = itemId;
    let nodeItem: Item | undefined = item;
    while (nodeItem !== undefined && !guard.has(node)) {
      guard.add(node);
      if (nodeItem.transform.opacity === 0 && !hasTweenOn(comp, node, "transform.opacity")) {
        culprit = { kind: node === itemId ? "item" : "group", id: node };
        break;
      }
      const parent = parentOf.get(node);
      if (parent === undefined) break;
      node = parent;
      nodeItem = comp.items[node];
    }

    if (culprit === null) {
      const layer = layerOf.get(node);
      if (layer !== undefined && layer.opacity === 0) {
        culprit = { kind: "layer", id: layer.id };
      }
    }

    if (culprit === null) continue;

    const via =
      culprit.kind === "item"
        ? "its own transform.opacity is 0"
        : culprit.kind === "group"
          ? `it's nested under group "${culprit.id}" whose transform.opacity is 0`
          : `its layer "${culprit.id}" has opacity 0`;
    warnings.push({
      code: "W_ITEM_INVISIBLE_OPACITY",
      message: `Item "${itemId}" is invisible for its entire lifespan: ${via}, and nothing tweens it away from 0.`,
      path: `items.${itemId}.transform.opacity`,
    });
  }
}

// Item off-canvas for its whole lifespan (W_ITEM_OFF_CANVAS). Computes a
// conservative bounding region for the item's on-screen footprint across
// every value its position/size/anchor/scale/rotation could ever take (its
// static transform plus every tween's `from`/`to` on that property, taken as
// an envelope — not a frame-by-frame simulation, so easing overshoot past an
// endpoint is not modeled; that only makes the envelope *smaller* than
// reality, which only risks under-warning, never a false positive). If that
// envelope never intersects the canvas rect, the item can never be seen.
//
// Scoped to sprite/video/shape — text has no declared width/height (extent
// depends on font metrics this validator doesn't have), and groups have no
// box of their own (their children are checked individually). Also scoped to
// items that are NOT a child of any group: a group's own transform could
// reposition an off-canvas-looking child back on-canvas, and this check has
// no cheap way to compose ancestor transforms, so it stays silent there
// rather than risk a false positive.
function validateOffCanvas(
  comp: Composition,
  warnings: ValidationWarning[],
): void {
  const groupedChildren = new Set<string>();
  for (const item of Object.values(comp.items)) {
    if (item.type === "group") for (const c of item.items) groupedChildren.add(c);
  }

  const canvasW = comp.composition.width;
  const canvasH = comp.composition.height;

  for (const [itemId, item] of Object.entries(comp.items)) {
    if (item.type !== "sprite" && item.type !== "video" && item.type !== "shape") {
      continue;
    }
    if (item.visible === false) continue;
    if (groupedChildren.has(itemId)) continue;

    const box = localBoxRange(comp, itemId, item);
    if (box === null) continue;

    const sx = tweenRangeFor(comp, itemId, "transform.scaleX", item.transform.scaleX);
    const sy = tweenRangeFor(comp, itemId, "transform.scaleY", item.transform.scaleY);
    const scaledX = scaleInterval(box.xRange, sx);
    const scaledY = scaleInterval(box.yRange, sy);

    const rot = tweenRangeFor(comp, itemId, "transform.rotation", item.transform.rotation);
    const px = tweenRangeFor(comp, itemId, "transform.x", item.transform.x);
    const py = tweenRangeFor(comp, itemId, "transform.y", item.transform.y);

    let finalX: [number, number];
    let finalY: [number, number];
    if (rot[0] === 0 && rot[1] === 0) {
      // No rotation possible — exact axis-aligned envelope.
      finalX = [px[0] + scaledX[0], px[1] + scaledX[1]];
      finalY = [py[0] + scaledY[0], py[1] + scaledY[1]];
    } else {
      // Rotation could point the box any direction — bound it by the circle
      // that covers every corner regardless of angle, then sweep that circle
      // across the position range.
      const corners: Array<[number, number]> = [
        [scaledX[0], scaledY[0]],
        [scaledX[0], scaledY[1]],
        [scaledX[1], scaledY[0]],
        [scaledX[1], scaledY[1]],
      ];
      const radius = Math.max(...corners.map(([cx, cy]) => Math.hypot(cx, cy)));
      finalX = [px[0] - radius, px[1] + radius];
      finalY = [py[0] - radius, py[1] + radius];
    }

    const overlaps =
      finalX[1] >= 0 && finalX[0] <= canvasW && finalY[1] >= 0 && finalY[0] <= canvasH;
    if (overlaps) continue;

    warnings.push({
      code: "W_ITEM_OFF_CANVAS",
      message:
        `Item "${itemId}" never overlaps the ${canvasW}x${canvasH} canvas for its entire ` +
        `range of motion (x:[${finalX[0].toFixed(1)},${finalX[1].toFixed(1)}], ` +
        `y:[${finalY[0].toFixed(1)},${finalY[1].toFixed(1)}]).`,
      path: `items.${itemId}.transform`,
    });
  }
}

// [min, max] envelope of a numeric property across the item's static value
// plus every tween's `from`/`to` on that (target, property). Folding the
// static value in even when tweens exist only widens the envelope (safe
// direction); non-numeric tween ends (already flagged as E_VALUE_KIND
// elsewhere) are ignored rather than corrupting the range with NaN.
function tweenRangeFor(
  comp: Composition,
  target: string,
  property: string,
  base: number,
): [number, number] {
  let min = base;
  let max = base;
  for (const t of comp.tweens) {
    if (t.target !== target || t.property !== property) continue;
    if (typeof t.from === "number") {
      min = Math.min(min, t.from);
      max = Math.max(max, t.from);
    }
    if (typeof t.to === "number") {
      min = Math.min(min, t.to);
      max = Math.max(max, t.to);
    }
  }
  return [min, max];
}

// Product of two intervals: [a,b] * [c,d]. Handles negative scale factors
// (flips) by taking the min/max over all four corner products rather than
// assuming both intervals are already sorted low-to-high in sign.
function scaleInterval(
  range: [number, number],
  scale: [number, number],
): [number, number] {
  const [a, b] = range;
  const [c, d] = scale;
  const candidates = [a * c, a * d, b * c, b * d];
  return [Math.min(...candidates), Math.max(...candidates)];
}

// Local (pre-scale, pre-rotate, pre-translate) bounding box for an item that
// has a concrete box, in the same coordinate frame `render.ts:drawItem` uses:
// anchor-shifted but not yet scaled. `w`/`h`/anchorX/anchorY ranges fold in
// any tween on those properties the same way position/scale do elsewhere in
// this check. Polygon points are already absolute local coordinates (the
// renderer never applies the anchor shift to them — see `anchorWidth`/
// `anchorHeight` in render.ts, which return 0 for polygons that don't also
// set `width`), so they skip the anchor step entirely.
function localBoxRange(
  comp: Composition,
  itemId: string,
  item: Item,
): { xRange: [number, number]; yRange: [number, number] } | null {
  if (item.type === "shape" && item.kind === "polygon") {
    const pts = item.points ?? [];
    if (pts.length === 0) return null;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [px, py] of pts) {
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
    return { xRange: [x0, x1], yRange: [y0, y1] };
  }

  let w0: number | undefined;
  let h0: number | undefined;
  if (item.type === "sprite" || item.type === "video") {
    w0 = item.width;
    h0 = item.height;
  } else if (item.type === "shape") {
    w0 = item.width ?? 0;
    h0 = item.kind === "circle" ? (item.height ?? item.width ?? 0) : (item.height ?? 0);
  }
  if (w0 === undefined || h0 === undefined) return null;

  const [wMin, wMax] = tweenRangeFor(comp, itemId, "width", w0);
  const [hMin, hMax] = tweenRangeFor(comp, itemId, "height", h0);
  const [aXMin, aXMax] = tweenRangeFor(
    comp,
    itemId,
    "transform.anchorX",
    item.transform.anchorX,
  );
  const [aYMin, aYMax] = tweenRangeFor(
    comp,
    itemId,
    "transform.anchorY",
    item.transform.anchorY,
  );

  // Box edges (`-aX*w`, `(1-aX)*w`) are bilinear in independently-ranging aX
  // and w, so their extremes land on one of the four (aX, w) corners.
  let left = Infinity;
  let right = -Infinity;
  for (const aX of [aXMin, aXMax]) {
    for (const w of [wMin, wMax]) {
      left = Math.min(left, -aX * w);
      right = Math.max(right, (1 - aX) * w);
    }
  }
  let top = Infinity;
  let bottom = -Infinity;
  for (const aY of [aYMin, aYMax]) {
    for (const h of [hMin, hMax]) {
      top = Math.min(top, -aY * h);
      bottom = Math.max(bottom, (1 - aY) * h);
    }
  }
  return { xRange: [left, right], yRange: [top, bottom] };
}

// text.font with no resolvable font asset (W_FONT_UNREGISTERED). This is
// deliberately independent of — not a replacement for — the E_ASSET_MISSING
// error `validateItemRefs` already raises for the same condition. The reason
// it's worth a second, warning-level signal: `render.ts` resolves a text
// item's family with `assets?.getFontFamily(item.font) ?? item.font` — if
// the id never made it into the loaded AssetRegistry (including, but not
// limited to, the missing/wrong-type case E_ASSET_MISSING blocks), that
// fallback silently uses the raw id string as a CSS font-family name. Which
// system font (if any) a host resolves that string to is host-dependent, so
// any caller that renders without going through this validator first gets
// non-deterministic output instead of a loud failure.
function validateFontResolution(
  comp: Composition,
  assetMap: ReadonlyMap<string, Composition["assets"][number]>,
  warnings: ValidationWarning[],
): void {
  for (const [itemId, item] of Object.entries(comp.items)) {
    if (item.type !== "text") continue;
    const asset = assetMap.get(item.font);
    if (asset !== undefined && asset.type === "font") continue;
    warnings.push({
      code: "W_FONT_UNREGISTERED",
      message:
        `Text "${itemId}" font "${item.font}" does not resolve to a registered font asset — ` +
        "at render time this silently falls back to using the id as a literal CSS font-family, " +
        "which renders inconsistently across hosts.",
      path: `items.${itemId}.font`,
    });
  }
}

// Scene instance outliving its scene (W_SCENE_INSTANCE_OUTLIVES) — belt and
// braces after Session 8 (R-26), which bounds a scene instance's synthetic
// wrapper group's `enter`/`exit` to its own effective span by default. By the
// time a composition reaches this validator, scene instances have already
// been lowered (`expandSceneInstances`) into a plain group whose id is the
// instance id and whose children are prefixed `${instanceId}__${localId}` —
// there's no surviving marker saying "this group came from a scene", so this
// check re-derives instance-ness from that naming convention alone. It then
// compares the wrapper's own visible window against the last moment anything
// inside it actually animates: if the group stays visible well past its
// content's last tween, it's frozen on screen outliving the scene it wraps.
function validateSceneInstanceLifespans(
  comp: Composition,
  warnings: ValidationWarning[],
): void {
  for (const [groupId, item] of Object.entries(comp.items)) {
    if (item.type !== "group" || item.items.length === 0) continue;
    const prefix = `${groupId}__`;
    if (!item.items.every((childId) => childId.startsWith(prefix))) continue;

    const descendants = new Set<string>();
    const stack = [...item.items];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (descendants.has(id)) continue;
      descendants.add(id);
      const child = comp.items[id];
      if (child?.type === "group") stack.push(...child.items);
    }

    let contentEnd: number | undefined;
    for (const tween of comp.tweens) {
      if (tween.target !== groupId && !descendants.has(tween.target)) continue;
      const end = tween.start + tween.duration;
      if (contentEnd === undefined || end > contentEnd) contentEnd = end;
    }
    // Nothing animates inside (or on) the wrapper — there's no "content end"
    // to outlive, so a long/unbounded `exit` isn't a lint finding here.
    if (contentEnd === undefined) continue;

    const groupExit = item.exit ?? comp.composition.duration;
    if (groupExit - contentEnd > OVERLAP_EPS) {
      warnings.push({
        code: "W_SCENE_INSTANCE_OUTLIVES",
        message:
          `Scene instance "${groupId}" stays visible until ${groupExit}s but its content's ` +
          `last tween ends at ${contentEnd}s — it outlives its own scene by ` +
          `${(groupExit - contentEnd).toFixed(3)}s.`,
        path: `items.${groupId}.exit`,
      });
    }
  }
}

// Video temporal/trim invariants (v0.2 §S5). Zod already guarantees the simple
// bounds (`trimIn ≥ 0`, `trimOut > 0`, `start ≥ 0`, `end > 0`); the cross-field
// and cross-reference parts live here:
//   - trimIn < trimOut          — the trim window must be non-empty
//   - trimOut ≤ asset.duration  — only enforced once the source asset is
//     registered with a known duration. Video asset registration is §S6, so in
//     §S5 this is dormant (clips reference not-yet-registered assets) — exactly
//     how audio §S1 defers its asset check to §S2. It activates automatically
//     when an asset carrying a numeric `duration` is present.
//   - end > start               — the visible window must be non-empty
function validateVideoRanges(
  comp: Composition,
  assetMap: ReadonlyMap<string, Composition["assets"][number]>,
  errors: ValidationError[],
): void {
  for (const [itemId, item] of Object.entries(comp.items)) {
    if (item.type !== "video") continue;

    const trimIn = item.trimIn ?? 0;
    if (item.trimOut !== undefined && trimIn >= item.trimOut) {
      errors.push({
        code: "E_VIDEO_RANGE",
        message: `Video "${itemId}" trim window is empty: trimIn (${trimIn}) must be less than trimOut (${item.trimOut}).`,
        path: `items.${itemId}.trimOut`,
      });
    }

    if (item.trimOut !== undefined) {
      const asset = assetMap.get(item.asset) as
        | { duration?: number }
        | undefined;
      const duration = asset?.duration;
      if (typeof duration === "number" && item.trimOut > duration) {
        errors.push({
          code: "E_VIDEO_RANGE",
          message: `Video "${itemId}" trimOut (${item.trimOut}) exceeds the duration of asset "${item.asset}" (${duration}).`,
          path: `items.${itemId}.trimOut`,
        });
      }
    }

    if (item.end !== undefined && item.end <= item.start) {
      errors.push({
        code: "E_VIDEO_RANGE",
        message: `Video "${itemId}" end (${item.end}) must be greater than start (${item.start}).`,
        path: `items.${itemId}.end`,
      });
    }
  }
}

function validateLayerRefs(
  comp: Composition,
  itemIds: ReadonlySet<string>,
  errors: ValidationError[],
): void {
  for (const layer of comp.layers) {
    for (const itemId of layer.items) {
      if (!itemIds.has(itemId)) {
        errors.push({
          code: "E_ITEM_MISSING",
          message: `Layer "${layer.id}" references unknown item "${itemId}".`,
          path: `layers.${layer.id}.items`,
        });
      }
    }
  }
}

function validateItemRefs(
  comp: Composition,
  assetMap: ReadonlyMap<string, Composition["assets"][number]>,
  itemIds: ReadonlySet<string>,
  errors: ValidationError[],
): void {
  for (const [itemId, item] of Object.entries(comp.items)) {
    switch (item.type) {
      case "sprite": {
        const asset = assetMap.get(item.asset);
        if (!asset) {
          errors.push({
            code: "E_ASSET_MISSING",
            message: `Sprite "${itemId}" references unknown asset "${item.asset}".`,
            path: `items.${itemId}.asset`,
          });
        } else if (asset.type !== "image") {
          errors.push({
            code: "E_ASSET_MISSING",
            message: `Sprite "${itemId}" references asset "${item.asset}" which is type "${asset.type}", not "image".`,
            path: `items.${itemId}.asset`,
          });
        }
        break;
      }
      case "text": {
        const asset = assetMap.get(item.font);
        if (!asset) {
          errors.push({
            code: "E_ASSET_MISSING",
            message: `Text "${itemId}" references unknown font asset "${item.font}".`,
            path: `items.${itemId}.font`,
          });
        } else if (asset.type !== "font") {
          errors.push({
            code: "E_ASSET_MISSING",
            message: `Text "${itemId}" references asset "${item.font}" which is type "${asset.type}", not "font".`,
            path: `items.${itemId}.font`,
          });
        }
        break;
      }
      case "group": {
        for (const childId of item.items) {
          if (!itemIds.has(childId)) {
            errors.push({
              code: "E_ITEM_MISSING",
              message: `Group "${itemId}" references unknown child item "${childId}".`,
              path: `items.${itemId}.items`,
            });
          }
        }
        break;
      }
      case "video": {
        const asset = assetMap.get(item.asset);
        if (!asset) {
          errors.push({
            code: "E_ASSET_MISSING",
            message: `Video "${itemId}" references unknown asset "${item.asset}".`,
            path: `items.${itemId}.asset`,
          });
        } else if (asset.type !== "video") {
          errors.push({
            code: "E_ASSET_MISSING",
            message: `Video "${itemId}" references asset "${item.asset}" which is type "${asset.type}", not "video".`,
            path: `items.${itemId}.asset`,
          });
        }
        break;
      }
      case "shape":
        // No external refs.
        break;
    }
  }
}

function validateTweens(
  comp: Composition,
  itemIds: ReadonlySet<string>,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  type Bucket = Composition["tweens"];
  const overlapBuckets = new Map<string, Bucket>();

  for (const tween of comp.tweens) {
    // Truncation warning is independent of every other check.
    if (tween.start + tween.duration > comp.composition.duration) {
      warnings.push({
        code: "W_TWEEN_TRUNCATED",
        message: `Tween "${tween.id}" extends past composition end (start=${tween.start}, duration=${tween.duration}, comp.duration=${comp.composition.duration}).`,
        path: `tweens.${tween.id}`,
      });
    }

    if (!itemIds.has(tween.target)) {
      errors.push({
        code: "E_ITEM_MISSING",
        message: `Tween "${tween.id}" targets unknown item "${tween.target}".`,
        path: `tweens.${tween.id}.target`,
      });
      continue;
    }

    const item = comp.items[tween.target]!;
    const desc = getTweenable(item.type, tween.property);
    if (!desc) {
      errors.push({
        code: "E_PROPERTY_INVALID",
        message: `Property "${tween.property}" is not tweenable on ${item.type} "${tween.target}".`,
        path: `tweens.${tween.id}.property`,
      });
      continue;
    }

    const expected = desc.kind;
    const fromOk =
      expected === "number"
        ? typeof tween.from === "number"
        : typeof tween.from === "string";
    const toOk =
      expected === "number"
        ? typeof tween.to === "number"
        : typeof tween.to === "string";
    if (!fromOk || !toOk) {
      errors.push({
        code: "E_VALUE_KIND",
        message: `Tween "${tween.id}" property "${tween.property}" expects ${expected} values; got from=${typeof tween.from}, to=${typeof tween.to}.`,
        path: `tweens.${tween.id}`,
      });
      continue;
    }

    // Color-kind values pass the typeof check above, but the renderer later
    // calls parseColor() which throws on unrecognized inputs like "magenta".
    // Surface that here so authoring tools fail validation, not render.
    if (expected === "color") {
      let badEnd: "from" | "to" | null = null;
      let reason = "";
      try {
        parseColor(tween.from as string);
      } catch (e) {
        badEnd = "from";
        reason = e instanceof Error ? e.message : String(e);
      }
      if (badEnd === null) {
        try {
          parseColor(tween.to as string);
        } catch (e) {
          badEnd = "to";
          reason = e instanceof Error ? e.message : String(e);
        }
      }
      if (badEnd !== null) {
        errors.push({
          code: "E_COLOR_INVALID",
          message: `Tween "${tween.id}" ${badEnd} is not a parseable color: ${reason}`,
          path: `tweens.${tween.id}.${badEnd}`,
        });
        continue;
      }
    }

    const key = `${tween.target}::${tween.property}`;
    let bucket = overlapBuckets.get(key);
    if (!bucket) {
      bucket = [];
      overlapBuckets.set(key, bucket);
    }
    bucket.push(tween);
  }

  for (const [key, bucket] of overlapBuckets) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const curr = sorted[i]!;
      const prevEnd = prev.start + prev.duration;
      // Touching at endpoints is OK; an EPS guard absorbs IEEE-754 drift from
      // chained `start + duration` sums (e.g. 8.55 + 0.55 = 9.100000000000001).
      // EPS is 1µs — well below sub-frame tolerance even at 120fps.
      if (curr.start + OVERLAP_EPS < prevEnd) {
        errors.push({
          code: "E_TWEEN_OVERLAP",
          message: `Tweens "${prev.id}" and "${curr.id}" overlap on ${key}: [${prev.start}, ${prevEnd}] vs [${curr.start}, ${curr.start + curr.duration}].`,
          path: `tweens`,
        });
      }
    }
  }
}

function validateGroupCycles(
  comp: Composition,
  errors: ValidationError[],
): void {
  const groupChildren: Record<string, readonly string[]> = {};
  for (const [id, item] of Object.entries(comp.items)) {
    if (item.type === "group") groupChildren[id] = item.items;
  }

  const reported = new Set<string>();
  const VISITING = 1;
  const VISITED = 2;
  const state: Record<string, number> = {};
  const path: string[] = [];

  function dfs(id: string): void {
    if (state[id] === VISITED) return;
    if (state[id] === VISITING) {
      const startIdx = path.indexOf(id);
      const cycle = [...path.slice(startIdx), id];
      const canonical = canonicalCycle(cycle);
      if (!reported.has(canonical)) {
        reported.add(canonical);
        errors.push({
          code: "E_GROUP_CYCLE",
          message: `Cycle in group hierarchy: ${cycle.join(" → ")}.`,
          path: `items.${cycle[0]}`,
        });
      }
      return;
    }
    state[id] = VISITING;
    path.push(id);
    const kids = groupChildren[id];
    if (kids) {
      for (const k of kids) {
        if (groupChildren[k] !== undefined) dfs(k);
      }
    }
    path.pop();
    state[id] = VISITED;
  }

  for (const id of Object.keys(groupChildren)) dfs(id);
}

function canonicalCycle(cycle: readonly string[]): string {
  // Drop the trailing repeat, rotate to start at the lex-smallest id.
  const ring = cycle.slice(0, -1);
  let minIdx = 0;
  for (let i = 1; i < ring.length; i++) {
    if (ring[i]! < ring[minIdx]!) minIdx = i;
  }
  return [...ring.slice(minIdx), ...ring.slice(0, minIdx)].join(",");
}
