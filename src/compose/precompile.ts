// Pre-compile pipeline driver — orchestrates the v0.2/v0.3/v0.4 authoring →
// canonical passes from COMPOSITION_PRIMITIVES.md §10. Today that's four
// passes: resolveImports → expandTemplates → expandSceneInstances →
// expandBehaviors.
//
// Drivers (`renderToFile`, `attach`) call this transparently so callers can
// hand authored JSON straight to the engine without thinking about a
// "compile step". For canonical v0.1 input the call is effectively free —
// detection short-circuits before any walk allocates.
//
// ──────────────── Source-map emission (editor v1.0, step 15) ────────────────
//
// When `emitSourceMap: true` is passed, the orchestrator threads an authorship
// trail through every emitted item / tween and returns it alongside the
// resolved composition. Mechanism (kept entirely inside this file — no
// changes to the four expansion passes):
//
//   1. **Pre-annotate** the authored composition. Every entry of
//      `items: Record<>`, `tweens: []`, `scenes.X.items`, `scenes.X.tweens`,
//      `templates.X.items` and `templates.X.tweens` gets a `__source` sidecar
//      with its file + RFC-6901 jsonPointer + an inferred `originKind`. Also
//      capture two derived maps:
//
//        - `instanceSources`  — root-level `items[X]` that are `$template` or
//          `type: "scene"` instances. After expansion the wrapper-group (for
//          scenes) and prefixed inner items (`X__Y…`) inherit the instance's
//          location with a `template` / `scene` originKind override.
//        - `behaviorSources`  — root-level `tweens[i]` that are `$behavior`
//          blocks. After behavior expansion the emitted tweens have ids
//          `${parentId}__${suffix}` and we recover the block by
//          longest-prefix matching the parentId.
//
//   2. **Run the passes unchanged.** The compose passes already clone via
//      `{ ...item }` / `substitute()` walks that preserve unknown keys, so
//      `__source` on authored entries rides through into the resolved output
//      untouched. Two gaps remain that step 3 fixes via post-derivation: the
//      synthetic scene wrapper group (created fresh by `expandSceneInstance`)
//      and the literal tweens that `expandBehavior` emits both arrive
//      without `__source`.
//
//   3. **Post-derive + override.** Walk the resolved items / tweens. For
//      entries already carrying `__source` (literals, $ref-inlined,
//      scene/template *inner* items), use longest-prefix matching against
//      `instanceSources` to detect that an inner item belongs to a
//      template/scene instance and overlay the instance's source with the
//      stronger originKind ("template" / "scene") — that's what an editor
//      should jump to when the user clicks an inner item. For entries
//      *missing* `__source` (scene wrapper groups, behavior-expanded
//      tweens), the same prefix lookup recovers the right authored location.
//
//   4. **Strip + collect.** Lift every `__source` sidecar into the returned
//      `SourceMap` and remove it from the resolved object, so the validator
//      and engine see byte-identical canonical JSON. This is the contract
//      that makes the feature safe to land under R1 (PRD §07): the renderer
//      still hashes the same input.
//
// When `emitSourceMap` is unset / false, this whole apparatus is bypassed —
// the legacy return shape (`Promise<unknown>`) and zero-allocation
// short-circuit for canonical input are preserved unchanged.

import { expandBehaviors } from "./behaviors.js";
import { resolveImports, type ReadFile } from "./imports.js";
import { expandSceneInstances } from "./scenes.js";
import { expandTemplates } from "./templates.js";
// Side-effect import: registers the v0.3 built-in templates with the global
// registry so any caller that goes through `precompile` (drivers, MCP tools,
// tests) sees them, even if they never reached the public `compose/index.js`.
import "./builtInTemplates.js";
import type { OriginKind, SourceLocation, SourceMap } from "../engine/types.js";

const SOURCE_FIELD = "__source";
const ROOT_FILE_PLACEHOLDER = "<root>";

export interface PrecompileOptions {
  /**
   * Path of the file the JSON came from. Required only when the composition
   * contains `$ref` markers — relative paths resolve against this file's
   * directory. When omitted and `emitSourceMap` is on, the literal string
   * `"<root>"` is used as the source-map file path so authored entries are
   * still addressable.
   */
  sourcePath?: string;
  /**
   * Custom file reader for `$ref` resolution. Defaults to
   * `fs/promises#readFile` with utf-8 encoding (suitable for Node).
   * Pass an in-memory map for browser-side resolution.
   */
  readFile?: ReadFile;
  /**
   * When `true`, switch the return shape to `{ resolved, sourceMap }`. Off
   * by default to preserve the v0.1–v0.4 contract of `Promise<unknown>` for
   * existing callers (drivers, tests, MCP server). Editor consumers opt in.
   */
  emitSourceMap?: boolean;
}

/**
 * Result shape when `emitSourceMap: true`. `resolved` is the canonical v0.1
 * composition (same value the legacy return shape exposes); `sourceMap`
 * carries the authorship trail described in §10.1 of the primitives doc and
 * narrowed to a single uniform shape by editor PRD step 15.
 */
export interface PrecompileResult {
  resolved: unknown;
  sourceMap: SourceMap;
}

/**
 * Run the authoring → canonical compile pipeline:
 *   1. resolveImports        — inline every `$ref`
 *   2. expandTemplates       — replace each `items[*].$template` instance with
 *                              its items + tweens (templates can emit
 *                              `$behavior` blocks which the next passes handle)
 *   3. expandSceneInstances  — lower each `items[*].type === "scene"` into a
 *                              synthetic group + namespaced inner items +
 *                              shifted tweens; merge scene assets into root
 *   4. expandBehaviors       — replace each `{ $behavior }` tween with its
 *                              expansion (now includes scene-internal tweens)
 *
 * Returns the input unchanged when no v0.2/v0.3/v0.4 markers are present, so
 * calling this on a canonical v0.1 composition is a near-zero-cost no-op.
 *
 * Throws if `$ref` markers exist but no `sourcePath` was supplied (relative
 * refs cannot otherwise be resolved).
 *
 * Return shape depends on `options.emitSourceMap`:
 *   - `false` / unset (default): `Promise<unknown>` — the canonical JSON, as
 *     it has always been. Validator and engine consume this directly.
 *   - `true`: `Promise<{ resolved, sourceMap }>` — same canonical JSON plus
 *     an authorship trail keyed by resolved item / tween id.
 */
export async function precompile(
  comp: unknown,
  options?: PrecompileOptions & { emitSourceMap: true },
): Promise<PrecompileResult>;
export async function precompile(
  comp: unknown,
  options?: PrecompileOptions,
): Promise<unknown>;
export async function precompile(
  comp: unknown,
  options: PrecompileOptions = {},
): Promise<unknown> {
  if (options.emitSourceMap === true) {
    return precompileWithSourceMap(comp, options);
  }

  let current = comp;
  if (containsRef(current)) {
    if (options.sourcePath === undefined) {
      throw new Error(
        "precompile: composition contains `$ref` markers but no `sourcePath` was provided. " +
          "Pass `sourcePath` so relative refs can be resolved.",
      );
    }
    const importOptions =
      options.readFile !== undefined ? { readFile: options.readFile } : {};
    current = await resolveImports(current, options.sourcePath, importOptions);
  }
  current = expandTemplates(current);
  current = expandSceneInstances(current);
  current = expandBehaviors(current);
  return current;
}

// ──────────────── Source-map-emitting pipeline ────────────────

async function precompileWithSourceMap(
  comp: unknown,
  options: PrecompileOptions,
): Promise<PrecompileResult> {
  const file = options.sourcePath ?? ROOT_FILE_PLACEHOLDER;

  // Step 1: Annotate authored entries with __source, and capture the
  // instance/block lookup maps the post-derivation step needs.
  const annotated = annotateAuthored(comp, file);
  const instanceSources = collectInstanceSources(comp, file);
  const behaviorSources = collectBehaviorSources(comp, file);

  // Step 2: Run the existing passes. They preserve __source on authored
  // entries via spread/substitute, and produce fresh entries (scene wrapper
  // groups, behavior-expanded tweens) with no __source — both handled below.
  let current: unknown = annotated;
  if (containsRef(current)) {
    if (options.sourcePath === undefined) {
      throw new Error(
        "precompile: composition contains `$ref` markers but no `sourcePath` was provided. " +
          "Pass `sourcePath` so relative refs can be resolved.",
      );
    }
    const importOptions =
      options.readFile !== undefined ? { readFile: options.readFile } : {};
    current = await resolveImports(current, options.sourcePath, importOptions);
  }
  current = expandTemplates(current);
  current = expandSceneInstances(current);
  current = expandBehaviors(current);

  // Step 3 + 4: Extract __source into the SourceMap, derive missing entries
  // from id-prefix matching, and strip __source from the resolved comp.
  return extractAndStrip(current, instanceSources, behaviorSources, file);
}

// ──────────────── Annotation (pre-pass) ────────────────

function annotateAuthored(comp: unknown, file: string): unknown {
  if (!isPlainObject(comp)) return comp;
  const out: Record<string, unknown> = { ...comp };
  if (isPlainObject(out.items)) {
    out.items = annotateItemsMap(out.items, file, "/items", false);
  }
  if (Array.isArray(out.tweens)) {
    out.tweens = annotateTweensArray(out.tweens, file, "/tweens");
  }
  if (isPlainObject(out.scenes)) {
    const newScenes: Record<string, unknown> = {};
    for (const [sid, def] of Object.entries(out.scenes)) {
      if (isPlainObject(def)) {
        newScenes[sid] = annotateSceneOrTemplate(
          def,
          file,
          `/scenes/${encodePtrToken(sid)}`,
          /* annotateNestedSceneInstances */ true,
        );
      } else {
        newScenes[sid] = def;
      }
    }
    out.scenes = newScenes;
  }
  if (isPlainObject(out.templates)) {
    const newTemplates: Record<string, unknown> = {};
    for (const [tid, def] of Object.entries(out.templates)) {
      if (isPlainObject(def)) {
        newTemplates[tid] = annotateSceneOrTemplate(
          def,
          file,
          `/templates/${encodePtrToken(tid)}`,
          /* annotateNestedSceneInstances */ false,
        );
      } else {
        newTemplates[tid] = def;
      }
    }
    out.templates = newTemplates;
  }
  return out;
}

function annotateItemsMap(
  items: Record<string, unknown>,
  file: string,
  basePtr: string,
  // At the root, $template / type:"scene" items are instance markers that the
  // expansion passes consume and remove — their __source originKind reflects
  // what they ARE (template / scene), so the editor can colour them.
  // Inside scene/template *definitions* every item is literal until the
  // outer instance is expanded; the instance-attribution overlay applied in
  // step 3 takes care of that.
  _inDefinition = false,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of Object.keys(items)) {
    const value = items[id];
    if (isPlainObject(value)) {
      out[id] = {
        ...value,
        [SOURCE_FIELD]: {
          file,
          jsonPointer: `${basePtr}/${encodePtrToken(id)}`,
          originKind: inferItemOriginKind(value),
        } satisfies SourceLocation,
      };
    } else {
      out[id] = value;
    }
  }
  return out;
}

function annotateTweensArray(
  tweens: unknown[],
  file: string,
  basePtr: string,
): unknown[] {
  return tweens.map((entry, i) => {
    if (isPlainObject(entry)) {
      return {
        ...entry,
        [SOURCE_FIELD]: {
          file,
          jsonPointer: `${basePtr}/${i}`,
          originKind: inferTweenOriginKind(entry),
        } satisfies SourceLocation,
      };
    }
    return entry;
  });
}

function annotateSceneOrTemplate(
  def: Record<string, unknown>,
  file: string,
  basePtr: string,
  annotateNestedSceneInstances: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...def };
  if (isPlainObject(out.items)) {
    out.items = annotateItemsMap(
      out.items,
      file,
      `${basePtr}/items`,
      !annotateNestedSceneInstances,
    );
  }
  if (Array.isArray(out.tweens)) {
    out.tweens = annotateTweensArray(out.tweens, file, `${basePtr}/tweens`);
  }
  return out;
}

function inferItemOriginKind(item: Record<string, unknown>): OriginKind {
  if (typeof item.$template === "string") return "template";
  if (item.type === "scene") return "scene";
  return "literal";
}

function inferTweenOriginKind(tween: Record<string, unknown>): OriginKind {
  if (typeof tween.$behavior === "string") return "behavior";
  return "literal";
}

// ──────────────── Pre-pass instance / behavior source capture ────────────────

/**
 * Map of every authored root-level `items[X]` that is a template or scene
 * instance → its source location + originKind. The post-pass uses this to
 * attribute inner expansion products (`X__Y`, `X__Y__loop00`, scene wrapper
 * groups) back to the line the user actually authored.
 *
 * Nested scene-in-scene instances are *not* collected here: their resolved id
 * (`outerInstance__innerInstance`) only exists after the outer scene has been
 * expanded, and the longest-prefix match against root instances still gives a
 * useful jump-to-source target (the outer instance, which is where the user
 * edits in any case).
 */
type InstanceSources = Map<
  string,
  { source: SourceLocation; kind: "template" | "scene" }
>;

function collectInstanceSources(comp: unknown, file: string): InstanceSources {
  const out: InstanceSources = new Map();
  if (!isPlainObject(comp)) return out;
  const items = comp.items;
  if (!isPlainObject(items)) return out;
  for (const id of Object.keys(items)) {
    const v = items[id];
    if (!isPlainObject(v)) continue;
    if (typeof v.$template === "string") {
      out.set(id, {
        source: {
          file,
          jsonPointer: `/items/${encodePtrToken(id)}`,
          originKind: "template",
        },
        kind: "template",
      });
    } else if (v.type === "scene") {
      out.set(id, {
        source: {
          file,
          jsonPointer: `/items/${encodePtrToken(id)}`,
          originKind: "scene",
        },
        kind: "scene",
      });
    }
  }
  return out;
}

/**
 * Map of every authored `$behavior` block's derived parent id → its source
 * location. After `expandBehaviors`, emitted tweens have ids of the form
 * `${parentId}__${suffix}` so longest-prefix matching reverses the link.
 *
 * Behavior blocks live in three places: the root `tweens` array, scene-local
 * `tweens` arrays, and template-local `tweens` arrays. Scenes and templates
 * shift / rewrite the block before the behavior pass sees it (see
 * `templates.ts#rewriteTween` and `scenes.ts#rewriteTween` /
 * `scenes.ts#applyTimeMapping`), so we capture the post-expansion parentId
 * patterns *after* templates/scenes run, in a second pass — see
 * `collectPostPassBehaviorSources`.
 */
type BehaviorSources = Map<string /* parentId */, SourceLocation>;

function collectBehaviorSources(comp: unknown, file: string): BehaviorSources {
  const out: BehaviorSources = new Map();
  if (!isPlainObject(comp)) return out;
  const tweens = comp.tweens;
  if (!Array.isArray(tweens)) return out;
  for (let i = 0; i < tweens.length; i += 1) {
    const t = tweens[i];
    if (!isPlainObject(t)) continue;
    if (typeof t.$behavior !== "string") continue;
    const parentId = deriveBehaviorParentIdFromAuthored(t);
    if (parentId === undefined) continue;
    out.set(parentId, {
      file,
      jsonPointer: `/tweens/${i}`,
      originKind: "behavior",
    });
  }
  return out;
}

/**
 * Mirror of `behaviors.ts#deriveParentId` for an authored behavior-block raw
 * record. Returns `undefined` when the block is malformed so the caller can
 * skip it (validation will surface the underlying error during expansion).
 */
function deriveBehaviorParentIdFromAuthored(
  raw: Record<string, unknown>,
): string | undefined {
  if (typeof raw.id === "string" && raw.id.length > 0) return raw.id;
  const target = raw.target;
  const behavior = raw.$behavior;
  const start = raw.start;
  if (
    typeof target !== "string" ||
    typeof behavior !== "string" ||
    typeof start !== "number"
  ) {
    return undefined;
  }
  return `${target}_${behavior}_${start}`;
}

// ──────────────── Post-pass extraction + stripping ────────────────

/**
 * After all expansion passes, walk the resolved comp once more to:
 *   - Lift the `__source` sidecar (if present) into the SourceMap.
 *   - Override / fill in entries that came from template / scene / behavior
 *     expansion, using the pre-pass capture maps + longest-prefix id matching.
 *   - Strip `__source` from items and tweens so the resolved comp is
 *     byte-identical to a vanilla precompile output (R1 mitigation).
 *
 * The walk also rebuilds the `items` and `tweens` containers as fresh objects
 * so the original input (which still references `__source`-tagged values via
 * the annotateAuthored copy) stays untouched.
 */
function extractAndStrip(
  resolved: unknown,
  instanceSources: InstanceSources,
  behaviorSources: BehaviorSources,
  fallbackFile: string,
): PrecompileResult {
  if (!isPlainObject(resolved)) {
    return {
      resolved,
      sourceMap: { items: {}, tweens: {} },
    };
  }

  const sourceMap: SourceMap = { items: {}, tweens: {} };
  const out: Record<string, unknown> = { ...resolved };

  // Sorted instance ids, longest first — longest-prefix matching for nested
  // expansions (`outer__inner__leaf` should attribute to `outer__inner` when
  // present, falling back to `outer`).
  const instanceIdsByLen = [...instanceSources.keys()].sort(
    (a, b) => b.length - a.length,
  );
  const behaviorIdsByLen = [...behaviorSources.keys()].sort(
    (a, b) => b.length - a.length,
  );

  if (isPlainObject(out.items)) {
    const newItems: Record<string, unknown> = {};
    for (const id of Object.keys(out.items)) {
      const value = out.items[id];
      if (isPlainObject(value)) {
        const authored = value[SOURCE_FIELD] as SourceLocation | undefined;
        const stripped: Record<string, unknown> = { ...value };
        delete stripped[SOURCE_FIELD];
        newItems[id] = stripped;
        sourceMap.items[id] = resolveItemSource(
          id,
          authored,
          instanceSources,
          instanceIdsByLen,
          fallbackFile,
        );
      } else {
        newItems[id] = value;
      }
    }
    out.items = newItems;
  }

  if (Array.isArray(out.tweens)) {
    const newTweens: unknown[] = [];
    for (const entry of out.tweens) {
      if (isPlainObject(entry)) {
        const authored = entry[SOURCE_FIELD] as SourceLocation | undefined;
        const stripped: Record<string, unknown> = { ...entry };
        delete stripped[SOURCE_FIELD];
        newTweens.push(stripped);
        const tweenId = typeof entry.id === "string" ? entry.id : undefined;
        if (tweenId !== undefined) {
          sourceMap.tweens[tweenId] = resolveTweenSource(
            tweenId,
            authored,
            behaviorSources,
            behaviorIdsByLen,
            instanceSources,
            instanceIdsByLen,
            fallbackFile,
          );
        }
      } else {
        newTweens.push(entry);
      }
    }
    out.tweens = newTweens;
  }

  return { resolved: out, sourceMap };
}

/**
 * Decide which SourceLocation belongs on a resolved item. Priority order:
 *
 *   1. If the id matches a root template/scene instance prefix, the EDITOR
 *      jump-target is that instance — overlay its location with the matching
 *      originKind. We pick this over any authored `__source` carried in via
 *      the inner template/scene definition because the user edits at the
 *      instance level (e.g. clicking a template-emitted shape jumps to the
 *      template instance line in their composition, not into the template
 *      registry / library).
 *   2. Otherwise, if the entry has an authored `__source` (literal items,
 *      $ref-inlined items), use it as-is.
 *   3. Otherwise, fall back to a `literal` location with no specific
 *      pointer — used for entries the engine synthesizes that we have no
 *      better attribution for.
 *
 * The `$bg` synthetic background rect that scene expansion inserts gets
 * `originKind: "background"` here even though step 1 would assign "scene":
 * detecting it by id suffix keeps the editor's "where did this rect come
 * from?" answer honest.
 */
function resolveItemSource(
  id: string,
  authored: SourceLocation | undefined,
  instanceSources: InstanceSources,
  instanceIdsByLen: ReadonlyArray<string>,
  fallbackFile: string,
): SourceLocation {
  const prefixMatch = findInstancePrefix(id, instanceSources, instanceIdsByLen);
  if (prefixMatch !== undefined) {
    const isBackgroundRect = id.endsWith("__$bg");
    return {
      file: prefixMatch.source.file,
      jsonPointer: prefixMatch.source.jsonPointer,
      originKind: isBackgroundRect ? "background" : prefixMatch.kind,
    };
  }
  if (authored !== undefined) return authored;
  return {
    file: fallbackFile,
    jsonPointer: `/items/${encodePtrToken(id)}`,
    originKind: "literal",
  };
}

function resolveTweenSource(
  tweenId: string,
  authored: SourceLocation | undefined,
  behaviorSources: BehaviorSources,
  behaviorIdsByLen: ReadonlyArray<string>,
  instanceSources: InstanceSources,
  instanceIdsByLen: ReadonlyArray<string>,
  fallbackFile: string,
): SourceLocation {
  // 1. Behavior-expanded tweens have ids `${parentId}__${suffix}`. When the
  // parent block was authored at the *root*, longest-prefix matching against
  // `behaviorSources` recovers the block's location. We check this first
  // because a behavior block authored under a template/scene gets emitted as
  // a *block* by the templates / scenes pass with target/start rewritten,
  // and behaviors expansion runs after — so the resulting parentId is rooted
  // in the instance prefix, and behaviorSources won't carry it. That case
  // falls through to step 2.
  for (const parentId of behaviorIdsByLen) {
    if (tweenId === parentId || tweenId.startsWith(`${parentId}__`)) {
      const src = behaviorSources.get(parentId);
      if (src !== undefined) return src;
    }
  }
  // 2. If the tween id is prefixed by a known template/scene instance id,
  // the user authored a tween (literal or $behavior) *inside* that
  // definition. The editor jump-target is the outer instance line.
  const prefixMatch = findInstancePrefix(tweenId, instanceSources, instanceIdsByLen);
  if (prefixMatch !== undefined) {
    return {
      file: prefixMatch.source.file,
      jsonPointer: prefixMatch.source.jsonPointer,
      originKind: prefixMatch.kind,
    };
  }
  // 3. Otherwise rely on the authored __source carried through the passes
  // (literal root tweens, $ref-inlined tweens).
  if (authored !== undefined) return authored;
  return {
    file: fallbackFile,
    jsonPointer: `/tweens/${encodePtrToken(tweenId)}`,
    originKind: "literal",
  };
}

function findInstancePrefix(
  id: string,
  instanceSources: InstanceSources,
  instanceIdsByLen: ReadonlyArray<string>,
):
  | { source: SourceLocation; kind: "template" | "scene" }
  | undefined {
  for (const instanceId of instanceIdsByLen) {
    if (id === instanceId) {
      // The wrapper / placeholder item under the instance id itself. For
      // scenes this is the synthetic group; for templates the original
      // single-entry slot is replaced by the expansion — when present at all
      // it'd be a name collision the validator already catches.
      return instanceSources.get(instanceId);
    }
    if (id.startsWith(`${instanceId}__`)) {
      return instanceSources.get(instanceId);
    }
  }
  return undefined;
}

// ──────────────── Shared helpers ────────────────

function containsRef(node: unknown): boolean {
  if (Array.isArray(node)) {
    for (const child of node) {
      if (containsRef(child)) return true;
    }
    return false;
  }
  if (isPlainObject(node)) {
    if (typeof node.$ref === "string") return true;
    for (const v of Object.values(node)) {
      if (containsRef(v)) return true;
    }
  }
  return false;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// RFC 6901 token encoder. Used to build pointers into the authored JSON.
function encodePtrToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}
