// Schema defaults → resolved composition (v1.3 Session G2, B-6).
//
// A few item fields carry a Zod `.default()` (today `video.fit` = "contain"
// and `video.loop` = false). `z.infer` — and therefore `Composition` and every
// engine reader — sees the *output* type, where those fields are required, but
// nothing in the pipeline ever produced them: `validate()` throws away
// `parsed.data` (it only reports issues) and `precompile()` hands the authored
// object straight to the renderer. So a hand-written video item without `fit`
// type-checks everywhere and then crashes in `drawVideo`
// (`computeFitRects(undefined, …)` → `undefined is not an object`). MCP
// `add_video` always writes both fields, which is why only hand-authored /
// `$ref`-imported JSON hit it.
//
// This pass closes the gap for the whole class: it fills every declared
// `.default()` on every item, reading the defaults out of the schema itself so
// a future `.default()` cannot drift away from the pass (tests/schema/
// defaults.test.ts walks the schema tree and fails if one lands somewhere this
// pass doesn't look).
//
// Why not simply return `CompositionSchema.parse(comp)` from `precompile` —
// the obvious "fills everything" fix:
//
//   - A strict parse *drops* `$…` / `x-…` extension keys (see strict.ts), and
//     `precompile`'s output is not a throwaway: the editor writes it back over
//     the user's composition.json, and MCP `replace_composition` stores it. A
//     parse would silently delete `$comment` / `x-author` from authored files.
//   - `precompile` runs before validation and must stay total: it accepts any
//     shape and lets `validate()` report E_SCHEMA with paths and "did you
//     mean" hints. A parse there would either throw on invalid input or need
//     a silent fallback that re-parses the whole document on every compile.
//
// Filling defaults in place keeps both properties: unknown keys survive
// untouched, invalid documents pass through unchanged, and the object identity
// is preserved (structural sharing) when there is nothing to fill — so the
// canonical-input short-circuit `precompile` advertises still holds.

import { z } from "zod";

import { ItemSchema } from "./zod.js";

/** Per-item-type factories for each field that declares a schema default. */
export type DefaultFactories = Readonly<Record<string, () => unknown>>;

/**
 * `item.type` → the defaulted fields of that variant, as factories so an
 * object-valued default is never shared between two items.
 *
 * Derived from `ItemSchema` at module load: every top-level field of a union
 * member whose schema is a `ZodDefault`. Types with no defaults are absent, so
 * {@link applySchemaDefaults} does no work for them.
 */
export const ITEM_DEFAULTS: ReadonlyMap<string, DefaultFactories> = collectItemDefaults();

function collectItemDefaults(): Map<string, DefaultFactories> {
  const out = new Map<string, DefaultFactories>();
  for (const option of ItemSchema.options) {
    const shape = option.shape as Record<string, z.ZodTypeAny>;
    // Same `_def` probing as defaultFactory, for the same cross-instance
    // reason — never `instanceof z.ZodLiteral`.
    const literal = (shape.type as { _def?: { typeName?: string; value?: unknown } })?._def;
    if (literal?.typeName !== "ZodLiteral") continue;
    const typeName = literal.value;
    if (typeof typeName !== "string") continue;
    const factories: Record<string, () => unknown> = {};
    for (const [key, schema] of Object.entries(shape)) {
      const factory = defaultFactory(schema);
      if (factory !== undefined) factories[key] = factory;
    }
    if (Object.keys(factories).length > 0) out.set(typeName, factories);
  }
  return out;
}

/**
 * The `.default()` thunk of `schema`, or undefined when it declares none.
 *
 * `instanceof z.ZodDefault` is deliberately not used: the schema objects can
 * come from a different zod module instance than this file's (bundled dist vs
 * the editor's copy), and `_def.typeName` is stable across both.
 *
 * Zod stores a literal default as `() => value` — every parse hands out the
 * *same* object. The returned factory clones non-primitive values so two items
 * given the same default never share (and later tween) one object.
 */
export function defaultFactory(schema: z.ZodTypeAny): (() => unknown) | undefined {
  const def = (schema as { _def?: { typeName?: string; defaultValue?: () => unknown } })._def;
  if (def?.typeName !== "ZodDefault" || typeof def.defaultValue !== "function") {
    return undefined;
  }
  const thunk = def.defaultValue.bind(def);
  return () => {
    const value = thunk();
    return typeof value === "object" && value !== null ? structuredClone(value) : value;
  };
}

/**
 * Fill every declared schema default that the document leaves out, returning
 * the same reference when there is nothing to fill.
 *
 * Applied at the end of the `precompile` pipeline so the renderer, the video
 * extractor and `compose/videoAudio` all see the output shape their types
 * promise. Non-composition input (scalars, arrays, a document without
 * `items`) passes through untouched — this runs before validation.
 */
export function applySchemaDefaults(comp: unknown): unknown {
  if (!isPlainObject(comp)) return comp;
  const items = comp.items;
  if (!isPlainObject(items)) return comp;

  let filledItems: Record<string, unknown> | undefined;
  for (const [id, item] of Object.entries(items)) {
    const filled = fillItem(item);
    if (filled === item) continue;
    filledItems ??= { ...items };
    filledItems[id] = filled;
  }
  return filledItems === undefined ? comp : { ...comp, items: filledItems };
}

/** The item with its missing defaults added, or the same reference. */
function fillItem(item: unknown): unknown {
  if (!isPlainObject(item)) return item;
  if (typeof item.type !== "string") return item;
  const factories = ITEM_DEFAULTS.get(item.type);
  if (factories === undefined) return item;

  let out: Record<string, unknown> | undefined;
  for (const [key, make] of Object.entries(factories)) {
    // Zod applies a default to a missing key *and* to an explicit
    // `undefined`; match that so both shapes reach the engine identically.
    if (item[key] !== undefined) continue;
    out ??= { ...item };
    out[key] = make();
  }
  return out ?? item;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
