// Behavior registry — primitive P2 from COMPOSITION_PRIMITIVES.md §6.
//
// A *behavior* is a named, parameterized bundle of tweens. The 11 built-ins
// listed in §6.3 are pure functions `(args) → Tween[]` whose output is
// deterministic for the same inputs. Two callers exercise this:
//
//   - `apply_behavior` (MCP tool, §6.7) — expand inline into the store.
//   - `expandBehaviors` (compile pass, §10) — walk an authored composition's
//     `tweens` array and replace every `{ "$behavior": ... }` entry with the
//     concrete tweens it represents.
//
// Both go through the same `expandBehavior(spec)` entrypoint so behavior
// semantics live in exactly one place.
//
// Ids (§6.4): the parent block has an id (explicit, or derived from
// `${target}_${behavior}_${start}`). Each emitted tween gets a stable
// `${parentId}__${suffix}` id where `suffix` is fixed per behavior step.

import type { Easing } from "../easings/index.js";
import { MCPToolError } from "../engine/errors.js";
import type { Tween } from "../schema/types.js";
import { OVERLAP_EPS } from "../schema/validator.js";
import { substitute, type SubstitutionContext } from "./params.js";
import { expandRepeatTweens, isRepeatBlock, withRepeatBudget } from "./repeat.js";

/**
 * Behavior-expansion semantics version. Bumped when a *registered* behavior's
 * emitted tweens change in a way that alters existing renders (not merely
 * when a new behavior/param is added). See CHANGELOG.md.
 *
 *   v1 → v2: `kenburns` now emits `scaleX` + `scaleY` (was `scaleX`-only,
 *   which rendered a horizontal stretch instead of a zoom).
 */
export const BEHAVIOR_EXPANSION_VERSION = 2;

// ──────────────── Public types ────────────────

export type BehaviorParamType =
  | "number"
  | "string"
  | "color"
  | "colorArray"
  | "axis";

export interface BehaviorParamDescriptor {
  name: string;
  type: BehaviorParamType;
  required: boolean;
  description: string;
  default?: unknown;
}

export interface BehaviorDescriptor {
  name: string;
  description: string;
  params: BehaviorParamDescriptor[];
  /**
   * Suffixes appended to the parent block id, in expansion order. *Derived*
   * for tween-body behaviors (REPEAT_EXPRESSIONS_DESIGN.md §5.2 — a
   * caller-supplied `produces` on a body-carrying descriptor is ignored
   * rather than trusted on the honor system).
   */
  produces: ReadonlyArray<string> | "dynamic";
  /**
   * Executable body (v1.1 S19, spec §6.6). Each entry is a tween written
   * against the `${params.X}` / `${$.X}` substitution syntax templates and
   * scenes already use; `$repeat` blocks are allowed. A descriptor that
   * carries one expands for real — a descriptor without one stays catalog
   * metadata (`expandBehavior` throws E_BEHAVIOR_UNKNOWN unless it shadows a
   * built-in of the same name). Stored as opaque JSON; validated at expansion
   * time, where param values are known.
   */
  tweens?: ReadonlyArray<unknown>;
  /**
   * Reserved for the §16-O9 `name@version` library lock. Stored and echoed
   * back, never interpreted in v1.1.
   */
  version?: string;
  /**
   * Derived, read-only: whether `apply_behavior` will expand this name (a
   * body of its own, or a built-in expansion it shadows). Never an input —
   * `registerBehavior` recomputes it.
   */
  executable?: boolean;
}

export interface BehaviorBlock {
  /** Behavior name from the registry. */
  behavior: string;
  /** Item id the behavior animates. */
  target: string;
  /** Absolute start time on the parent timeline. */
  start: number;
  /** Total duration covered by the behavior's tweens combined. */
  duration: number;
  /** Optional easing applied to every emitted tween that doesn't pin its own. */
  easing?: Easing;
  /** Per-behavior parameter map. See each behavior's descriptor. */
  params?: Record<string, unknown>;
  /** Optional explicit parent id. If absent, derived from target+name+start. */
  id?: string;
}

// ──────────────── Internal expansion contract ────────────────

interface ExpandContext {
  parentId: string;
  block: BehaviorBlock;
  duration: number;
  start: number;
  easing: Easing | undefined;
  params: Record<string, unknown>;
}

interface RawTween {
  suffix: string;
  property: string;
  from: number | string;
  to: number | string;
  start: number;
  duration: number;
  easing?: Easing;
  /** Tween-body behaviors may retarget a companion item; defaults to the block's target. */
  target?: string;
}

type BehaviorExpand = (ctx: ExpandContext) => RawTween[];

interface BehaviorEntry {
  descriptor: BehaviorDescriptor;
  /** Built-ins carry a code expansion; user/library descriptors with a
   * `tweens` body get one synthesized; bodyless registrations have none. */
  expand?: BehaviorExpand;
}

// Two layers, not one map (BUGS.md 2.1). `BUILTINS` is written once at module
// load by the `register()` calls below and never mutated again; `OVERLAY`
// holds every user/library registration. Lookups read the overlay first, so
// library JSON still shadows a built-in name — but dropping that overlay entry
// (a watcher delete, a library reload) uncovers the built-in again instead of
// deleting it for the lifetime of the process.
const BUILTINS = new Map<string, BehaviorEntry>();
const OVERLAY = new Map<string, BehaviorEntry>();

function register(entry: BehaviorEntry): void {
  BUILTINS.set(entry.descriptor.name, entry);
}

function lookupEntry(name: string): BehaviorEntry | undefined {
  return OVERLAY.get(name) ?? BUILTINS.get(name);
}

/** Catalog view of an entry: no body, plus the derived `executable` flag. */
function publicDescriptor(entry: BehaviorEntry): BehaviorDescriptor {
  const d = entry.descriptor;
  const out: BehaviorDescriptor = {
    name: d.name,
    description: d.description,
    params: d.params.map((p) => ({ ...p })),
    produces: typeof d.produces === "string" ? d.produces : [...d.produces],
    executable: entry.expand !== undefined,
  };
  if (d.version !== undefined) out.version = d.version;
  return out;
}

// ──────────────── Public API ────────────────

/**
 * Validate + clone a descriptor into the canonical shape stored in the
 * registry (and in the MCP store's session record). Derives `produces` from
 * the body when there is one. Throws E_INVALID_VALUE on a malformed shape.
 */
export function normalizeBehaviorDescriptor(
  descriptor: BehaviorDescriptor,
): BehaviorDescriptor {
  if (typeof descriptor.name !== "string" || descriptor.name.length === 0) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      "Behavior descriptor is missing a non-empty name.",
    );
  }
  const tweens = readTweenBodies(descriptor.name, descriptor.tweens);
  const out: BehaviorDescriptor = {
    name: descriptor.name,
    description: descriptor.description ?? "",
    params: (descriptor.params ?? []).map((p) => ({ ...p })),
    produces:
      tweens !== undefined
        ? deriveProduces(tweens)
        : typeof descriptor.produces === "string"
          ? descriptor.produces
          : [...(descriptor.produces ?? [])],
  };
  if (tweens !== undefined) out.tweens = tweens;
  if (descriptor.version !== undefined) {
    if (typeof descriptor.version !== "string" || descriptor.version.length === 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Behavior "${descriptor.name}" version must be a non-empty string.`,
      );
    }
    out.version = descriptor.version;
  }
  return out;
}

/**
 * Register a user-authored behavior (library `*.behavior.json`, or
 * `define_user_behavior` at composition scope) into the overlay layer.
 *
 * A descriptor carrying `tweens` is *executable*: an `expand` closure over the
 * body is synthesized here, and `apply_behavior` expands it like a built-in.
 * A descriptor without one inherits the expansion of whatever it shadows, so
 * library JSON can still override the description/params of e.g. `fadeIn`
 * without breaking its semantics; shadowing nothing leaves it catalog-only.
 */
export function registerBehavior(descriptor: BehaviorDescriptor): void {
  const cloned = normalizeBehaviorDescriptor(descriptor);
  const next: BehaviorEntry = { descriptor: cloned };
  if (cloned.tweens !== undefined) {
    next.expand = makeTweenBodyExpand(cloned);
  } else {
    const existing = lookupEntry(cloned.name);
    if (existing && existing.expand) next.expand = existing.expand;
  }
  OVERLAY.set(cloned.name, next);
}

/**
 * Drop an overlay registration. Built-ins live in a separate base layer, so
 * removing an entry that *shadowed* one uncovers the built-in again instead of
 * deleting it (BUGS.md 2.1 — the library watcher's reload diff hits this every
 * time a shadowing `*.behavior.json` is deleted). Returns false when the name
 * had no overlay entry; built-ins themselves can't be unregistered.
 */
export function unregisterBehavior(name: string): boolean {
  return OVERLAY.delete(name);
}

export function listBehaviors(): BehaviorDescriptor[] {
  // Built-ins first, in registration order; an overlay entry replaces the
  // built-in in place (Map.set keeps the original slot) and new names append.
  const merged = new Map<string, BehaviorEntry>();
  for (const [name, entry] of BUILTINS) merged.set(name, entry);
  for (const [name, entry] of OVERLAY) merged.set(name, entry);
  return Array.from(merged.values()).map(publicDescriptor);
}

export function getBehaviorDescriptor(name: string): BehaviorDescriptor | undefined {
  const entry = lookupEntry(name);
  return entry ? publicDescriptor(entry) : undefined;
}

/** Full definition including the body — for callers that re-expand it. */
export function getBehaviorDefinition(name: string): BehaviorDescriptor | undefined {
  const entry = lookupEntry(name);
  return entry ? normalizeBehaviorDescriptor(entry.descriptor) : undefined;
}

export function hasBehavior(name: string): boolean {
  return OVERLAY.has(name) || BUILTINS.has(name);
}

export interface ExpandBehaviorOptions {
  /**
   * Session-scoped definitions that shadow the process-global registry, keyed
   * by name. `apply_behavior` passes the MCP store's `define_user_behavior`
   * record here so two sessions on one backend never see each other's
   * definitions (the same split `expandTemplate(options.templates)` uses).
   */
  behaviors?: Record<string, BehaviorDescriptor>;
}

/** Resolve a name against session definitions first, then the registry. */
function resolveEntry(
  name: string,
  options: ExpandBehaviorOptions,
): BehaviorEntry | undefined {
  const session = options.behaviors?.[name];
  if (session === undefined) return lookupEntry(name);
  const normalized = normalizeBehaviorDescriptor(session);
  if (normalized.tweens !== undefined) {
    return { descriptor: normalized, expand: makeTweenBodyExpand(normalized) };
  }
  // Bodyless session entry: inherit the registry expansion of the same name,
  // mirroring registerBehavior — retitling `fadeIn` mustn't break it.
  const entry: BehaviorEntry = { descriptor: normalized };
  const base = lookupEntry(name);
  if (base && base.expand) entry.expand = base.expand;
  return entry;
}

/**
 * Expand a single behavior block into concrete tweens with stable ids.
 * Throws MCPToolError on unknown name / missing or wrongly-typed params.
 */
export function expandBehavior(
  block: BehaviorBlock,
  options: ExpandBehaviorOptions = {},
): Tween[] {
  // One `$repeat` budget per block, or the enclosing compile's.
  return withRepeatBudget(() => expandBehaviorInScope(block, options));
}

function expandBehaviorInScope(block: BehaviorBlock, options: ExpandBehaviorOptions): Tween[] {
  const entry = resolveEntry(block.behavior, options);
  if (!entry) {
    throw new MCPToolError(
      "E_BEHAVIOR_UNKNOWN",
      `Unknown behavior "${block.behavior}".`,
      "Call list_behaviors to see available names.",
    );
  }
  if (!entry.expand) {
    throw new MCPToolError(
      "E_BEHAVIOR_UNKNOWN",
      `Behavior "${block.behavior}" is registered as catalog metadata without a \`tweens\` body.`,
      "Add a `tweens` array to the definition (see define_user_behavior) so it can expand, or use a built-in behavior name.",
    );
  }
  if (!Number.isFinite(block.duration) || block.duration <= 0) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Behavior "${block.behavior}" requires a positive duration.`,
    );
  }
  if (!Number.isFinite(block.start) || block.start < 0) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Behavior "${block.behavior}" requires a non-negative start.`,
    );
  }
  const params = block.params ?? {};
  const parentId = deriveParentId(block);
  const ctx: ExpandContext = {
    parentId,
    block,
    duration: block.duration,
    start: block.start,
    easing: block.easing,
    params,
  };
  const raw = entry.expand(ctx);
  const tweens: Tween[] = raw.map((r) => {
    const t: Tween = {
      id: `${parentId}__${r.suffix}`,
      target: r.target ?? block.target,
      property: r.property,
      from: r.from,
      to: r.to,
      start: r.start,
      duration: r.duration,
    };
    const e = r.easing ?? block.easing;
    if (e !== undefined) t.easing = e;
    return t;
  });
  return tweens;
}

/**
 * Compile-time pass — replace every `{ "$behavior": ... }` entry in a
 * composition's `tweens` array with its expansion.
 *
 * Reads the optional top-level `behaviors: { name: descriptor }` block
 * (COMPOSITION_PRIMITIVES.md §11, L-1) and registers those definitions **for
 * the duration of this compile only** — nothing is written to the process
 * registry, so two compositions that define the same name never see each
 * other's version and a composition that defines and uses an executable
 * behavior renders from `davidup render` with no session state. Lookup order
 * is composition block → `options.behaviors` (an MCP session's
 * `define_user_behavior` records) → the registry overlay → the built-ins:
 * the most local scope wins, matching `templates`.
 *
 * Pure function; does not touch the input. Other top-level keys pass through
 * unchanged, and `behaviors` is dropped (compile-time only, like `templates`
 * and `scenes`) so the result is a v0.1-shaped composition with no
 * `$behavior` markers anywhere in `tweens`.
 */
export function expandBehaviors(
  comp: unknown,
  options: ExpandBehaviorOptions = {},
): unknown {
  if (!isPlainObject(comp)) return comp;
  const scoped = readCompositionBehaviors(comp);
  const effective: ExpandBehaviorOptions =
    scoped === undefined
      ? options
      : { behaviors: { ...options.behaviors, ...scoped } };
  const rawTweens = (comp as { tweens?: unknown }).tweens;
  if (!Array.isArray(rawTweens)) return scoped === undefined ? comp : withoutBehaviors(comp);
  let touched = false;
  const out: unknown[] = [];
  for (const entry of rawTweens) {
    if (isBehaviorBlock(entry)) {
      touched = true;
      const block = readBehaviorBlock(entry);
      const expanded = expandBehavior(block, effective);
      for (const t of expanded) out.push(t);
    } else {
      out.push(entry);
    }
  }
  if (!touched) return scoped === undefined ? comp : withoutBehaviors(comp);
  const next = scoped === undefined ? { ...(comp as Record<string, unknown>) } : withoutBehaviors(comp);
  next.tweens = out;
  return next;
}

/**
 * Read + normalize the composition-scoped `behaviors` block. Returns
 * `undefined` when the key is absent (the overwhelmingly common case — the
 * caller then skips cloning entirely). The map key is the behavior name a
 * `$behavior` reference must use; a `name` inside the descriptor is ignored
 * so the two can never disagree.
 */
function readCompositionBehaviors(
  comp: Record<string, unknown>,
): Record<string, BehaviorDescriptor> | undefined {
  const raw = comp.behaviors;
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      "`behaviors` must be an object keyed by behavior name.",
    );
  }
  const out: Record<string, BehaviorDescriptor> = {};
  // Sorted for §10.2 determinism (normalization can throw, so the *first*
  // malformed entry reported must not depend on key insertion order).
  for (const name of Object.keys(raw).sort()) {
    const defRaw = raw[name];
    if (!isPlainObject(defRaw)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Behavior definition "${name}" must be an object.`,
      );
    }
    out[name] = normalizeBehaviorDescriptor({
      ...defRaw,
      name,
    } as unknown as BehaviorDescriptor);
  }
  return out;
}

function withoutBehaviors(comp: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(comp)) {
    if (k !== "behaviors") out[k] = v;
  }
  return out;
}

// ──────────────── Helpers ────────────────

function deriveParentId(block: BehaviorBlock): string {
  if (block.id !== undefined && block.id.length > 0) return block.id;
  return `${block.target}_${block.behavior}_${idNumber(block.start)}`;
}

// Ids are read by humans (and re-typed as MCP addressing keys), so a `start`
// that arrived with FP noise from an upstream chained sum (e.g.
// 4.8999999999999995 instead of 4.9) shouldn't be embedded verbatim. Round to
// microsecond precision — far finer than any authored timing — before
// formatting, purely for id text; the tween's numeric `start` is untouched.
function idNumber(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// Divide [start, start+duration] into `segments` equal pieces as an explicit
// breakpoint array (rather than each tween independently computing its own
// `start + i*step`). Two tweens that each recomputed `start + i*step` and
// `start + (i+1)*step` from scratch can disagree in the last bit or two
// (floating-point addition isn't associative), so segment i's `start+duration`
// wouldn't bit-match segment i+1's `start` — exactly the E_TWEEN_OVERLAP false
// positive this fixes. Deriving every tween's start/duration from the same
// breakpoints array guarantees prev.start + prev.duration === next.start.
function segmentBreakpoints(
  start: number,
  duration: number,
  segments: number,
): number[] {
  const step = duration / segments;
  const points: number[] = [start];
  for (let i = 1; i < segments; i++) points.push(start + i * step);
  // Pin the final point to start+duration exactly, rather than start+segments*step,
  // so the total span always matches the requested duration bit-for-bit.
  points.push(start + duration);
  return points;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isBehaviorBlock(v: unknown): v is Record<string, unknown> {
  return isPlainObject(v) && typeof v.$behavior === "string";
}

export function readBehaviorBlock(raw: Record<string, unknown>): BehaviorBlock {
  const behavior = raw.$behavior;
  if (typeof behavior !== "string" || behavior.length === 0) {
    throw new MCPToolError(
      "E_BEHAVIOR_UNKNOWN",
      "Behavior block missing `$behavior` name.",
    );
  }
  const target = raw.target;
  if (typeof target !== "string" || target.length === 0) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Behavior "${behavior}" missing required "target".`,
    );
  }
  const start = raw.start;
  if (typeof start !== "number") {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Behavior "${behavior}" missing required numeric "start".`,
    );
  }
  const duration = raw.duration;
  if (typeof duration !== "number") {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Behavior "${behavior}" missing required numeric "duration".`,
    );
  }
  const block: BehaviorBlock = { behavior, target, start, duration };
  if (raw.easing !== undefined) {
    // Shape check only — the name / bezier / steps contents are validated by
    // TweenSchema once the emitted tweens reach the composition.
    if (typeof raw.easing !== "string" && !isPlainObject(raw.easing)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Behavior "${behavior}" easing must be an easing name, { bezier: [x1, y1, x2, y2] } or { steps: n }.`,
      );
    }
    block.easing = raw.easing as Easing;
  }
  if (raw.params !== undefined) {
    if (!isPlainObject(raw.params)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Behavior "${behavior}" params must be an object.`,
      );
    }
    block.params = raw.params;
  }
  if (raw.id !== undefined) {
    if (typeof raw.id !== "string" || raw.id.length === 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Behavior "${behavior}" id must be a non-empty string.`,
      );
    }
    block.id = raw.id;
  }
  return block;
}

function readNumberParam(
  params: Record<string, unknown>,
  name: string,
  behavior: string,
  defaultValue: number,
): number {
  const v = params[name];
  if (v === undefined) return defaultValue;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new MCPToolError(
      "E_BEHAVIOR_PARAM_TYPE",
      `Behavior "${behavior}" param "${name}" must be a finite number.`,
    );
  }
  return v;
}

function requireNumberParam(
  params: Record<string, unknown>,
  name: string,
  behavior: string,
): number {
  const v = params[name];
  if (v === undefined) {
    throw new MCPToolError(
      "E_BEHAVIOR_PARAM_MISSING",
      `Behavior "${behavior}" requires param "${name}".`,
    );
  }
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new MCPToolError(
      "E_BEHAVIOR_PARAM_TYPE",
      `Behavior "${behavior}" param "${name}" must be a finite number.`,
    );
  }
  return v;
}

function requireAxisParam(
  params: Record<string, unknown>,
  name: string,
  behavior: string,
): "x" | "y" {
  const v = params[name];
  if (v === undefined) {
    throw new MCPToolError(
      "E_BEHAVIOR_PARAM_MISSING",
      `Behavior "${behavior}" requires param "${name}".`,
    );
  }
  if (v !== "x" && v !== "y") {
    throw new MCPToolError(
      "E_BEHAVIOR_PARAM_TYPE",
      `Behavior "${behavior}" param "${name}" must be "x" or "y".`,
    );
  }
  return v;
}

function readAxisParam(
  params: Record<string, unknown>,
  name: string,
  behavior: string,
  defaultValue: "x" | "y",
): "x" | "y" {
  const v = params[name];
  if (v === undefined) return defaultValue;
  if (v !== "x" && v !== "y") {
    throw new MCPToolError(
      "E_BEHAVIOR_PARAM_TYPE",
      `Behavior "${behavior}" param "${name}" must be "x" or "y".`,
    );
  }
  return v;
}

function requireStringParam(
  params: Record<string, unknown>,
  name: string,
  behavior: string,
): string {
  const v = params[name];
  if (v === undefined) {
    throw new MCPToolError(
      "E_BEHAVIOR_PARAM_MISSING",
      `Behavior "${behavior}" requires param "${name}".`,
    );
  }
  if (typeof v !== "string" || v.length === 0) {
    throw new MCPToolError(
      "E_BEHAVIOR_PARAM_TYPE",
      `Behavior "${behavior}" param "${name}" must be a non-empty string.`,
    );
  }
  return v;
}

function requireColorArrayParam(
  params: Record<string, unknown>,
  name: string,
  behavior: string,
  minLength: number,
): string[] {
  const v = params[name];
  if (v === undefined) {
    throw new MCPToolError(
      "E_BEHAVIOR_PARAM_MISSING",
      `Behavior "${behavior}" requires param "${name}".`,
    );
  }
  if (!Array.isArray(v)) {
    throw new MCPToolError(
      "E_BEHAVIOR_PARAM_TYPE",
      `Behavior "${behavior}" param "${name}" must be an array of color strings.`,
    );
  }
  if (v.length < minLength) {
    throw new MCPToolError(
      "E_BEHAVIOR_PARAM_TYPE",
      `Behavior "${behavior}" param "${name}" must have at least ${minLength} entries.`,
    );
  }
  for (const c of v) {
    if (typeof c !== "string" || c.length === 0) {
      throw new MCPToolError(
        "E_BEHAVIOR_PARAM_TYPE",
        `Behavior "${behavior}" param "${name}" must be an array of non-empty color strings.`,
      );
    }
  }
  return [...(v as string[])];
}

function readColorParam(
  params: Record<string, unknown>,
  name: string,
  behavior: string,
  defaultValue: string,
): string {
  const v = params[name];
  if (v === undefined) return defaultValue;
  if (typeof v !== "string" || v.length === 0) {
    throw new MCPToolError(
      "E_BEHAVIOR_PARAM_TYPE",
      `Behavior "${behavior}" param "${name}" must be a non-empty color string.`,
    );
  }
  return v;
}

// ──────────────── Tween-body behaviors (v1.1 S19, spec §6.6) ────────────────
//
// A user/library definition ships a `tweens` array written against the same
// `${params.X}` / `${$.X}` substitution the template and scene layers use, so
// agents and the Library can publish real reusable motion instead of catalog
// cards. Times are **absolute** — the published §6.6 shape writes
// `"start": "${$.start + 0.2}"`, and an omitted `start` defaults to `$.start`
// — so library JSON already authored against the spec expands as written.
//
// The `$` context is: `start` / `duration` / `end` of the behavior block, plus
// `target` (the item it was applied to, for companion-item tweens).

/** Validate + clone a `tweens` body. `undefined` in, `undefined` out. */
function readTweenBodies(
  name: string,
  tweens: BehaviorDescriptor["tweens"],
): ReadonlyArray<unknown> | undefined {
  if (tweens === undefined) return undefined;
  if (!Array.isArray(tweens)) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Behavior "${name}" tweens must be an array.`,
      "Each entry is a tween object, or a `$repeat` block producing tweens.",
    );
  }
  for (let i = 0; i < tweens.length; i += 1) {
    if (!isPlainObject(tweens[i])) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Behavior "${name}" tweens[${i}] must be an object.`,
      );
    }
  }
  // Bodies are JSON (library files, MCP arguments) — a structural clone keeps
  // the registry immune to later mutation by the caller.
  return JSON.parse(JSON.stringify(tweens)) as ReadonlyArray<unknown>;
}

/**
 * `produces` for a body-carrying descriptor, derived rather than trusted. A
 * `$repeat` block or an interpolated suffix makes the suffix list
 * param-dependent, so the whole thing reports "dynamic".
 */
function deriveProduces(
  tweens: ReadonlyArray<unknown>,
): ReadonlyArray<string> | "dynamic" {
  const out: string[] = [];
  for (let i = 0; i < tweens.length; i += 1) {
    const entry = tweens[i];
    if (isRepeatBlock(entry)) return "dynamic";
    const suffix = (entry as Record<string, unknown>).suffix;
    if (typeof suffix === "string" && suffix.length > 0) {
      if (suffix.includes("${")) return "dynamic";
      out.push(suffix);
    } else {
      out.push(pad(i, tweens.length));
    }
  }
  return out;
}

function makeTweenBodyExpand(def: BehaviorDescriptor): BehaviorExpand {
  return (ctx) => expandTweenBodies(def, ctx);
}

function expandTweenBodies(def: BehaviorDescriptor, ctx: ExpandContext): RawTween[] {
  const bodies = def.tweens ?? [];
  const sctx: SubstitutionContext = {
    params: resolveBehaviorParams(def, ctx.params),
    meta: {
      start: ctx.start,
      duration: ctx.duration,
      end: ctx.start + ctx.duration,
      target: ctx.block.target,
    },
    paramTypes: Object.fromEntries(def.params.map((p) => [p.name, p.type])),
  };
  const path = `behaviors.${def.name}.tweens`;
  // `$repeat` entries come back already substituted (the repeat expander holds
  // the loop variable); literal entries still need their own pass — same split
  // `expandTemplate` uses.
  const expanded = expandRepeatTweens([...bodies], sctx, path);
  const out: RawTween[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < expanded.length; i += 1) {
    const entry = expanded[i] as (typeof expanded)[number];
    const where = `${path}[${i}]`;
    const value = entry.generated
      ? entry.value
      : substitute(entry.value, sctx, where);
    out.push(readTweenBody(def.name, value, i, expanded.length, ctx, seen, where));
  }
  ensureNoInternalOverlap(def.name, out, ctx.block.target);
  return out;
}

function readTweenBody(
  name: string,
  value: unknown,
  index: number,
  total: number,
  ctx: ExpandContext,
  seen: Set<string>,
  where: string,
): RawTween {
  if (!isPlainObject(value)) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Behavior "${name}" ${where} must be an object.`,
    );
  }
  const property = value.property;
  if (typeof property !== "string" || property.length === 0) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Behavior "${name}" ${where} requires a non-empty "property".`,
      'e.g. "transform.opacity", "transform.x", "tint".',
    );
  }
  const from = readEndpoint(name, where, "from", value.from);
  const to = readEndpoint(name, where, "to", value.to);

  // Absolute times (§6.6): default `start` is the block's own start, and the
  // default `duration` runs to the block's end, so the common "fill the
  // block" tween needs neither field.
  const blockEnd = ctx.start + ctx.duration;
  let start = ctx.start;
  if (value.start !== undefined) {
    if (typeof value.start !== "number" || !Number.isFinite(value.start)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Behavior "${name}" ${where} start must be a finite number (absolute time; use \${$.start} as the base).`,
      );
    }
    if (value.start < 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Behavior "${name}" ${where} start must be non-negative, got ${value.start}.`,
      );
    }
    start = value.start;
  }
  let duration = blockEnd - start;
  if (value.duration !== undefined) {
    if (typeof value.duration !== "number" || !Number.isFinite(value.duration)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Behavior "${name}" ${where} duration must be a finite number.`,
      );
    }
    duration = value.duration;
  }
  if (duration <= 0) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Behavior "${name}" ${where} resolved to a non-positive duration (${duration}).`,
      value.duration === undefined
        ? `The default duration runs from this tween's start to the block end (${blockEnd}); give the tween an explicit duration.`
        : "Give the tween a positive duration.",
    );
  }

  const raw: RawTween = {
    suffix: readSuffix(name, value.suffix, index, total, seen, where),
    property,
    from,
    to,
    start,
    duration,
  };
  if (value.target !== undefined) {
    if (typeof value.target !== "string" || value.target.length === 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Behavior "${name}" ${where} target must be a non-empty string.`,
      );
    }
    raw.target = value.target;
  }
  if (value.easing !== undefined) {
    // Shape check only — names / bezier / steps contents are validated by
    // TweenSchema once the emitted tweens reach the composition.
    if (typeof value.easing !== "string" && !isPlainObject(value.easing)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Behavior "${name}" ${where} easing must be an easing name, { bezier: [x1, y1, x2, y2] } or { steps: n }.`,
      );
    }
    raw.easing = value.easing as Easing;
  }
  return raw;
}

function readEndpoint(
  name: string,
  where: string,
  field: "from" | "to",
  v: unknown,
): number | string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Behavior "${name}" ${where} ${field} must be a finite number.`,
      );
    }
    return v;
  }
  if (typeof v === "string" && v.length > 0) return v;
  throw new MCPToolError(
    "E_INVALID_VALUE",
    `Behavior "${name}" ${where} requires "${field}" (a number, or a color string).`,
  );
}

function readSuffix(
  name: string,
  v: unknown,
  index: number,
  total: number,
  seen: Set<string>,
  where: string,
): string {
  let suffix: string;
  if (v === undefined) {
    suffix = pad(index, total);
  } else if (typeof v === "string" && v.length > 0) {
    suffix = v;
  } else {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Behavior "${name}" ${where} suffix must be a non-empty string.`,
    );
  }
  if (seen.has(suffix)) {
    throw new MCPToolError(
      "E_DUPLICATE_ID",
      `Behavior "${name}" emits two tweens with suffix "${suffix}" — ids would collide.`,
      "Give each tween a distinct `suffix` (inside a `$repeat`, interpolate the loop variable).",
    );
  }
  seen.add(suffix);
  return suffix;
}

/**
 * Catch a body that overlaps itself before the tweens reach the store, where
 * the same clash would surface as a partially-applied `apply_behavior` (it
 * rolls back, but the error would name store ids rather than the definition).
 * Same strict-overlap + OVERLAP_EPS rule the validator and store apply.
 */
function ensureNoInternalOverlap(
  name: string,
  tweens: RawTween[],
  blockTarget: string,
): void {
  const buckets = new Map<string, RawTween[]>();
  for (const t of tweens) {
    const key = `${t.target ?? blockTarget}::${t.property}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(t);
    else buckets.set(key, [t]);
  }
  for (const [key, bucket] of buckets) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1] as RawTween;
      const curr = sorted[i] as RawTween;
      const prevEnd = prev.start + prev.duration;
      if (curr.start + OVERLAP_EPS < prevEnd) {
        throw new MCPToolError(
          "E_TWEEN_OVERLAP",
          `Behavior "${name}" emits overlapping tweens on ${key}: ` +
            `"${prev.suffix}" [${prev.start}, ${prevEnd}] vs "${curr.suffix}" [${curr.start}, ${curr.start + curr.duration}].`,
          "Two tweens may touch at their endpoints but not intersect — adjust the body's start/duration.",
        );
      }
    }
  }
}

/**
 * Resolve the block's params against the descriptor: supplied value, else
 * declared default, else E_BEHAVIOR_PARAM_MISSING when required. Optional
 * params with no default stay unset, so a `${params.X}` that references one
 * fails with the precise E_TEMPLATE_PARAM_MISSING from `substitute`.
 */
function resolveBehaviorParams(
  def: BehaviorDescriptor,
  supplied: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of def.params) {
    let v: unknown;
    if (Object.prototype.hasOwnProperty.call(supplied, p.name)) {
      v = supplied[p.name];
    } else if (Object.prototype.hasOwnProperty.call(p, "default")) {
      v = p.default;
    } else if (p.required === true) {
      throw new MCPToolError(
        "E_BEHAVIOR_PARAM_MISSING",
        `Behavior "${def.name}" requires param "${p.name}".`,
      );
    } else {
      continue;
    }
    if (!matchesBehaviorType(v, p.type)) {
      throw new MCPToolError(
        "E_BEHAVIOR_PARAM_TYPE",
        `Behavior "${def.name}" param "${p.name}" expected ${p.type}, got ${describeParamValue(v)}.`,
      );
    }
    out[p.name] = v;
  }
  return out;
}

function matchesBehaviorType(v: unknown, t: BehaviorParamType): boolean {
  switch (t) {
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "string":
      return typeof v === "string";
    case "color":
      return typeof v === "string" && v.length > 0;
    case "colorArray":
      return (
        Array.isArray(v) && v.every((c) => typeof c === "string" && c.length > 0)
      );
    case "axis":
      return v === "x" || v === "y";
    default:
      return false;
  }
}

function describeParamValue(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

// ──────────────── Built-in behaviors (§6.3) ────────────────

register({
  descriptor: {
    name: "fadeIn",
    description: "Fade transform.opacity from `fromOpacity` (0) to `toOpacity` (1).",
    params: [
      { name: "fromOpacity", type: "number", required: false, default: 0, description: "Opacity at start." },
      { name: "toOpacity", type: "number", required: false, default: 1, description: "Opacity at end." },
    ],
    produces: ["opacity"],
  },
  expand({ start, duration, params }) {
    const from = readNumberParam(params, "fromOpacity", "fadeIn", 0);
    const to = readNumberParam(params, "toOpacity", "fadeIn", 1);
    return [
      { suffix: "opacity", property: "transform.opacity", from, to, start, duration },
    ];
  },
});

register({
  descriptor: {
    name: "fadeOut",
    description: "Fade transform.opacity from `fromOpacity` (1) to `toOpacity` (0).",
    params: [
      { name: "fromOpacity", type: "number", required: false, default: 1, description: "Opacity at start." },
      { name: "toOpacity", type: "number", required: false, default: 0, description: "Opacity at end." },
    ],
    produces: ["opacity"],
  },
  expand({ start, duration, params }) {
    const from = readNumberParam(params, "fromOpacity", "fadeOut", 1);
    const to = readNumberParam(params, "toOpacity", "fadeOut", 0);
    return [
      { suffix: "opacity", property: "transform.opacity", from, to, start, duration },
    ];
  },
});

register({
  descriptor: {
    name: "popIn",
    description: "Opacity 0→1 plus uniform scale fromScale→toScale on transform.scaleX/Y.",
    params: [
      { name: "fromScale", type: "number", required: false, default: 0.2, description: "Initial scale." },
      { name: "toScale", type: "number", required: false, default: 1, description: "Final scale." },
      { name: "fromOpacity", type: "number", required: false, default: 0, description: "Initial opacity." },
      { name: "toOpacity", type: "number", required: false, default: 1, description: "Final opacity." },
    ],
    produces: ["opacity", "scaleX", "scaleY"],
  },
  expand({ start, duration, params }) {
    const fromOpacity = readNumberParam(params, "fromOpacity", "popIn", 0);
    const toOpacity = readNumberParam(params, "toOpacity", "popIn", 1);
    const fromScale = readNumberParam(params, "fromScale", "popIn", 0.2);
    const toScale = readNumberParam(params, "toScale", "popIn", 1);
    return [
      { suffix: "opacity", property: "transform.opacity", from: fromOpacity, to: toOpacity, start, duration },
      { suffix: "scaleX", property: "transform.scaleX", from: fromScale, to: toScale, start, duration },
      { suffix: "scaleY", property: "transform.scaleY", from: fromScale, to: toScale, start, duration },
    ];
  },
});

register({
  descriptor: {
    name: "popOut",
    description: "Opacity 1→0 plus uniform scale fromScale→toScale on transform.scaleX/Y.",
    params: [
      { name: "fromScale", type: "number", required: false, default: 1, description: "Initial scale." },
      { name: "toScale", type: "number", required: false, default: 0.2, description: "Final scale." },
      { name: "fromOpacity", type: "number", required: false, default: 1, description: "Initial opacity." },
      { name: "toOpacity", type: "number", required: false, default: 0, description: "Final opacity." },
    ],
    produces: ["opacity", "scaleX", "scaleY"],
  },
  expand({ start, duration, params }) {
    const fromOpacity = readNumberParam(params, "fromOpacity", "popOut", 1);
    const toOpacity = readNumberParam(params, "toOpacity", "popOut", 0);
    const fromScale = readNumberParam(params, "fromScale", "popOut", 1);
    const toScale = readNumberParam(params, "toScale", "popOut", 0.2);
    return [
      { suffix: "opacity", property: "transform.opacity", from: fromOpacity, to: toOpacity, start, duration },
      { suffix: "scaleX", property: "transform.scaleX", from: fromScale, to: toScale, start, duration },
      { suffix: "scaleY", property: "transform.scaleY", from: fromScale, to: toScale, start, duration },
    ];
  },
});

register({
  descriptor: {
    name: "slideIn",
    description: "Translate from an offset back to a resting position on the chosen axis.",
    params: [
      { name: "from", type: "number", required: true, description: "Offset value the slide starts from." },
      { name: "axis", type: "axis", required: true, description: '"x" or "y" — which transform axis to animate.' },
      { name: "to", type: "number", required: false, default: 0, description: "Resting value at end of slide." },
    ],
    produces: "dynamic",
  },
  expand({ start, duration, params }) {
    const from = requireNumberParam(params, "from", "slideIn");
    const axis = requireAxisParam(params, "axis", "slideIn");
    const to = readNumberParam(params, "to", "slideIn", 0);
    return [
      { suffix: axis, property: `transform.${axis}`, from, to, start, duration },
    ];
  },
});

register({
  descriptor: {
    name: "slideOut",
    description: "Translate from a resting position out to an offset on the chosen axis.",
    params: [
      { name: "to", type: "number", required: true, description: "Offset value the slide ends at." },
      { name: "axis", type: "axis", required: true, description: '"x" or "y" — which transform axis to animate.' },
      { name: "from", type: "number", required: false, default: 0, description: "Starting value." },
    ],
    produces: "dynamic",
  },
  expand({ start, duration, params }) {
    const to = requireNumberParam(params, "to", "slideOut");
    const axis = requireAxisParam(params, "axis", "slideOut");
    const from = readNumberParam(params, "from", "slideOut", 0);
    return [
      { suffix: axis, property: `transform.${axis}`, from, to, start, duration },
    ];
  },
});

register({
  descriptor: {
    name: "rotateSpin",
    description: "Rotate transform.rotation by `turns` full turns (2π·turns radians).",
    params: [
      { name: "turns", type: "number", required: false, default: 1, description: "Full rotations to perform." },
      { name: "fromRotation", type: "number", required: false, default: 0, description: "Starting rotation in radians." },
    ],
    produces: ["rotation"],
  },
  expand({ start, duration, params }) {
    const turns = readNumberParam(params, "turns", "rotateSpin", 1);
    const fromRotation = readNumberParam(params, "fromRotation", "rotateSpin", 0);
    const toRotation = fromRotation + 2 * Math.PI * turns;
    return [
      {
        suffix: "rotation",
        property: "transform.rotation",
        from: fromRotation,
        to: toRotation,
        start,
        duration,
      },
    ];
  },
});

register({
  descriptor: {
    name: "kenburns",
    description:
      "Slow positional drift on the chosen axis plus uniform scale drift on both axes — a classic still-frame ken burns.",
    params: [
      { name: "fromScale", type: "number", required: true, description: "Scale at start of move." },
      { name: "toScale", type: "number", required: true, description: "Scale at end of move." },
      { name: "pan", type: "number", required: true, description: "Distance to drift along the axis (in pixels)." },
      { name: "axis", type: "axis", required: false, default: "x", description: "Which transform axis the pan moves along." },
      { name: "fromPosition", type: "number", required: false, default: 0, description: "Starting axis value." },
    ],
    produces: "dynamic",
  },
  expand({ start, duration, params }) {
    const fromScale = requireNumberParam(params, "fromScale", "kenburns");
    const toScale = requireNumberParam(params, "toScale", "kenburns");
    const pan = requireNumberParam(params, "pan", "kenburns");
    const axis = readAxisParam(params, "axis", "kenburns", "x");
    const fromPosition = readNumberParam(params, "fromPosition", "kenburns", 0);
    return [
      {
        suffix: axis,
        property: `transform.${axis}`,
        from: fromPosition,
        to: fromPosition + pan,
        start,
        duration,
      },
      {
        suffix: "scaleX",
        property: "transform.scaleX",
        from: fromScale,
        to: toScale,
        start,
        duration,
      },
      {
        suffix: "scaleY",
        property: "transform.scaleY",
        from: fromScale,
        to: toScale,
        start,
        duration,
      },
    ];
  },
});

register({
  descriptor: {
    name: "shake",
    description:
      "Oscillate transform.x by ±amplitude over `cycles` cycles. Returns to 0 at the end. Emits 4·cycles back-to-back tweens.",
    params: [
      { name: "amplitude", type: "number", required: true, description: "Peak displacement in pixels." },
      { name: "cycles", type: "number", required: true, description: "Number of full oscillation cycles (≥ 1)." },
      { name: "axis", type: "axis", required: false, default: "x", description: "Which transform axis to shake." },
      { name: "center", type: "number", required: false, default: 0, description: "Resting axis value the shake oscillates around." },
    ],
    produces: "dynamic",
  },
  expand({ start, duration, params }) {
    const amplitude = requireNumberParam(params, "amplitude", "shake");
    const cyclesRaw = requireNumberParam(params, "cycles", "shake");
    const cycles = Math.max(1, Math.floor(cyclesRaw));
    const axis = readAxisParam(params, "axis", "shake", "x");
    const center = readNumberParam(params, "center", "shake", 0);
    const segments = cycles * 4; // quarter-waves
    // 0 → +amp → 0 → -amp → 0   (per cycle)
    const path: number[] = [center];
    for (let c = 0; c < cycles; c += 1) {
      path.push(center + amplitude);
      path.push(center);
      path.push(center - amplitude);
      path.push(center);
    }
    const breakpoints = segmentBreakpoints(start, duration, segments);
    const tweens: RawTween[] = [];
    for (let i = 0; i < segments; i += 1) {
      tweens.push({
        suffix: `${axis}_${pad(i, segments)}`,
        property: `transform.${axis}`,
        from: path[i] as number,
        to: path[i + 1] as number,
        start: breakpoints[i] as number,
        duration: (breakpoints[i + 1] as number) - (breakpoints[i] as number),
      });
    }
    return tweens;
  },
});

register({
  descriptor: {
    name: "colorCycle",
    description:
      "Tween a color property through a list of colors, evenly dividing the duration into N-1 segments.",
    params: [
      { name: "colors", type: "colorArray", required: true, description: "Color stops (≥ 2 entries)." },
      { name: "property", type: "string", required: false, default: "tint", description: "Color property path to tween (e.g. tint, fillColor, color)." },
    ],
    produces: "dynamic",
  },
  expand({ start, duration, params }) {
    const colors = requireColorArrayParam(params, "colors", "colorCycle", 2);
    const property = readColorParam(params, "property", "colorCycle", "tint");
    const segments = colors.length - 1;
    const breakpoints = segmentBreakpoints(start, duration, segments);
    const tweens: RawTween[] = [];
    for (let i = 0; i < segments; i += 1) {
      tweens.push({
        suffix: `seg_${pad(i, segments)}`,
        property,
        from: colors[i] as string,
        to: colors[i + 1] as string,
        start: breakpoints[i] as number,
        duration: (breakpoints[i + 1] as number) - (breakpoints[i] as number),
      });
    }
    return tweens;
  },
});

register({
  descriptor: {
    name: "pulse",
    description:
      "Two back-to-back scale tweens on transform.scaleX: out (fromScale → peakScale) then back in (peakScale → fromScale).",
    params: [
      { name: "peakScale", type: "number", required: true, description: "Scale at the peak of the pulse." },
      { name: "fromScale", type: "number", required: false, default: 1, description: "Resting scale before and after the pulse." },
    ],
    produces: ["out", "in"],
  },
  expand({ start, duration, params }) {
    const peakScale = requireNumberParam(params, "peakScale", "pulse");
    const fromScale = readNumberParam(params, "fromScale", "pulse", 1);
    const half = duration / 2;
    return [
      {
        suffix: "out",
        property: "transform.scaleX",
        from: fromScale,
        to: peakScale,
        start,
        duration: half,
      },
      {
        suffix: "in",
        property: "transform.scaleX",
        from: peakScale,
        to: fromScale,
        start: start + half,
        duration: half,
      },
    ];
  },
});

function pad(i: number, total: number): string {
  const width = String(total - 1).length;
  return String(i).padStart(width, "0");
}
