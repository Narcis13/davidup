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
    items[id] = cloneItem(item);
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
    layers: comp.layers,
    items,
  };
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

function clampForProperty(property: string, value: number | string): number | string {
  // §3.3: opacity is clamped [0,1]. Other numeric properties pass through —
  // negative scale is meaningful (mirror), out-of-canvas positions are valid.
  if (property === "transform.opacity" && typeof value === "number") {
    if (value < 0) return 0;
    if (value > 1) return 1;
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
  const dot = path.indexOf(".");
  if (dot < 0) {
    (item as Record<string, unknown>)[path] = value;
    return;
  }
  const head = path.slice(0, dot);
  const tail = path.slice(dot + 1);
  if (head === "transform") {
    (item.transform as Record<string, unknown>)[tail] = value;
    return;
  }
  // Phase 4 paths are at most one level deep, but keep a defensive fallback so
  // future tweenable additions (e.g., shadow.blur) don't silently no-op.
  const parts = path.split(".");
  let cur: Record<string, unknown> = item as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}
