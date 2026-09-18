// Single-parent invariant (B-3). Every item has exactly one parent: a layer
// (`layer.items`) or a group (`group.items`). The renderer walks layers →
// items → group children, so an id listed under two parents paints twice.
//
// Scene and template expansion emit a *set* of items and hand some of them to
// a parent (the scene's synthetic wrapper group, the template's layer). Only
// the definition's top-level items may go there — an item owned by a group
// inside the same definition is already drawn through that group.

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `order` minus every id that some `type: "group"` item in `items` lists as a
 * child, keeping `order`'s sequence. Pure and prefix-agnostic: callers pass an
 * already-prefixed map and ids in the same namespace.
 */
export function topLevelIds(items: Record<string, unknown>, order: string[]): string[] {
  const owned = new Set<string>();
  for (const item of Object.values(items)) {
    if (!isPlainObject(item) || item.type !== "group" || !Array.isArray(item.items)) continue;
    for (const child of item.items) {
      if (typeof child === "string") owned.add(child);
    }
  }
  if (owned.size === 0) return order;
  return order.filter((id) => !owned.has(id));
}
