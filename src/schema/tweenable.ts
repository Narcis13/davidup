// Map of tweenable property paths per item type, with the value kind expected.
// Source: design-doc §3.3.

import type { ItemType } from "./types.js";

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

const TABLE: Record<ItemType, ReadonlyMap<string, PropertyDescriptor>> = {
  sprite: indexBy(SPRITE_PROPS),
  text: indexBy(TEXT_PROPS),
  shape: indexBy(SHAPE_PROPS),
  group: indexBy(GROUP_PROPS),
};

function indexBy(
  descriptors: readonly PropertyDescriptor[],
): ReadonlyMap<string, PropertyDescriptor> {
  const map = new Map<string, PropertyDescriptor>();
  for (const d of descriptors) map.set(d.path, d);
  return map;
}

export function getTweenable(
  type: ItemType,
  path: string,
): PropertyDescriptor | undefined {
  return TABLE[type].get(path);
}

export function listTweenable(type: ItemType): readonly PropertyDescriptor[] {
  return Array.from(TABLE[type].values());
}
