// Map of tweenable property paths per item type, with the value kind expected.
// Source: design-doc §3.3.

import type { EffectType, Item, ItemType } from "./types.js";

export type TweenValueKind = "number" | "color";

export type PropertyDescriptor = {
  path: string;
  kind: TweenValueKind;
};

const COMMON_TRANSFORM: PropertyDescriptor[] = [
  { path: "transform.x", kind: "number" },
  { path: "transform.y", kind: "number" },
  { path: "transform.scaleX", kind: "number" },
  { path: "transform.scaleY", kind: "number" },
  { path: "transform.rotation", kind: "number" },
  { path: "transform.opacity", kind: "number" },
  { path: "transform.anchorX", kind: "number" },
  { path: "transform.anchorY", kind: "number" },
];

const SPRITE_PROPS: PropertyDescriptor[] = [
  ...COMMON_TRANSFORM,
  { path: "width", kind: "number" },
  { path: "height", kind: "number" },
  { path: "tint", kind: "color" },
];

const TEXT_PROPS: PropertyDescriptor[] = [
  ...COMMON_TRANSFORM,
  { path: "fontSize", kind: "number" },
  { path: "color", kind: "color" },
  { path: "letterSpacing", kind: "number" },
  { path: "lineHeight", kind: "number" },
  { path: "strokeWidth", kind: "number" },
];

const SHAPE_PROPS: PropertyDescriptor[] = [
  ...COMMON_TRANSFORM,
  { path: "width", kind: "number" },
  { path: "height", kind: "number" },
  { path: "fillColor", kind: "color" },
  { path: "strokeColor", kind: "color" },
  { path: "strokeWidth", kind: "number" },
  { path: "cornerRadius", kind: "number" },
];

const GROUP_PROPS: PropertyDescriptor[] = [...COMMON_TRANSFORM];

// Video is spatially a sprite, so it tweens the same way (transform.* + the
// width/height box) — but it has no `tint`. Render-time drawing lands in S8;
// the tweenable surface is declared here so tweens validate from S5 on.
const VIDEO_PROPS: PropertyDescriptor[] = [
  ...COMMON_TRANSFORM,
  { path: "width", kind: "number" },
  { path: "height", kind: "number" },
];

const TABLE: Record<ItemType, ReadonlyMap<string, PropertyDescriptor>> = {
  sprite: indexBy(SPRITE_PROPS),
  text: indexBy(TEXT_PROPS),
  shape: indexBy(SHAPE_PROPS),
  group: indexBy(GROUP_PROPS),
  video: indexBy(VIDEO_PROPS),
};

function indexBy(
  descriptors: readonly PropertyDescriptor[],
): ReadonlyMap<string, PropertyDescriptor> {
  const map = new Map<string, PropertyDescriptor>();
  for (const d of descriptors) map.set(d.path, d);
  return map;
}

// Effect parameters (v1.1 S21) tween as `effects.<index>.<field>`, on any
// item type. `path` here is the field name within one effect.
export const EFFECT_TWEENABLE: Record<EffectType, readonly PropertyDescriptor[]> = {
  blur: [{ path: "radius", kind: "number" }],
  shadow: [
    { path: "color", kind: "color" },
    { path: "blur", kind: "number" },
    { path: "offsetX", kind: "number" },
    { path: "offsetY", kind: "number" },
  ],
  glow: [
    { path: "color", kind: "color" },
    { path: "radius", kind: "number" },
  ],
};

// Field → kind across every effect type. A field name never changes kind
// between effect types, so the item-agnostic lookup can answer from this.
const EFFECT_FIELD_KINDS: ReadonlyMap<string, TweenValueKind> = new Map(
  Object.values(EFFECT_TWEENABLE).flatMap((ds) => ds.map((d) => [d.path, d.kind] as const)),
);

const EFFECT_PATH = /^effects\.(0|[1-9]\d*)\.([A-Za-z]+)$/;

/** Split `effects.<index>.<field>` into its parts, or undefined for any other path. */
export function parseEffectPath(path: string): { index: number; field: string } | undefined {
  const m = EFFECT_PATH.exec(path);
  if (!m) return undefined;
  return { index: Number(m[1]), field: m[2]! };
}

/**
 * Tweenable descriptor for `path` on an item of `type`. Knows only the type,
 * so an `effects.<i>.<field>` path is accepted whenever *some* effect type has
 * that field — use {@link getItemTweenable} when the item itself is at hand.
 */
export function getTweenable(
  type: ItemType,
  path: string,
): PropertyDescriptor | undefined {
  const fixed = TABLE[type].get(path);
  if (fixed) return fixed;
  const fx = parseEffectPath(path);
  if (!fx) return undefined;
  const kind = EFFECT_FIELD_KINDS.get(fx.field);
  return kind === undefined ? undefined : { path, kind };
}

/**
 * Like {@link getTweenable}, but an effect path must also name an effect the
 * item actually has, and a field that effect's type carries (`effects.0.radius`
 * is valid on a blur, not on a shadow).
 */
export function getItemTweenable(
  item: Item,
  path: string,
): PropertyDescriptor | undefined {
  const fx = parseEffectPath(path);
  if (!fx) return TABLE[item.type].get(path);
  const effect = item.effects?.[fx.index];
  if (!effect) return undefined;
  const d = EFFECT_TWEENABLE[effect.type].find((e) => e.path === fx.field);
  return d ? { path, kind: d.kind } : undefined;
}

export function listTweenable(type: ItemType): readonly PropertyDescriptor[] {
  return Array.from(TABLE[type].values());
}
