// Template registry and expansion — primitive P3 from
// COMPOSITION_PRIMITIVES.md §7. A *template* is a named, parameterized
// item+tween bundle. An *instance* references a template by name and
// supplies params + a placement (`start`, `layerId`).
//
// Two callers exercise this module:
//
//   - `apply_template` (MCP tool, §7.8) — expand a single instance into
//     concrete items + tweens which the caller appends to its store.
//   - `expandTemplates` (compile pass, §10) — walk an authored composition,
//     find every `items[*].$template` instance, replace it with the
//     expanded items, append its tweens, and rewire any layer references.
//
// Both go through `expandTemplate(instanceId, instance)` so the
// param-substitution + id-rewriting + time-mapping rules live in one place.
//
// IDs (§7.5): every item id from the template definition is prefixed by the
// instance id at expansion time (`bar` → `myLowerThird__bar`). Tween targets
// pointing at local items are rewritten the same way. Tween `start` values
// are template-local (§7.6): the global start is `instance.start + local.start`.
// `$behavior` blocks inside a template's `tweens` array survive expansion
// unchanged shape-wise — the §10 pipeline runs `expandBehaviors` next, so
// they get expanded to literal tweens after templates have done their work.

import { MCPToolError } from "../mcp/errors.js";
import { substitute, type SubstitutionContext } from "./params.js";

// ──────────────── Public types ────────────────

export type TemplateParamType = "number" | "string" | "color" | "boolean";

export interface TemplateParamDescriptor {
  name: string;
  type: TemplateParamType;
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface TemplateDefinition {
  id: string;
  description?: string;
  params: TemplateParamDescriptor[];
  /** Map of local item id → raw item with substitution placeholders. */
  items: Record<string, unknown>;
  /** Raw tweens with template-local `start`; entries may be `$behavior` blocks. */
  tweens: unknown[];
}

export interface TemplateDescriptor {
  id: string;
  description?: string;
  params: TemplateParamDescriptor[];
  /** Local item ids the template emits, sorted for stable discovery output. */
  emits: string[];
}

export interface TemplateInstance {
  /** Template name (matches a `TemplateDefinition.id`). */
  template: string;
  /** Param values keyed by descriptor name. */
  params?: Record<string, unknown>;
  /** Global timeline offset for the instance. Defaults to 0. */
  start?: number;
  /** Layer that should host the expanded items. */
  layerId?: string;
}

export interface ExpandedTemplate {
  /** Map of post-prefix item id → expanded item (with substituted values). */
  items: Record<string, unknown>;
  /** Tween entries with adjusted `start`/`target`/`id`. May still contain `$behavior`. */
  tweens: unknown[];
}

// ──────────────── Registry (built-ins ship in v0.3 follow-ups) ────────────────

const REGISTRY = new Map<string, TemplateDefinition>();

/** Add a template to the global registry. Last write wins for the same id. */
export function registerTemplate(def: TemplateDefinition): void {
  if (typeof def.id !== "string" || def.id.length === 0) {
    throw new Error("registerTemplate: definition is missing a non-empty id.");
  }
  REGISTRY.set(def.id, def);
}

export function hasTemplate(id: string): boolean {
  return REGISTRY.has(id);
}

export function getTemplateDefinition(id: string): TemplateDefinition | undefined {
  return REGISTRY.get(id);
}

export function listTemplates(): TemplateDescriptor[] {
  return Array.from(REGISTRY.values()).map(toDescriptor);
}

// ──────────────── Single-instance expansion ────────────────

/**
 * Expand one template instance to its concrete items + tweens.
 *
 * Lookup order: `options.templates` (per-composition `templates` block) takes
 * precedence over the global registry, so a composition can override a
 * built-in by name.
 *
 * Throws `MCPToolError` for the validation cases listed in §7.7
 * (E_TEMPLATE_UNKNOWN, E_TEMPLATE_PARAM_MISSING, E_TEMPLATE_PARAM_TYPE) plus
 * E_INVALID_VALUE for malformed instance fields.
 */
export function expandTemplate(
  instanceId: string,
  instance: TemplateInstance,
  options: { templates?: Record<string, TemplateDefinition> } = {},
): ExpandedTemplate {
  if (typeof instanceId !== "string" || instanceId.length === 0) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      "Template instance must be expanded under a non-empty id.",
    );
  }
  const def =
    (options.templates !== undefined && options.templates[instance.template]) ||
    REGISTRY.get(instance.template);
  if (!def) {
    throw new MCPToolError(
      "E_TEMPLATE_UNKNOWN",
      `Unknown template "${instance.template}".`,
      "Call list_templates to see available names.",
    );
  }
  const start = instance.start ?? 0;
  if (typeof start !== "number" || !Number.isFinite(start) || start < 0) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Template instance "${instanceId}" requires a non-negative numeric start.`,
    );
  }
  const params = resolveParams(def, instance);
  const ctx: SubstitutionContext = { params, meta: { start } };
  const localIds = new Set(Object.keys(def.items));

  const items: Record<string, unknown> = {};
  // Sorted iteration for §10.2 determinism.
  for (const localId of Object.keys(def.items).sort()) {
    const itemRaw = def.items[localId];
    const substituted = substitute(
      itemRaw,
      ctx,
      `templates.${def.id}.items.${localId}`,
    );
    const rewritten = rewriteItemRefs(substituted, instanceId, localIds);
    items[`${instanceId}__${localId}`] = rewritten;
  }

  const tweens: unknown[] = [];
  for (let i = 0; i < def.tweens.length; i += 1) {
    const tweenRaw = def.tweens[i];
    if (!isPlainObject(tweenRaw)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Template "${def.id}" tween at index ${i} must be an object.`,
      );
    }
    const path = `templates.${def.id}.tweens[${i}]`;
    const substituted = substitute(tweenRaw, ctx, path) as Record<string, unknown>;
    tweens.push(rewriteTween(substituted, instanceId, localIds, start, i));
  }

  return { items, tweens };
}

// ──────────────── Compile-time pass ────────────────

/**
 * Walk a composition object and expand every `items[*].$template` instance.
 *
 * Pure function. Steps:
 *   1. Read user templates from `comp.templates` (an optional `Record<id, def>`).
 *   2. Iterate `items` in sorted key order. For each `$template` instance:
 *      - Run `expandTemplate` to get items + tweens.
 *      - Replace the instance entry with the expanded items map (merged into
 *        the new `items` map under the prefixed ids).
 *      - Append expanded tweens to the composition's `tweens` array.
 *      - Rewire any layer that referenced the instance id: replace the
 *        instance id with the expanded id list in declaration order.
 *      - If no layer referenced the instance, fall back to `instance.layerId`.
 *   3. Walk `comp.scenes[*]` and lower any `$template` blocks in each scene's
 *      `items` map (the scene's own `items`/`tweens` are rewritten in place,
 *      without layer rewiring — scenes have no layers).
 *   4. Drop the top-level `templates` key from the output (it's compile-time
 *      only — the canonical engine never sees it).
 *
 * If the composition has no `$template` instances anywhere AND no `templates`
 * key, the input is returned unchanged (cheap short-circuit).
 */
export function expandTemplates(comp: unknown): unknown {
  if (!isPlainObject(comp)) return comp;
  const itemsRaw = (comp as { items?: unknown }).items;
  const scenesRaw = (comp as { scenes?: unknown }).scenes;
  const templatesRaw = (comp as { templates?: unknown }).templates;

  const userTemplates: Record<string, TemplateDefinition> = {};
  if (templatesRaw !== undefined) {
    if (!isPlainObject(templatesRaw)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "`templates` must be an object keyed by template id.",
      );
    }
    for (const id of Object.keys(templatesRaw).sort()) {
      const defRaw = templatesRaw[id];
      if (!isPlainObject(defRaw)) {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          `Template definition "${id}" must be an object.`,
        );
      }
      userTemplates[id] = readTemplateDefinition(id, defRaw);
    }
  }

  const hasRootInstance =
    isPlainObject(itemsRaw) &&
    Object.values(itemsRaw).some(
      (v) => isPlainObject(v) && typeof v.$template === "string",
    );

  const hasSceneInstance =
    isPlainObject(scenesRaw) &&
    Object.values(scenesRaw).some((s) => sceneHasTemplateInstance(s));

  if (!hasRootInstance && !hasSceneInstance) {
    if (templatesRaw === undefined) return comp;
    // Strip compile-time-only `templates` key so the canonical output stays
    // v0.1-shaped for downstream validation.
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(comp)) {
      if (k !== "templates") rest[k] = v;
    }
    return rest;
  }

  // Phase 1 — root-level `$template` expansion (if any).
  let out: Record<string, unknown>;
  if (hasRootInstance) {
    out = expandRootTemplates(comp, itemsRaw as Record<string, unknown>, userTemplates);
  } else {
    // No root-level instances — just clone the comp, stripping `templates`.
    out = {};
    for (const [k, v] of Object.entries(comp)) {
      if (k !== "templates") out[k] = v;
    }
  }

  // Phase 2 — scene-internal `$template` expansion.
  if (hasSceneInstance && isPlainObject(scenesRaw)) {
    const newScenes: Record<string, unknown> = {};
    for (const id of Object.keys(scenesRaw).sort()) {
      const sceneRaw = scenesRaw[id];
      if (!isPlainObject(sceneRaw)) {
        newScenes[id] = sceneRaw;
        continue;
      }
      newScenes[id] = expandTemplatesInScene(sceneRaw, userTemplates, id);
    }
    out.scenes = newScenes;
  }

  return out;
}

// ──────────────── Root-level expansion (extracted) ────────────────

function expandRootTemplates(
  comp: Record<string, unknown>,
  itemsRaw: Record<string, unknown>,
  userTemplates: Record<string, TemplateDefinition>,
): Record<string, unknown> {
  const newItems: Record<string, unknown> = {};
  const expansions: Array<{
    instanceId: string;
    layerId: string | undefined;
    expandedIds: string[];
  }> = [];
  const newTweenAdditions: unknown[] = [];

  for (const key of Object.keys(itemsRaw).sort()) {
    const v = itemsRaw[key];
    if (isPlainObject(v) && typeof v.$template === "string") {
      const instance = readTemplateInstance(key, v);
      const expanded = expandTemplate(key, instance, { templates: userTemplates });
      const expandedIds = Object.keys(expanded.items);
      for (const newId of expandedIds) {
        if (newId in newItems) {
          throw new MCPToolError(
            "E_DUPLICATE_ID",
            `Template instance "${key}" produced item id "${newId}" that collides with another expanded id.`,
          );
        }
        newItems[newId] = expanded.items[newId];
      }
      for (const t of expanded.tweens) newTweenAdditions.push(t);
      expansions.push({
        instanceId: key,
        layerId: instance.layerId,
        expandedIds,
      });
    } else {
      if (key in newItems) {
        throw new MCPToolError(
          "E_DUPLICATE_ID",
          `Item id "${key}" collides with a template-expanded id.`,
        );
      }
      newItems[key] = v;
    }
  }

  // Re-route layers: replace instance-id references with expanded ids; honor
  // `layerId` as fallback for instances that no layer mentioned.
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
        const idx = items.indexOf(exp.instanceId);
        if (idx >= 0) {
          const next: unknown[] = [];
          for (let i = 0; i < items.length; i += 1) {
            const cur = items[i];
            if (cur === exp.instanceId) {
              if (!placed) {
                next.push(...exp.expandedIds);
                placed = true;
              }
              // Drop further duplicates of the instance id.
            } else {
              next.push(cur);
            }
          }
          lyr.items = next;
        }
      }
      if (!placed) {
        if (exp.layerId === undefined) {
          throw new MCPToolError(
            "E_INVALID_VALUE",
            `Template instance "${exp.instanceId}" has no layerId and is not referenced by any layer.`,
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
            `Template instance "${exp.instanceId}" references unknown layer "${exp.layerId}".`,
          );
        }
        const items = Array.isArray(target.items) ? (target.items as unknown[]) : [];
        target.items = [...items, ...exp.expandedIds];
      }
    }
    newLayers = layerCopies;
  }

  // Build canonical output: drop `templates`, swap items/layers/tweens.
  const existingTweens = (comp as { tweens?: unknown }).tweens;
  const newTweens = Array.isArray(existingTweens)
    ? [...existingTweens, ...newTweenAdditions]
    : newTweenAdditions;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(comp)) {
    if (k === "templates" || k === "items" || k === "layers" || k === "tweens") continue;
    out[k] = v;
  }
  out.items = newItems;
  out.layers = newLayers;
  out.tweens = newTweens;
  return out;
}

// ──────────────── Scene-internal expansion ────────────────

/**
 * Lower every `$template` block inside a scene definition's `items` map.
 *
 * The scene is still raw at this point — the scenes pass (which calls
 * `readSceneDefinition`) runs *after* templates. Inside a scene definition
 * there are no layers, so no layer-rewiring step is needed; the wrapper-group
 * that `expandSceneInstance` builds reads the (expanded) scene `items` map
 * directly, so the expanded ids are automatically picked up as group children.
 *
 * Template params on the instance may reference scene params via
 * `${params.X}` — those placeholders pass through `expandTemplate` untouched
 * (templates only run `substitute` with their own param context), then resolve
 * later when `expandSceneInstance` substitutes against the scene-instance's
 * params.
 *
 * IDs follow the double-prefix rule: a template instance keyed `lower` whose
 * template emits local id `bar` produces `lower__bar` here. The outer scene
 * expansion adds its own `${instanceId}__` prefix on top later
 * (`intro__lower__bar`).
 *
 * Returns the input scene unchanged when no instances are present.
 */
function expandTemplatesInScene(
  scene: Record<string, unknown>,
  userTemplates: Record<string, TemplateDefinition>,
  sceneId: string,
): Record<string, unknown> {
  const itemsRaw = scene.items;
  if (!isPlainObject(itemsRaw)) return scene;
  if (!sceneHasTemplateInstance(scene)) return scene;

  const newItems: Record<string, unknown> = {};
  const newTweenAdditions: unknown[] = [];

  for (const key of Object.keys(itemsRaw).sort()) {
    const v = itemsRaw[key];
    if (isPlainObject(v) && typeof v.$template === "string") {
      const instance = readTemplateInstance(key, v);
      const expanded = expandTemplate(key, instance, { templates: userTemplates });
      for (const newId of Object.keys(expanded.items)) {
        if (newId in newItems) {
          throw new MCPToolError(
            "E_DUPLICATE_ID",
            `Scene "${sceneId}" template instance "${key}" produced item id "${newId}" that collides with another id in the scene.`,
          );
        }
        newItems[newId] = expanded.items[newId];
      }
      for (const t of expanded.tweens) newTweenAdditions.push(t);
    } else {
      if (key in newItems) {
        throw new MCPToolError(
          "E_DUPLICATE_ID",
          `Scene "${sceneId}" item id "${key}" collides with a template-expanded id.`,
        );
      }
      newItems[key] = v;
    }
  }

  const existingTweens = scene.tweens;
  const newTweens = Array.isArray(existingTweens)
    ? [...existingTweens, ...newTweenAdditions]
    : newTweenAdditions;

  return { ...scene, items: newItems, tweens: newTweens };
}

function sceneHasTemplateInstance(scene: unknown): boolean {
  if (!isPlainObject(scene)) return false;
  const items = scene.items;
  if (!isPlainObject(items)) return false;
  for (const v of Object.values(items)) {
    if (isPlainObject(v) && typeof v.$template === "string") return true;
  }
  return false;
}

// ──────────────── Helpers ────────────────

function resolveParams(
  def: TemplateDefinition,
  instance: TemplateInstance,
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
        "E_TEMPLATE_PARAM_MISSING",
        `Template "${def.id}" requires param "${p.name}".`,
      );
    } else {
      // Optional with no default — leave unset; substitution will throw if
      // a placeholder references it, which gives the author a precise error.
      continue;
    }
    if (!matchesType(v, p.type)) {
      throw new MCPToolError(
        "E_TEMPLATE_PARAM_TYPE",
        `Template "${def.id}" param "${p.name}" expected ${p.type}, got ${describeType(v)}.`,
      );
    }
    out[p.name] = v;
  }
  return out;
}

function matchesType(v: unknown, t: TemplateParamType): boolean {
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
  // Group items list local item ids in `items: string[]` — those need to be
  // prefixed too, otherwise the group won't find its children post-expansion.
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
  localIds: Set<string>,
  instanceStart: number,
  index: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...tween };
  // Rewrite target → prefixed id (if it points at a local template item).
  // Targets that don't match a local id are left untouched so templates can
  // address composition-level items by their canonical id when they need to.
  if (typeof out.target === "string" && localIds.has(out.target)) {
    out.target = `${instanceId}__${out.target}`;
  }
  // Lift template-local `start` to global timeline.
  if (out.start === undefined) {
    out.start = instanceStart;
  } else if (typeof out.start === "number" && Number.isFinite(out.start)) {
    out.start = instanceStart + out.start;
  } else {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Template tween at index ${index} has non-numeric start.`,
    );
  }
  const isBehavior = typeof out.$behavior === "string";
  // Prefix explicit ids so two instances of the same template don't share ids.
  if (typeof out.id === "string" && out.id.length > 0) {
    out.id = `${instanceId}__${out.id}`;
  } else if (!isBehavior) {
    // Literal tweens require an id post-expansion (the schema mandates one).
    // Auto-derive a deterministic one keyed by the template's tween index so
    // re-runs of the compiler produce byte-identical output.
    out.id = `${instanceId}__t${index}`;
  }
  // For `$behavior` blocks we deliberately don't synthesize an `id`. The
  // §6.4 derivation (`${target}_${behavior}_${start}`) runs in the next
  // pipeline stage on the rewritten target + adjusted start, which is
  // already unique per instance.
  return out;
}

function readTemplateInstance(
  instanceId: string,
  raw: Record<string, unknown>,
): TemplateInstance {
  const template = raw.$template;
  if (typeof template !== "string" || template.length === 0) {
    throw new MCPToolError(
      "E_TEMPLATE_UNKNOWN",
      `Item "${instanceId}" is missing a non-empty $template name.`,
    );
  }
  const inst: TemplateInstance = { template };
  if (raw.params !== undefined) {
    if (!isPlainObject(raw.params)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Template instance "${instanceId}" params must be an object.`,
      );
    }
    inst.params = raw.params;
  }
  if (raw.start !== undefined) {
    if (typeof raw.start !== "number" || !Number.isFinite(raw.start)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Template instance "${instanceId}" start must be a finite number.`,
      );
    }
    inst.start = raw.start;
  }
  if (raw.layerId !== undefined) {
    if (typeof raw.layerId !== "string" || raw.layerId.length === 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Template instance "${instanceId}" layerId must be a non-empty string.`,
      );
    }
    inst.layerId = raw.layerId;
  }
  return inst;
}

function readTemplateDefinition(
  id: string,
  raw: Record<string, unknown>,
): TemplateDefinition {
  const params: TemplateParamDescriptor[] = [];
  if (raw.params !== undefined) {
    if (!Array.isArray(raw.params)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Template "${id}" params must be an array.`,
      );
    }
    for (const p of raw.params) {
      if (!isPlainObject(p)) {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          `Template "${id}" param entry must be an object.`,
        );
      }
      const pname = p.name;
      if (typeof pname !== "string" || pname.length === 0) {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          `Template "${id}" param missing name.`,
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
          `Template "${id}" param "${pname}" has unsupported type "${String(ptype)}".`,
        );
      }
      const desc: TemplateParamDescriptor = { name: pname, type: ptype };
      if (p.required === true) desc.required = true;
      if (Object.prototype.hasOwnProperty.call(p, "default")) desc.default = p.default;
      if (typeof p.description === "string") desc.description = p.description;
      params.push(desc);
    }
  }
  const items = isPlainObject(raw.items) ? (raw.items as Record<string, unknown>) : {};
  const tweens = Array.isArray(raw.tweens) ? (raw.tweens as unknown[]) : [];
  const def: TemplateDefinition = { id, params, items, tweens };
  if (typeof raw.description === "string") def.description = raw.description;
  return def;
}

function toDescriptor(def: TemplateDefinition): TemplateDescriptor {
  const out: TemplateDescriptor = {
    id: def.id,
    params: def.params.map((p) => ({ ...p })),
    emits: Object.keys(def.items).sort(),
  };
  if (def.description !== undefined) out.description = def.description;
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
