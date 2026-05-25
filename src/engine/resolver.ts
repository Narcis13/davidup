// Tween resolver — pure function from (Composition, t) → ResolvedScene.
//
// Per design-doc §5.3 with the per-tween rules from §2:
//   - before the first tween's start: value = first.from
//   - inside a tween: lerp(from, to, ease(progress))
//   - after a tween's end (no later tween covers t): hold at to
//   - between two tweens on the same property: hold at the most recent tween's `to`
//   - if no tween addresses the property: base value from the item
//
// Tween index is precomputable (per §5.7) and reusable across frames.

import { lerpColorString, lerpNumber } from "../color/index.js";
import { getEasing } from "../easings/index.js";
import { getTweenable, type TweenValueKind } from "../schema/tweenable.js";
import type { Composition, Item, Layer, Tween } from "../schema/types.js";

export interface ResolvedScene {
  composition: Composition["composition"];
  layers: ReadonlyArray<Layer>;
  items: Record<string, Item>;
}

export interface TweenIndex {
  // Bucket key is `${target}::${property}` — collisions are impossible because
  // both halves come from string ids that the schema forbids from containing "::".
  buckets: ReadonlyMap<string, ReadonlyArray<Tween>>;
}

export function indexTweens(comp: Composition): TweenIndex {
  const buckets = new Map<string, Tween[]>();
  for (const tween of comp.tweens) {
    const key = makeKey(tween.target, tween.property);
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(tween);
  }
  for (const arr of buckets.values()) arr.sort((a, b) => a.start - b.start);
  return { buckets };
}

export function computeStateAt(
  comp: Composition,
  t: number,
  index?: TweenIndex,
): ResolvedScene {
  const idx = index ?? indexTweens(comp);

  const items: Record<string, Item> = {};
  for (const [id, item] of Object.entries(comp.items)) {
    const cloned = cloneItem(item);
    if (!isWithinLifespan(cloned, t)) {
      (cloned as { visible?: boolean }).visible = false;
    }
    items[id] = cloned;
  }

  // Layers carry the same optional lifespan window. We only need to clone a
  // layer if its lifespan flips it off at `t` — otherwise pass the original
  // reference through (cheaper, matches prior behavior).
  let layers: ReadonlyArray<Layer> = comp.layers;
  const layerOverrides = new Map<number, Layer>();
  for (let i = 0; i < comp.layers.length; i++) {
    const layer = comp.layers[i]!;
    if (!isWithinLifespan(layer, t)) {
      layerOverrides.set(i, { ...layer, visible: false });
    }
  }
  if (layerOverrides.size > 0) {
    layers = comp.layers.map((l, i) => layerOverrides.get(i) ?? l);
  }

  for (const [key, bucket] of idx.buckets) {
    const sep = key.indexOf("::");
    const targetId = key.slice(0, sep);
    const property = key.slice(sep + 2);
    const item = items[targetId];
    if (!item) continue;
    const desc = getTweenable(item.type, property);
    if (!desc) continue;
    const value = resolveValue(bucket, t, desc.kind);
    if (value === undefined) continue;
    setByPath(item, property, clampForProperty(property, value));
  }

  return {
    composition: comp.composition,
    layers,
    items,
  };
}

// Half-open `[enter, exit)` window — matches the scene-clip `[fromTime,
// toTime)` precedent so an item that exits at t=2.5 has rendered its last
// frame at t < 2.5. Either bound omitted disables that side of the window.
function isWithinLifespan(
  it: { enter?: number | undefined; exit?: number | undefined },
  t: number,
): boolean {
  if (it.enter !== undefined && t < it.enter) return false;
  if (it.exit !== undefined && t >= it.exit) return false;
  return true;
}

// Polymorphic lerp dispatching on value kind. Exposed because some callers
// (e.g., MCP preview) want to interrogate intermediate values too.
export function lerp(from: number, to: number, t: number, kind: "number"): number;
export function lerp(from: string, to: string, t: number, kind: "color"): string;
export function lerp(
  from: number | string,
  to: number | string,
  t: number,
  kind: TweenValueKind,
): number | string {
  return kind === "number"
    ? lerpNumber(from as number, to as number, t)
    : lerpColorString(from as string, to as string, t);
}

function makeKey(target: string, property: string): string {
  return `${target}::${property}`;
}

function resolveValue(
  bucket: ReadonlyArray<Tween>,
  t: number,
  kind: TweenValueKind,
): number | string | undefined {
  const first = bucket[0];
  if (!first) return undefined;
  if (t < first.start) return first.from;

  let active: Tween = first;
  for (let i = 1; i < bucket.length; i++) {
    const tw = bucket[i];
    if (!tw) break;
    if (tw.start <= t) active = tw;
    else break;
  }

  const end = active.start + active.duration;
  if (t >= end) return active.to;

  const progress = (t - active.start) / active.duration;
  const eased = getEasing(active.easing)(progress);
  if (kind === "number") {
    return lerpNumber(active.from as number, active.to as number, eased);
  }
  return lerpColorString(active.from as string, active.to as string, eased);
}

// Properties whose negative values would crash some Canvas2D hosts
// (e.g. `arc(r, r, -5, ...)` from `easeOutBack` overshooting past `to: 0`)
// or are semantically nonsensical. Negative scale is meaningful (mirror) and
// out-of-canvas positions are valid — those are NOT clamped here.
const NON_NEGATIVE_PROPS: ReadonlySet<string> = new Set([
  "width",
  "height",
  "fontSize",
  "strokeWidth",
  "cornerRadius",
]);

function clampForProperty(property: string, value: number | string): number | string {
  if (typeof value === "number") {
    // §3.3: opacity is clamped [0,1].
    if (property === "transform.opacity") {
      if (value < 0) return 0;
      if (value > 1) return 1;
    } else if (NON_NEGATIVE_PROPS.has(property) && value < 0) {
      return 0;
    }
  }
  return value;
}

function cloneItem(item: Item): Item {
  // Shallow clone with a fresh transform. Tweenable surface in v0.1 is
  // transform.* + a few flat numeric/color props on the item itself, none of
  // which are deeply nested, so this is sufficient. Group.items and
  // shape.points are aliased — neither is mutated by the resolver.
  switch (item.type) {
    case "sprite":
      return { ...item, transform: { ...item.transform } };
    case "text":
      return { ...item, transform: { ...item.transform } };
    case "shape":
      return { ...item, transform: { ...item.transform } };
    case "group":
      return { ...item, transform: { ...item.transform } };
  }
}

function setByPath(item: Item, path: string, value: number | string): void {
  // Every tweenable today is either a flat item property (`width`, `fontSize`,
  // `tint`, …) or lives directly under `transform.*` — see schema/tweenable.ts.
  // Anything else means a tweenable was added without updating this writer.
  const dot = path.indexOf(".");
  if (dot < 0) {
    (item as Record<string, unknown>)[path] = value;
    return;
  }
  if (path.slice(0, dot) === "transform") {
    (item.transform as Record<string, unknown>)[path.slice(dot + 1)] = value;
    return;
  }
  throw new Error(`resolver.setByPath: unsupported tweenable path "${path}"`);
}
