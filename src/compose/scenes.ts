// Scene registry and expansion — primitive P4/P5 from
// COMPOSITION_PRIMITIVES.md §8. A *scene* is a self-contained mini-composition
// with its own duration, items, tweens, assets and params. A *scene instance*
// places one in a parent timeline and, at compile time, is lowered into a
// synthetic group + namespaced inner items + time-shifted tweens.
//
// Two callers exercise this module:
//
//   - `add_scene_instance` (MCP tool, §8.9) — expand a single instance into
//     concrete items + tweens which the caller appends to its store.
//   - `expandSceneInstances` (compile pass, §10) — walk an authored
//     composition, find every `items[*]` whose `type === "scene"`, replace it
//     with the synthetic group and namespaced descendants, append shifted
//     tweens, merge assets, rewire layer references.
//
// Both go through `expandSceneInstance` so the param-substitution + id
// rewriting + time-shifting + asset-merging rules live in one place.
//
// IDs (§8.4): every item id from the scene definition is prefixed by the
// instance id at expansion time (`title` → `intro__title`). Tween targets
// pointing at scene-local items are rewritten the same way; parent-authored
// tweens may only target the instance id (the synthetic group), not
// scene-internal ids — that's the §8.7 sealed-instance principle, enforced
// here as `E_SCENE_INSTANCE_DEEP_TARGET`.
//
// Time mapping (§8.5): four modes are now supported.
//
//   - `identity` (default): scene-local `t=0` plays at `instance.start`. Every
//     scene tween is shifted by `instance.start`. Effective span =
//     `scene.duration`.
//
//   - `clip { fromTime, toTime }`: trim playback to the half-open scene-local
//     window `[fromTime, toTime)`. Tweens entirely outside the window are
//     dropped. Tweens fully inside are shifted by
//     `(instance.start - fromTime)`. Boundary-crossing tweens throw
//     `E_TIME_MAPPING_TWEEN_SPLIT` — the author must shape the scene so its
//     tweens don't straddle the clip edges. Effective span =
//     `toTime - fromTime`.
//
//   - `loop { count }`: play the scene N times back-to-back. Each iteration
//     gets a deterministic id suffix (`__loop${i}`) so the canonical output
//     never collides on tween ids. Items are shared across iterations — the
//     scene's items live once in the canonical store and the tween copies
//     drive them through each pass. Effective span = `scene.duration * count`.
//     Tween starts use `instanceStart + i * scene.duration + localStart` so
//     drift across iterations is bounded by a single multiply rather than
//     accumulating with sequential adds.
//
//   - `timeScale { scale }`: play the scene at `scale×` speed (scale ∈ ℝ+).
//     Each tween's local `start` and `duration` are divided by `scale`.
//     Easing curves are preserved (the curve compresses/stretches with the
//     tween). Effective span = `scene.duration / scale`.
//
// `reverse` is still deferred — would require flipping `from` ↔ `to` per
// tween and re-sorting them, which interacts awkwardly with sealed-instance
// parent tweens.
//
// Assets: scene-declared assets are merged into the root `assets` array at
// expansion time. Same id + same src = dedupe. Same id + different src =
// `E_ASSET_CONFLICT`.

import { MCPToolError } from "../mcp/errors.js";
import type { Asset } from "../schema/types.js";
import { substitute, type SubstitutionContext } from "./params.js";

// ──────────────── Public types ────────────────

export type SceneParamType = "number" | "string" | "color" | "boolean";

export interface SceneParamDescriptor {
  name: string;
  type: SceneParamType;
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface SceneSize {
  width: number;
  height: number;
}

export interface SceneDefinition {
  id: string;
  description?: string;
  /** Scene-local timeline length in seconds. */
  duration: number;
  /** Informational; used for anchor fallback / future per-scene editor canvas. */
  size?: SceneSize;
  /** Hex string or `"transparent"`. Painted as a full-bleed rect at the bottom of the synthetic group. */
  background?: string;
  params: SceneParamDescriptor[];
  /** Scene-local assets, merged into root assets at compile time. */
  assets: Asset[];
  /** Map of scene-local item id → raw item with substitution placeholders. */
  items: Record<string, unknown>;
  /** Scene-local tweens (start values relative to the scene's t=0). May contain `$behavior` entries. */
  tweens: unknown[];
}

export interface SceneDescriptor {
  id: string;
  description?: string;
  duration: number;
  size?: SceneSize;
  background?: string;
  params: SceneParamDescriptor[];
  /** Local item ids the scene emits, sorted for stable discovery output. */
  emits: string[];
  /** Asset ids declared on the scene. */
  assets: string[];
}

/**
 * Time-mapping spec attached to a scene instance. Drives how the scene's own
 * tweens are time-shifted into the parent timeline. See file header for
 * per-mode semantics.
 */
export type TimeMapping =
  | { mode: "identity" }
  | { mode: "clip"; fromTime: number; toTime: number }
  | { mode: "loop"; count: number }
  | { mode: "timeScale"; scale: number };

export interface SceneInstance {
  /** Scene name (matches a `SceneDefinition.id`). */
  scene: string;
  /** Param values keyed by descriptor name. */
  params?: Record<string, unknown>;
  /** Global timeline offset for the instance. Defaults to 0. */
  start?: number;
  /** Layer that should host the synthetic group wrapper. */
  layerId?: string;
  /** Optional explicit transform for the wrapper group. */
  transform?: Record<string, unknown>;
  /** Time-mapping spec. Defaults to identity when absent. */
  time?: TimeMapping;
}

export interface ExpandedScene {
  /** The synthetic group wrapper (under the instance id). */
  groupItem: Record<string, unknown>;
  /** Map of post-prefix item id → expanded item. Includes any background rect. */
  items: Record<string, unknown>;
  /** Tween entries with adjusted `start`/`target`/`id`. May still contain `$behavior`. */
  tweens: unknown[];
  /** Asset entries this scene contributes to the root composition. */
  assets: Asset[];
  /** Ordered list of scene-internal item ids (prefixed) — used for sealed-instance checks. */
  internalIds: string[];
}

// ──────────────── Registry ────────────────

const REGISTRY = new Map<string, SceneDefinition>();

/** Add a scene to the global registry. Last write wins for the same id. */
export function registerScene(def: SceneDefinition): void {
  if (typeof def.id !== "string" || def.id.length === 0) {
    throw new Error("registerScene: definition is missing a non-empty id.");
  }
  REGISTRY.set(def.id, def);
}

export function hasScene(id: string): boolean {
  return REGISTRY.has(id);
}

export function getSceneDefinition(id: string): SceneDefinition | undefined {
  return REGISTRY.get(id);
}

export function unregisterScene(id: string): boolean {
  return REGISTRY.delete(id);
}

export function listScenes(): SceneDescriptor[] {
  return Array.from(REGISTRY.values()).map(toDescriptor);
}

// ──────────────── Single-instance expansion ────────────────

export interface ExpandSceneOptions {
  /** Per-composition `scenes` block; takes precedence over the global registry. */
  scenes?: Record<string, SceneDefinition>;
  /** Recursion guard — internal use; populated by the compile pass. */
  chain?: ReadonlyArray<string>;
}

/**
 * Expand one scene instance to its synthetic group, prefixed inner items,
 * shifted tweens, and merged assets.
 *
 * Lookup order: `options.scenes` (per-composition block) takes precedence over
 * the global registry, so a composition can override a registered scene by
 * name. Recursion across the lookup chain is rejected with `E_SCENE_RECURSION`.
 */
export function expandSceneInstance(
  instanceId: string,
  instance: SceneInstance,
  options: ExpandSceneOptions = {},
): ExpandedScene {
  if (typeof instanceId !== "string" || instanceId.length === 0) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      "Scene instance must be expanded under a non-empty id.",
    );
  }
  const def =
    (options.scenes !== undefined && options.scenes[instance.scene]) ||
    REGISTRY.get(instance.scene);
  if (!def) {
    throw new MCPToolError(
      "E_SCENE_UNKNOWN",
      `Unknown scene "${instance.scene}".`,
      "Call list_scenes to see available names.",
    );
  }
  const chain = options.chain ?? [];
  if (chain.includes(def.id)) {
    throw new MCPToolError(
      "E_SCENE_RECURSION",
      `Scene "${def.id}" recurses through ${[...chain, def.id].join(" -> ")}.`,
      "Scenes must form a DAG; remove the cycle or factor out the shared content as a template.",
    );
  }

  const start = instance.start ?? 0;
  if (typeof start !== "number" || !Number.isFinite(start) || start < 0) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Scene instance "${instanceId}" requires a non-negative numeric start.`,
    );
  }

  const params = resolveParams(def, instance);
  const ctx: SubstitutionContext = {
    params,
    meta: { start, duration: def.duration },
  };
  const localIds = new Set(Object.keys(def.items));

  // 1. Build inner items (prefix ids; substitute params; rewire group children).
  //    Recurse into nested scene instances so `expandSceneInstances` can stay
  //    a shallow walk — nested instances get fully lowered here.
  const items: Record<string, unknown> = {};
  const internalIds: string[] = [];
  const childExpansions: ExpandedScene[] = [];
  const innerScenesOptions: ExpandSceneOptions = {
    chain: [...chain, def.id],
    ...(options.scenes !== undefined ? { scenes: options.scenes } : {}),
  };
  for (const localId of Object.keys(def.items).sort()) {
    const itemRaw = def.items[localId];
    const substituted = substitute(itemRaw, ctx, `scenes.${def.id}.items.${localId}`);
    const prefixedId = `${instanceId}__${localId}`;
    if (isSceneInstance(substituted)) {
      const nestedInstance = readSceneInstanceFromItem(prefixedId, substituted);
      // Nested scenes inherit the parent instance's timeline offset because their
      // `start` is scene-local — the outer shift below applies to them via
      // tween shifting, not item-level transforms. The nested instance is
      // expanded at start=0 relative to its own scene; we shift its tweens by
      // the *parent* scene's start later when we shift everything. To keep
      // shifting linear, expand the nested scene with `start = 0` here, then
      // shift its tweens together with this scene's tweens at the bottom.
      nestedInstance.start = nestedInstance.start ?? 0;
      const expandedChild = expandSceneInstance(
        prefixedId,
        nestedInstance,
        innerScenesOptions,
      );
      childExpansions.push(expandedChild);
      // The synthetic group wrapper for the nested instance becomes this
      // scene's item under the prefixed id.
      items[prefixedId] = expandedChild.groupItem;
      internalIds.push(prefixedId);
      for (const innerId of Object.keys(expandedChild.items)) {
        if (innerId in items) {
          throw new MCPToolError(
            "E_DUPLICATE_ID",
            `Scene "${def.id}" instance "${instanceId}" produced duplicated nested id "${innerId}".`,
          );
        }
        items[innerId] = expandedChild.items[innerId];
        internalIds.push(innerId);
      }
    } else {
      const rewritten = rewriteItemRefs(substituted, instanceId, localIds);
      items[prefixedId] = rewritten;
      internalIds.push(prefixedId);
    }
  }

  // 2. Optional background rect — first child of the synthetic group, rendered
  //    behind all scene contents (§8.4 step 5). Skip when transparent / unset.
  let bgChildId: string | undefined;
  const bgColor = def.background ?? "transparent";
  if (bgColor !== "transparent" && def.size !== undefined) {
    bgChildId = `${instanceId}__$bg`;
    const bgItem: Record<string, unknown> = {
      type: "shape",
      kind: "rect",
      width: def.size.width,
      height: def.size.height,
      fillColor: bgColor,
      transform: {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0,
        anchorY: 0,
        opacity: 1,
      },
    };
    items[bgChildId] = bgItem;
    internalIds.push(bgChildId);
  }

  // 3. Build the synthetic group wrapper. Its item list contains the prefixed
  //    *direct* children of the scene (top-level scene items) — nested-scene-
  //    expanded items are owned by their wrapper group, not by us.
  const groupChildren: string[] = [];
  if (bgChildId !== undefined) groupChildren.push(bgChildId);
  for (const localId of Object.keys(def.items).sort()) {
    groupChildren.push(`${instanceId}__${localId}`);
  }
  const groupItem: Record<string, unknown> = {
    type: "group",
    items: groupChildren,
    transform: normalizeTransform(instance.transform),
  };

  // 4. Tweens: this scene's own tweens, plus child expansions' tweens. The
  //    time-mapping spec (identity/clip/loop/timeScale) determines how each
  //    scene-local tween gets shifted, scaled, dropped, or replicated. The
  //    spec is validated against `def.duration` once up front so per-tween
  //    code only deals with already-sane numbers.
  const timeMapping = validateTimeMapping(
    instance.time ?? { mode: "identity" },
    def.id,
    def.duration,
  );

  // First pass: lower every scene-local tween into a target/start/id pair
  // expressed in *scene-local* time (start of scene = t=0). Time-mapping is
  // applied uniformly to both own and nested-child tweens afterwards.
  const localTweens: Array<Record<string, unknown>> = [];
  for (let i = 0; i < def.tweens.length; i += 1) {
    const tweenRaw = def.tweens[i];
    if (!isPlainObject(tweenRaw)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Scene "${def.id}" tween at index ${i} must be an object.`,
      );
    }
    const path = `scenes.${def.id}.tweens[${i}]`;
    const substituted = substitute(tweenRaw, ctx, path) as Record<string, unknown>;
    localTweens.push(
      rewriteTween(substituted, instanceId, def.id, localIds, 0, i),
    );
  }
  // Nested scene tweens already carry prefixed targets and ids; their `start`
  // is in *nested-scene-local* time (we expanded the nested instance with
  // start=0). They are therefore at this scene's local time too, ready for
  // time-mapping.
  for (const child of childExpansions) {
    for (const t of child.tweens) {
      if (isPlainObject(t)) localTweens.push({ ...t });
      else {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          `Nested scene expansion produced a non-object tween in scene "${def.id}".`,
        );
      }
    }
  }

  const ownTweens = applyTimeMapping(
    localTweens,
    timeMapping,
    start,
    def.duration,
    def.id,
  );

  // 5. Asset merging. Validate per-instance; the caller does cross-instance
  //    de-dup against the root composition's assets.
  const assets: Asset[] = [];
  for (const a of def.assets) {
    assets.push(cloneAsset(a));
  }
  for (const child of childExpansions) {
    for (const a of child.assets) assets.push(cloneAsset(a));
  }

  return { groupItem, items, tweens: ownTweens, assets, internalIds };
}

// ──────────────── Compile-time pass ────────────────

/**
 * Walk a composition object and lower every `items[*].type === "scene"` into
 * a synthetic group + namespaced inner items + shifted tweens.
 *
 * Pure function. Steps:
 *   1. Read user scenes from `comp.scenes` (an optional `Record<id, def>`).
 *   2. Iterate `items` in sorted key order. For each scene instance:
 *      - Expand via `expandSceneInstance`.
 *      - Replace the instance entry with the synthetic group under the same id.
 *      - Merge prefixed inner items into the new `items` map.
 *      - Append shifted tweens; merge assets.
 *      - Track parent-authored tween targets for §8.7 deep-target enforcement.
 *      - Rewire any layer that referenced the instance id: keep the instance
 *        id in place (the wrapper group still lives there); inner ids stay
 *        nested via the group, NOT promoted to the layer's items list.
 *      - If no layer referenced the instance, fall back to `instance.layerId`.
 *   3. Drop the top-level `scenes` key from the output (compile-time only —
 *      the canonical engine never sees it).
 *
 * If the composition has no scene instances AND no `scenes` key, the input
 * is returned unchanged.
 */
export function expandSceneInstances(comp: unknown): unknown {
  if (!isPlainObject(comp)) return comp;
  const itemsRaw = (comp as { items?: unknown }).items;
  const scenesRaw = (comp as { scenes?: unknown }).scenes;

  const userScenes: Record<string, SceneDefinition> = {};
  if (scenesRaw !== undefined) {
    if (!isPlainObject(scenesRaw)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "`scenes` must be an object keyed by scene id.",
      );
    }
    for (const id of Object.keys(scenesRaw).sort()) {
      const defRaw = scenesRaw[id];
      if (!isPlainObject(defRaw)) {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          `Scene definition "${id}" must be an object.`,
        );
      }
      userScenes[id] = readSceneDefinition(id, defRaw);
    }
  }

  const hasInstance =
    isPlainObject(itemsRaw) &&
    Object.values(itemsRaw).some(isSceneInstance);

  if (!hasInstance) {
    if (scenesRaw === undefined) return comp;
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(comp)) {
      if (k !== "scenes") rest[k] = v;
    }
    return rest;
  }

  const newItems: Record<string, unknown> = {};
  const expansions: Array<{
    instanceId: string;
    layerId: string | undefined;
    internalIds: string[];
  }> = [];
  const newTweens: unknown[] = [];
  const allInternalIds = new Set<string>();
  const pendingAssets: Asset[] = [];

  for (const key of Object.keys(itemsRaw as Record<string, unknown>).sort()) {
    const v = (itemsRaw as Record<string, unknown>)[key];
    if (isSceneInstance(v)) {
      const inst = readSceneInstanceFromItem(key, v);
      const expanded = expandSceneInstance(key, inst, { scenes: userScenes });

      // Wrapper group lives under the instance id.
      if (key in newItems) {
        throw new MCPToolError(
          "E_DUPLICATE_ID",
          `Scene instance "${key}" collides with an existing item id.`,
        );
      }
      newItems[key] = expanded.groupItem;

      for (const innerId of Object.keys(expanded.items)) {
        if (innerId in newItems) {
          throw new MCPToolError(
            "E_DUPLICATE_ID",
            `Scene instance "${key}" produced item id "${innerId}" that collides with another item.`,
          );
        }
        newItems[innerId] = expanded.items[innerId];
        allInternalIds.add(innerId);
      }
      for (const t of expanded.tweens) newTweens.push(t);
      expansions.push({
        instanceId: key,
        layerId: inst.layerId,
        internalIds: expanded.internalIds,
      });

      // Asset merging happens after the loop so we can validate against the
      // composition's own assets first.
      pendingAssets.push(...expanded.assets);
    } else {
      if (key in newItems) {
        throw new MCPToolError(
          "E_DUPLICATE_ID",
          `Item id "${key}" collides with a scene-expanded id.`,
        );
      }
      newItems[key] = v;
    }
  }

  // §8.7 sealed-instance: parent-authored tweens must NOT target a scene's
  // internal expanded id. (Targeting the instance id itself is fine — that
  // hits the synthetic group wrapper.)
  const existingTweens = (comp as { tweens?: unknown }).tweens;
  if (Array.isArray(existingTweens)) {
    for (const t of existingTweens) {
      if (!isPlainObject(t)) {
        newTweens.push(t);
        continue;
      }
      const target = t.target;
      if (typeof target === "string" && allInternalIds.has(target)) {
        throw new MCPToolError(
          "E_SCENE_INSTANCE_DEEP_TARGET",
          `Tween target "${target}" reaches inside a scene instance.`,
          "Parent tweens may only target the instance id (the synthetic group). Use scene params to vary internal motion.",
        );
      }
      newTweens.push(t);
    }
  }

  // Re-route layers — the instance id stays in place (it's the wrapper group);
  // we just need to ensure the instance is referenced by *some* layer.
  const layersRaw = (comp as { layers?: unknown }).layers;
  let newLayers: unknown = layersRaw;
  if (Array.isArray(layersRaw)) {
    const layerCopies: unknown[] = layersRaw.map((l) =>
      isPlainObject(l) ? { ...l } : l,
    );
    for (const exp of expansions) {
      let placed = false;
      for (const lyr of layerCopies) {
        if (!isPlainObject(lyr)) continue;
        const items = lyr.items;
        if (!Array.isArray(items)) continue;
        if (items.includes(exp.instanceId)) {
          placed = true;
          break;
        }
      }
      if (!placed) {
        if (exp.layerId === undefined) {
          throw new MCPToolError(
            "E_INVALID_VALUE",
            `Scene instance "${exp.instanceId}" has no layerId and is not referenced by any layer.`,
            "Set `layerId` on the instance, or list the instance id in a layer's `items`.",
          );
        }
        const target = layerCopies.find(
          (l): l is Record<string, unknown> =>
            isPlainObject(l) && l.id === exp.layerId,
        );
        if (!target) {
          throw new MCPToolError(
            "E_NOT_FOUND",
            `Scene instance "${exp.instanceId}" references unknown layer "${exp.layerId}".`,
          );
        }
        const items = Array.isArray(target.items) ? (target.items as unknown[]) : [];
        target.items = [...items, exp.instanceId];
      }
    }
    newLayers = layerCopies;
  }

  // Asset merge against the composition's existing `assets` array.
  const existingAssetsRaw = (comp as { assets?: unknown }).assets;
  const mergedAssets: Asset[] = [];
  const seenAssets = new Map<string, Asset>();
  if (Array.isArray(existingAssetsRaw)) {
    for (const a of existingAssetsRaw) {
      if (isPlainObject(a) && typeof a.id === "string") {
        const cloned = cloneRawAsset(a);
        seenAssets.set(cloned.id, cloned);
        mergedAssets.push(cloned);
      } else {
        // Non-asset entry — leave it alone (validator will reject if invalid).
        mergedAssets.push(a as Asset);
      }
    }
  }
  for (const a of pendingAssets) {
    const existing = seenAssets.get(a.id);
    if (existing === undefined) {
      seenAssets.set(a.id, a);
      mergedAssets.push(a);
      continue;
    }
    if (assetsEquivalent(existing, a)) continue;
    throw new MCPToolError(
      "E_ASSET_CONFLICT",
      `Asset id "${a.id}" merged from a scene conflicts with an existing asset of different content.`,
      "Rename one of them, or extract the asset into the composition root so both sides reference the same id+src.",
    );
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(comp)) {
    if (k === "scenes" || k === "items" || k === "layers" || k === "tweens" || k === "assets")
      continue;
    out[k] = v;
  }
  out.assets = mergedAssets;
  out.items = newItems;
  out.layers = newLayers;
  out.tweens = newTweens;
  return out;
}

// ──────────────── Helpers ────────────────

function resolveParams(
  def: SceneDefinition,
  instance: SceneInstance,
): Record<string, unknown> {
  const supplied = instance.params ?? {};
  const out: Record<string, unknown> = {};
  for (const p of def.params) {
    let v: unknown;
    if (Object.prototype.hasOwnProperty.call(supplied, p.name)) {
      v = supplied[p.name];
    } else if (Object.prototype.hasOwnProperty.call(p, "default")) {
      v = p.default;
    } else if (p.required === true) {
      throw new MCPToolError(
        "E_SCENE_PARAM_MISSING",
        `Scene "${def.id}" requires param "${p.name}".`,
      );
    } else {
      continue;
    }
    if (!matchesType(v, p.type)) {
      throw new MCPToolError(
        "E_SCENE_PARAM_TYPE",
        `Scene "${def.id}" param "${p.name}" expected ${p.type}, got ${describeType(v)}.`,
      );
    }
    out[p.name] = v;
  }
  return out;
}

function matchesType(v: unknown, t: SceneParamType): boolean {
  switch (t) {
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "string":
      return typeof v === "string";
    case "color":
      return typeof v === "string" && v.length > 0;
    case "boolean":
      return typeof v === "boolean";
    default:
      return false;
  }
}

function describeType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function rewriteItemRefs(
  item: unknown,
  instanceId: string,
  localIds: Set<string>,
): unknown {
  if (!isPlainObject(item)) return item;
  if (item.type === "group" && Array.isArray(item.items)) {
    return {
      ...item,
      items: (item.items as unknown[]).map((id) =>
        typeof id === "string" && localIds.has(id) ? `${instanceId}__${id}` : id,
      ),
    };
  }
  return item;
}

function rewriteTween(
  tween: Record<string, unknown>,
  instanceId: string,
  sceneId: string,
  localIds: Set<string>,
  instanceStart: number,
  index: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...tween };
  if (typeof out.target === "string" && localIds.has(out.target)) {
    out.target = `${instanceId}__${out.target}`;
  }
  if (out.start === undefined) {
    out.start = instanceStart;
  } else if (typeof out.start === "number" && Number.isFinite(out.start)) {
    out.start = instanceStart + out.start;
  } else {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Scene "${sceneId}" tween at index ${index} has non-numeric start.`,
    );
  }
  const isBehavior = typeof out.$behavior === "string";
  if (typeof out.id === "string" && out.id.length > 0) {
    out.id = `${instanceId}__${out.id}`;
  } else if (!isBehavior) {
    out.id = `${instanceId}__t${index}`;
  }
  return out;
}

// ──────────────── Time mapping (§8.5) ────────────────

/**
 * Validate a {@link TimeMapping} against the scene's own duration. Returns a
 * canonicalised spec (loop count coerced to integer) so callers don't need to
 * re-check.
 *
 * Throws `E_TIME_MAPPING_INVALID` on:
 *   - clip: fromTime >= toTime, fromTime < 0, toTime > scene.duration
 *   - loop: count < 1 or not an integer
 *   - timeScale: scale <= 0
 */
function validateTimeMapping(
  spec: TimeMapping,
  sceneId: string,
  sceneDuration: number,
): TimeMapping {
  switch (spec.mode) {
    case "identity":
      return spec;
    case "clip": {
      const { fromTime, toTime } = spec;
      if (fromTime < 0) {
        throw new MCPToolError(
          "E_TIME_MAPPING_INVALID",
          `Scene "${sceneId}" clip.fromTime (${fromTime}) must be >= 0.`,
        );
      }
      if (toTime <= fromTime) {
        throw new MCPToolError(
          "E_TIME_MAPPING_INVALID",
          `Scene "${sceneId}" clip.toTime (${toTime}) must be greater than fromTime (${fromTime}).`,
        );
      }
      if (toTime > sceneDuration + 1e-9) {
        throw new MCPToolError(
          "E_TIME_MAPPING_INVALID",
          `Scene "${sceneId}" clip.toTime (${toTime}) exceeds scene duration (${sceneDuration}).`,
        );
      }
      return spec;
    }
    case "loop": {
      const { count } = spec;
      if (count < 1 || !Number.isInteger(count)) {
        throw new MCPToolError(
          "E_TIME_MAPPING_INVALID",
          `Scene "${sceneId}" loop.count must be a positive integer; got ${count}.`,
        );
      }
      return spec;
    }
    case "timeScale": {
      const { scale } = spec;
      if (scale <= 0) {
        throw new MCPToolError(
          "E_TIME_MAPPING_INVALID",
          `Scene "${sceneId}" timeScale.scale must be > 0; got ${scale}.`,
        );
      }
      return spec;
    }
  }
}

/**
 * Apply a time-mapping spec to a flat list of scene-local tweens, producing
 * the tweens that should appear on the parent timeline starting at
 * `parentStart`.
 *
 * Each input tween must already have its target/id prefixed by the scene
 * instance id and its `start` in scene-local time (0 = the moment the scene
 * begins). Behavior blocks (`$behavior`) pass through with target/id intact
 * and only get their `start`/`duration` transformed.
 *
 * `sceneDuration` is the scene's authored span — only the `loop` branch
 * consumes it (to compute the per-iteration time offset without drift from
 * chained adds).
 *
 * For loop, behavior blocks pin their parent id from `${target}_${behavior}_${start}`
 * (see behaviors.ts `deriveParentId`). Since each iteration's `start` differs,
 * behavior ids are naturally unique without a suffix; user-supplied behavior
 * ids do still get the iteration suffix to preserve uniqueness.
 */
function applyTimeMapping(
  localTweens: ReadonlyArray<Record<string, unknown>>,
  spec: TimeMapping,
  parentStart: number,
  sceneDuration: number,
  sceneId: string,
): unknown[] {
  switch (spec.mode) {
    case "identity":
      return localTweens.map((t) => shiftStart(t, parentStart));
    case "timeScale": {
      const inv = 1 / spec.scale;
      return localTweens.map((t) => {
        const out = { ...t };
        const s = readNumber(out.start);
        const d = readNumber(out.duration);
        if (s !== undefined) out.start = parentStart + s * inv;
        if (d !== undefined) out.duration = d * inv;
        return out;
      });
    }
    case "clip": {
      const { fromTime, toTime } = spec;
      const out: unknown[] = [];
      for (const t of localTweens) {
        const s = readNumber(t.start);
        const d = readNumber(t.duration);
        if (s === undefined || d === undefined) {
          // No timing fields to clip against — pass through after start-shift.
          // (Behavior blocks always carry start+duration, so this branch
          // should be unreachable in well-formed input.)
          out.push(shiftStart(t, parentStart));
          continue;
        }
        const end = s + d;
        // Fully outside the clip window → drop.
        if (end <= fromTime + 1e-9) continue;
        if (s >= toTime - 1e-9) continue;
        // Boundary-crossing → not supported in v0.5. Authors must shape the
        // scene so tweens align with the clip window. Future versions may
        // add automatic trimming.
        if (s < fromTime - 1e-9 || end > toTime + 1e-9) {
          throw new MCPToolError(
            "E_TIME_MAPPING_TWEEN_SPLIT",
            `Scene "${sceneId}" tween "${String(t.id ?? "<anonymous>")}" straddles the clip window [${fromTime}, ${toTime}].`,
            "Split the tween at the clip boundary in the scene definition, or adjust fromTime/toTime so the tween falls fully inside or outside.",
          );
        }
        const next = { ...t };
        next.start = parentStart + (s - fromTime);
        out.push(next);
      }
      return out;
    }
    case "loop": {
      const out: unknown[] = [];
      for (let i = 0; i < spec.count; i += 1) {
        // Multiply once per iteration rather than chaining adds so drift
        // doesn't accumulate across loops (`i * sceneDuration` keeps a
        // single rounding step; `prev + sceneDuration` would compound).
        const iterShift = parentStart + i * sceneDuration;
        const suffix = `loop${pad(i, spec.count)}`;
        for (const t of localTweens) {
          const next = { ...t };
          const s = readNumber(next.start);
          if (s !== undefined) next.start = iterShift + s;
          if (typeof next.id === "string" && next.id.length > 0) {
            next.id = `${next.id}__${suffix}`;
          }
          out.push(next);
        }
      }
      return out;
    }
  }
}

function shiftStart(
  tween: Record<string, unknown>,
  delta: number,
): Record<string, unknown> {
  const out = { ...tween };
  const s = readNumber(out.start);
  if (s !== undefined && delta !== 0) out.start = s + delta;
  return out;
}

function readNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function pad(i: number, total: number): string {
  const width = String(Math.max(1, total - 1)).length;
  return String(i).padStart(width, "0");
}

function isSceneInstance(v: unknown): v is Record<string, unknown> {
  return (
    isPlainObject(v) &&
    v.type === "scene" &&
    typeof v.scene === "string" &&
    v.scene.length > 0
  );
}

function readSceneInstanceFromItem(
  instanceId: string,
  raw: Record<string, unknown>,
): SceneInstance {
  const scene = raw.scene;
  if (typeof scene !== "string" || scene.length === 0) {
    throw new MCPToolError(
      "E_SCENE_UNKNOWN",
      `Item "${instanceId}" is missing a non-empty scene name.`,
    );
  }
  const inst: SceneInstance = { scene };
  if (raw.params !== undefined) {
    if (!isPlainObject(raw.params)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Scene instance "${instanceId}" params must be an object.`,
      );
    }
    inst.params = raw.params;
  }
  if (raw.start !== undefined) {
    if (typeof raw.start !== "number" || !Number.isFinite(raw.start)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Scene instance "${instanceId}" start must be a finite number.`,
      );
    }
    inst.start = raw.start;
  }
  if (raw.layerId !== undefined) {
    if (typeof raw.layerId !== "string" || raw.layerId.length === 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Scene instance "${instanceId}" layerId must be a non-empty string.`,
      );
    }
    inst.layerId = raw.layerId;
  }
  if (raw.transform !== undefined) {
    if (!isPlainObject(raw.transform)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Scene instance "${instanceId}" transform must be an object.`,
      );
    }
    inst.transform = raw.transform;
  }
  if (raw.time !== undefined) {
    inst.time = readTimeMappingFromRaw(instanceId, raw.time);
  }
  return inst;
}

/**
 * Parse + sanity-check a raw `time` field from a scene-instance item.
 * Defers to {@link validateTimeMapping} for range checks (those depend on
 * scene.duration which isn't known here).
 */
function readTimeMappingFromRaw(instanceId: string, raw: unknown): TimeMapping {
  if (!isPlainObject(raw)) {
    throw new MCPToolError(
      "E_TIME_MAPPING_INVALID",
      `Scene instance "${instanceId}" time must be an object with a "mode" field.`,
    );
  }
  const mode = raw.mode;
  switch (mode) {
    case "identity":
      return { mode: "identity" };
    case "clip": {
      const fromTime = raw.fromTime;
      const toTime = raw.toTime;
      if (typeof fromTime !== "number" || !Number.isFinite(fromTime)) {
        throw new MCPToolError(
          "E_TIME_MAPPING_INVALID",
          `Scene instance "${instanceId}" clip.fromTime must be a finite number.`,
        );
      }
      if (typeof toTime !== "number" || !Number.isFinite(toTime)) {
        throw new MCPToolError(
          "E_TIME_MAPPING_INVALID",
          `Scene instance "${instanceId}" clip.toTime must be a finite number.`,
        );
      }
      return { mode: "clip", fromTime, toTime };
    }
    case "loop": {
      const count = raw.count;
      if (typeof count !== "number" || !Number.isFinite(count)) {
        throw new MCPToolError(
          "E_TIME_MAPPING_INVALID",
          `Scene instance "${instanceId}" loop.count must be a finite number.`,
        );
      }
      return { mode: "loop", count };
    }
    case "timeScale": {
      const scale = raw.scale;
      if (typeof scale !== "number" || !Number.isFinite(scale)) {
        throw new MCPToolError(
          "E_TIME_MAPPING_INVALID",
          `Scene instance "${instanceId}" timeScale.scale must be a finite number.`,
        );
      }
      return { mode: "timeScale", scale };
    }
    default:
      throw new MCPToolError(
        "E_TIME_MAPPING_INVALID",
        `Scene instance "${instanceId}" has unsupported time mode "${String(mode)}".`,
        'Supported modes: "identity", "clip", "loop", "timeScale".',
      );
  }
}

export function readSceneDefinition(
  id: string,
  raw: Record<string, unknown>,
): SceneDefinition {
  const params: SceneParamDescriptor[] = [];
  if (raw.params !== undefined) {
    if (!Array.isArray(raw.params)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Scene "${id}" params must be an array.`,
      );
    }
    for (const p of raw.params) {
      if (!isPlainObject(p)) {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          `Scene "${id}" param entry must be an object.`,
        );
      }
      const pname = p.name;
      if (typeof pname !== "string" || pname.length === 0) {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          `Scene "${id}" param missing name.`,
        );
      }
      const ptype = p.type;
      if (
        ptype !== "number" &&
        ptype !== "string" &&
        ptype !== "color" &&
        ptype !== "boolean"
      ) {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          `Scene "${id}" param "${pname}" has unsupported type "${String(ptype)}".`,
        );
      }
      const desc: SceneParamDescriptor = { name: pname, type: ptype };
      if (p.required === true) desc.required = true;
      if (Object.prototype.hasOwnProperty.call(p, "default")) desc.default = p.default;
      if (typeof p.description === "string") desc.description = p.description;
      params.push(desc);
    }
  }

  const duration = raw.duration;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Scene "${id}" duration must be a non-negative number.`,
    );
  }

  const items = isPlainObject(raw.items) ? (raw.items as Record<string, unknown>) : {};
  const tweens = Array.isArray(raw.tweens) ? (raw.tweens as unknown[]) : [];
  const assets: Asset[] = [];
  if (raw.assets !== undefined) {
    if (!Array.isArray(raw.assets)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Scene "${id}" assets must be an array.`,
      );
    }
    for (const a of raw.assets) {
      if (!isPlainObject(a)) {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          `Scene "${id}" asset entry must be an object.`,
        );
      }
      assets.push(cloneRawAsset(a));
    }
  }

  const def: SceneDefinition = { id, params, duration, items, tweens, assets };
  if (typeof raw.description === "string") def.description = raw.description;
  if (isPlainObject(raw.size)) {
    const w = raw.size.width;
    const h = raw.size.height;
    if (
      typeof w === "number" &&
      Number.isFinite(w) &&
      w > 0 &&
      typeof h === "number" &&
      Number.isFinite(h) &&
      h > 0
    ) {
      def.size = { width: w, height: h };
    }
  }
  if (typeof raw.background === "string" && raw.background.length > 0) {
    def.background = raw.background;
  }
  return def;
}

function toDescriptor(def: SceneDefinition): SceneDescriptor {
  const out: SceneDescriptor = {
    id: def.id,
    duration: def.duration,
    params: def.params.map((p) => ({ ...p })),
    emits: Object.keys(def.items).sort(),
    assets: def.assets.map((a) => a.id).sort(),
  };
  if (def.description !== undefined) out.description = def.description;
  if (def.size !== undefined) out.size = { ...def.size };
  if (def.background !== undefined) out.background = def.background;
  return out;
}

function normalizeTransform(raw: SceneInstance["transform"]): Record<string, number> {
  const t = raw ?? {};
  return {
    x: numberOr(t.x, 0),
    y: numberOr(t.y, 0),
    scaleX: numberOr(t.scaleX, 1),
    scaleY: numberOr(t.scaleY, 1),
    rotation: numberOr(t.rotation, 0),
    anchorX: numberOr(t.anchorX, 0),
    anchorY: numberOr(t.anchorY, 0),
    opacity: numberOr(t.opacity, 1),
  };
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function cloneAsset(a: Asset): Asset {
  return a.type === "image"
    ? { id: a.id, type: "image", src: a.src }
    : { id: a.id, type: "font", src: a.src, family: a.family };
}

function cloneRawAsset(a: Record<string, unknown>): Asset {
  const id = a.id;
  const type = a.type;
  const src = a.src;
  if (typeof id !== "string" || id.length === 0) {
    throw new MCPToolError("E_INVALID_VALUE", "Asset missing non-empty id.");
  }
  if (typeof src !== "string" || src.length === 0) {
    throw new MCPToolError("E_INVALID_VALUE", `Asset "${id}" missing non-empty src.`);
  }
  if (type === "image") {
    return { id, type: "image", src };
  }
  if (type === "font") {
    const family = a.family;
    if (typeof family !== "string" || family.length === 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Font asset "${id}" requires a non-empty family.`,
      );
    }
    return { id, type: "font", src, family };
  }
  throw new MCPToolError(
    "E_INVALID_VALUE",
    `Asset "${id}" has unsupported type "${String(type)}".`,
  );
}

function assetsEquivalent(a: Asset, b: Asset): boolean {
  if (a.type !== b.type) return false;
  if (a.src !== b.src) return false;
  if (a.type === "font" && b.type === "font" && a.family !== b.family) return false;
  return true;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
