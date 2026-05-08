// Semantic validator. Layered on top of the Zod parse: shape errors come back
// as E_SCHEMA; everything else here is structural / cross-reference / temporal.
//
// Rules implemented (per design-doc §3.5):
//   1. Zod parse                            → E_SCHEMA
//   2. tween.target → existing item          → E_ITEM_MISSING
//      layer.items[*] → existing item        → E_ITEM_MISSING
//      group.items[*] → existing item        → E_ITEM_MISSING
//   3. sprite.asset / text.font → existing asset of correct type → E_ASSET_MISSING
//   4. tween.property tweenable for item type → E_PROPERTY_INVALID
//      tween.from / .to value-kind matches   → E_VALUE_KIND
//   5. Two tweens on same (target, property) overlap temporally → E_TWEEN_OVERLAP
//   6. tween.start + duration > comp.duration → W_TWEEN_TRUNCATED (warning)
//   7. Layers sorted by z — handled by the renderer, not by validation.
//   8. Cycles in group hierarchy             → E_GROUP_CYCLE

import type { Composition } from "./types.js";
import { getTweenable } from "./tweenable.js";
import { CompositionSchema } from "./zod.js";

export type ValidationErrorCode =
  | "E_SCHEMA"
  | "E_ASSET_MISSING"
  | "E_ITEM_MISSING"
  | "E_PROPERTY_INVALID"
  | "E_VALUE_KIND"
  | "E_TWEEN_OVERLAP"
  | "E_GROUP_CYCLE";

export type ValidationWarningCode = "W_TWEEN_TRUNCATED";

// 1µs — well below sub-frame tolerance at 120fps (8.3ms/frame). Absorbs
// floating-point drift from chained `start + duration` sums so back-to-back
// segments authored with non-bit-exact durations validate correctly.
const OVERLAP_EPS = 1e-6;

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

  return { valid: errors.length === 0, errors, warnings };
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
