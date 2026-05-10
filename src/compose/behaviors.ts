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

import type { EasingName } from "../easings/index.js";
import { MCPToolError } from "../mcp/errors.js";
import type { Tween } from "../schema/types.js";

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
  /** Suffixes appended to the parent block id, in expansion order. */
  produces: ReadonlyArray<string> | "dynamic";
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
  easing?: EasingName;
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
  easing: EasingName | undefined;
  params: Record<string, unknown>;
}

interface RawTween {
  suffix: string;
  property: string;
  from: number | string;
  to: number | string;
  start: number;
  duration: number;
  easing?: EasingName;
}

type BehaviorExpand = (ctx: ExpandContext) => RawTween[];

interface BehaviorEntry {
  descriptor: BehaviorDescriptor;
  expand: BehaviorExpand;
}

const REGISTRY = new Map<string, BehaviorEntry>();

function register(entry: BehaviorEntry): void {
  REGISTRY.set(entry.descriptor.name, entry);
}

// ──────────────── Public API ────────────────

export function listBehaviors(): BehaviorDescriptor[] {
  return Array.from(REGISTRY.values()).map((e) => ({
    name: e.descriptor.name,
    description: e.descriptor.description,
    params: e.descriptor.params.map((p) => ({ ...p })),
    produces: typeof e.descriptor.produces === "string"
      ? e.descriptor.produces
      : [...e.descriptor.produces],
  }));
}

export function getBehaviorDescriptor(name: string): BehaviorDescriptor | undefined {
  const entry = REGISTRY.get(name);
  return entry ? entry.descriptor : undefined;
}

export function hasBehavior(name: string): boolean {
  return REGISTRY.has(name);
}

/**
 * Expand a single behavior block into concrete tweens with stable ids.
 * Throws MCPToolError on unknown name / missing or wrongly-typed params.
 */
export function expandBehavior(block: BehaviorBlock): Tween[] {
  const entry = REGISTRY.get(block.behavior);
  if (!entry) {
    throw new MCPToolError(
      "E_BEHAVIOR_UNKNOWN",
      `Unknown behavior "${block.behavior}".`,
      "Call list_behaviors to see available names.",
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
      target: block.target,
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
 * Pure function; does not touch the input. Other top-level keys pass through
 * unchanged. After this runs, the result is a v0.1-shaped composition (no
 * `$behavior` markers anywhere in `tweens`).
 */
export function expandBehaviors(comp: unknown): unknown {
  if (!isPlainObject(comp)) return comp;
  const rawTweens = (comp as { tweens?: unknown }).tweens;
  if (!Array.isArray(rawTweens)) return comp;
  let touched = false;
  const out: unknown[] = [];
  for (const entry of rawTweens) {
    if (isBehaviorBlock(entry)) {
      touched = true;
      const block = readBehaviorBlock(entry);
      const expanded = expandBehavior(block);
      for (const t of expanded) out.push(t);
    } else {
      out.push(entry);
    }
  }
  if (!touched) return comp;
  return { ...(comp as Record<string, unknown>), tweens: out };
}

// ──────────────── Helpers ────────────────

function deriveParentId(block: BehaviorBlock): string {
  if (block.id !== undefined && block.id.length > 0) return block.id;
  return `${block.target}_${block.behavior}_${block.start}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isBehaviorBlock(v: unknown): v is Record<string, unknown> {
  return isPlainObject(v) && typeof v.$behavior === "string";
}

function readBehaviorBlock(raw: Record<string, unknown>): BehaviorBlock {
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
    if (typeof raw.easing !== "string") {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Behavior "${behavior}" easing must be a string.`,
      );
    }
    block.easing = raw.easing as EasingName;
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
      "Slow positional drift on the chosen axis plus uniform scale drift — a classic still-frame ken burns.",
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
        suffix: "scale",
        property: "transform.scaleX",
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
    const seg = duration / segments;
    // 0 → +amp → 0 → -amp → 0   (per cycle)
    const path: number[] = [center];
    for (let c = 0; c < cycles; c += 1) {
      path.push(center + amplitude);
      path.push(center);
      path.push(center - amplitude);
      path.push(center);
    }
    const tweens: RawTween[] = [];
    for (let i = 0; i < segments; i += 1) {
      tweens.push({
        suffix: `${axis}_${pad(i, segments)}`,
        property: `transform.${axis}`,
        from: path[i] as number,
        to: path[i + 1] as number,
        start: start + i * seg,
        duration: seg,
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
    const seg = duration / segments;
    const tweens: RawTween[] = [];
    for (let i = 0; i < segments; i += 1) {
      tweens.push({
        suffix: `seg_${pad(i, segments)}`,
        property,
        from: colors[i] as string,
        to: colors[i + 1] as string,
        start: start + i * seg,
        duration: seg,
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
