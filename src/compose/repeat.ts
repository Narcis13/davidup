// `$repeat` expansion — REPEAT_EXPRESSIONS_DESIGN.md §4, v1.1 Session 16.
//
// One authored block generates N items or tweens:
//
//   items:  { "dot": { "$repeat": { "count": "${params.count}", "as": "i" },
//                      "item": { "type": "shape", "transform": { "x": "${i * 40}", … } } } }
//   tweens: [ { "$repeat": { "count": 3 },
//               "item": { "$behavior": "fadeIn", "target": "dot__r${i}", "start": "${i * 0.2}", … } } ]
//
// Rules:
//   * `count` is an integer in [0, REPEAT_MAX_COUNT], literal or an expression.
//   * `as` names the loop variable (default `i`), a bare identifier inside
//     every `${…}` of the body: `${i}`, `"b${i + 1}"`, `params['y' + (i + 1)]`.
//   * Item ids: `${base}__r${i}` where `base` is the record key, unless the
//     header carries an `id` pattern (`"id": "b${i + 1}"`).
//   * Tween ids: an `id` that interpolates the loop variable is used as-is; a
//     constant `id` gets `__r${i}` appended so iterations never collide.
//     Tweens without an id (e.g. `$behavior` blocks) keep the usual derivation.
//   * `item` may itself be a `$repeat` block (grids); every enclosing loop
//     variable stays in scope, so nested blocks need distinct `as` names.
//     Nesting is capped at REPEAT_MAX_DEPTH, total output at REPEAT_MAX_NODES.
//   * Expansion happens where params bind: root blocks in a pass before
//     `expandTemplates`, template / scene blocks inside their instance
//     expansion. Bodies are substituted here, with the loop variables in scope,
//     so callers must not substitute the produced entries again.
//   * An authored `__source` sidecar (precompile source maps) is copied onto
//     every produced entry with `originKind: "repeat"`.

import { MCPToolError } from "../engine/errors.js";
import type { SourceLocation } from "../engine/types.js";
import { substitute, type SubstitutionContext } from "./params.js";

export const REPEAT_MAX_COUNT = 500;
export const REPEAT_MAX_DEPTH = 4;
export const REPEAT_MAX_NODES = 2000;

const SOURCE_FIELD = "__source";
const DEFAULT_AS = "i";
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_NAMES = new Set(["params", "min", "max", "round"]);
const BLOCK_KEYS = new Set(["$repeat", "item", SOURCE_FIELD]);
const ITEM_HEADER_KEYS = new Set(["count", "as", "id"]);
const TWEEN_HEADER_KEYS = new Set(["count", "as"]);

export function isRepeatBlock(v: unknown): v is Record<string, unknown> {
  return isPlainObject(v) && Object.prototype.hasOwnProperty.call(v, "$repeat");
}

export interface ExpandedRepeatItems {
  /** Items in authored order, repeat blocks replaced by their products. */
  items: Record<string, unknown>;
  /** Ids produced by `$repeat` (already substituted — don't substitute again). */
  generated: Set<string>;
  /** Base record key → produced ids, for rewriting layer / group references. */
  expanded: Map<string, string[]>;
}

export interface ExpandedRepeatTween {
  value: unknown;
  /** True when produced by `$repeat` (already substituted). */
  generated: boolean;
}

interface Budget {
  nodes: number;
}

/**
 * Expand every `$repeat` entry of an `items` record. Non-repeat entries pass
 * through untouched. Returns the input unchanged (with empty maps) when there
 * is nothing to expand.
 */
export function expandRepeatItems(
  items: Record<string, unknown>,
  ctx: SubstitutionContext,
  path: string,
): ExpandedRepeatItems {
  const generated = new Set<string>();
  const expanded = new Map<string, string[]>();
  if (!Object.values(items).some(isRepeatBlock)) {
    return { items, generated, expanded };
  }
  const budget: Budget = { nodes: 0 };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(items)) {
    const value = items[key];
    if (!isRepeatBlock(value)) {
      claimId(out, key, path);
      out[key] = value;
      continue;
    }
    const produced: Array<[string, unknown]> = [];
    expandItemBlock(value, key, ctx, `${path}.${key}`, 0, budget, sourceOf(value), produced);
    const ids: string[] = [];
    for (const [id, item] of produced) {
      claimId(out, id, path);
      out[id] = item;
      generated.add(id);
      ids.push(id);
    }
    expanded.set(key, ids);
  }
  return { items: out, generated, expanded };
}

/** Expand every `$repeat` entry of a `tweens` array. */
export function expandRepeatTweens(
  tweens: unknown[],
  ctx: SubstitutionContext,
  path: string,
): ExpandedRepeatTween[] {
  const budget: Budget = { nodes: 0 };
  const out: ExpandedRepeatTween[] = [];
  for (let i = 0; i < tweens.length; i += 1) {
    const entry = tweens[i];
    if (!isRepeatBlock(entry)) {
      out.push({ value: entry, generated: false });
      continue;
    }
    const produced: unknown[] = [];
    expandTweenBlock(entry, ctx, `${path}[${i}]`, 0, budget, sourceOf(entry), "", produced);
    for (const t of produced) out.push({ value: t, generated: true });
  }
  return out;
}

/**
 * Local ids an items record emits, for descriptors: plain keys as-is, and for
 * `$repeat` entries the id pattern (`"dot${i}"`, default `"dot__r${i}"`) since
 * the real ids depend on params.
 */
export function describeItemIds(items: Record<string, unknown>): string[] {
  return Object.keys(items)
    .map((key) => {
      const block = items[key];
      if (!isRepeatBlock(block)) return key;
      const header = block.$repeat;
      if (isPlainObject(header) && typeof header.id === "string") return header.id;
      const as = isPlainObject(header) && typeof header.as === "string" ? header.as : DEFAULT_AS;
      return `${key}__r\${${as}}`;
    })
    .sort();
}

/**
 * Replace base ids of expanded repeat blocks inside an id list (a layer's or
 * group's `items`) with the produced ids, in order.
 */
export function replaceRepeatRefs(
  list: unknown[],
  expanded: ReadonlyMap<string, string[]>,
): unknown[] {
  if (expanded.size === 0) return list;
  const out: unknown[] = [];
  for (const id of list) {
    const ids = typeof id === "string" ? expanded.get(id) : undefined;
    if (ids !== undefined) out.push(...ids);
    else out.push(id);
  }
  return out;
}

/** A group item with its `items` list rewritten through {@link replaceRepeatRefs}. */
export function replaceGroupRepeatRefs(
  item: unknown,
  expanded: ReadonlyMap<string, string[]>,
): unknown {
  if (expanded.size === 0 || !isPlainObject(item)) return item;
  if (item.type !== "group" || !Array.isArray(item.items)) return item;
  return { ...item, items: replaceRepeatRefs(item.items, expanded) };
}

/**
 * Compile pass: expand `$repeat` blocks in the root composition's `items` and
 * `tweens`. Root scope has no params; only loop variables are in scope. Layer
 * and group references to a repeated base id are replaced by the produced ids.
 * Returns the input unchanged when no root entry is a repeat block.
 */
export function expandRepeats(comp: unknown): unknown {
  if (!isPlainObject(comp)) return comp;
  const items = comp.items;
  const tweens = comp.tweens;
  const itemsHaveRepeat = isPlainObject(items) && Object.values(items).some(isRepeatBlock);
  const tweensHaveRepeat = Array.isArray(tweens) && tweens.some(isRepeatBlock);
  if (!itemsHaveRepeat && !tweensHaveRepeat) return comp;

  const ctx: SubstitutionContext = { params: {}, meta: {} };
  const out: Record<string, unknown> = { ...comp };
  if (itemsHaveRepeat) {
    const result = expandRepeatItems(items as Record<string, unknown>, ctx, "items");
    const newItems: Record<string, unknown> = {};
    for (const [id, item] of Object.entries(result.items)) {
      newItems[id] = replaceGroupRepeatRefs(item, result.expanded);
    }
    out.items = newItems;
    if (Array.isArray(comp.layers)) {
      out.layers = comp.layers.map((layer) =>
        isPlainObject(layer) && Array.isArray(layer.items)
          ? { ...layer, items: replaceRepeatRefs(layer.items, result.expanded) }
          : layer,
      );
    }
  }
  if (tweensHaveRepeat) {
    out.tweens = expandRepeatTweens(tweens as unknown[], ctx, "tweens").map((e) => e.value);
  }
  return out;
}

// ──────────────── Block expansion ────────────────

interface Header {
  count: number;
  as: string;
  id?: unknown;
  item: unknown;
}

function expandItemBlock(
  block: Record<string, unknown>,
  base: string,
  ctx: SubstitutionContext,
  path: string,
  depth: number,
  budget: Budget,
  source: SourceLocation | undefined,
  produced: Array<[string, unknown]>,
): void {
  const header = readHeader(block, ctx, path, depth, ITEM_HEADER_KEYS);
  for (let i = 0; i < header.count; i += 1) {
    const iterCtx = withLocal(ctx, header.as, i);
    let id: string;
    if (header.id === undefined) {
      id = `${base}__r${i}`;
    } else {
      const v = substitute(header.id, iterCtx, `${path}.$repeat.id`);
      if (typeof v !== "string" || v.length === 0) {
        throw repeatError(`id pattern must produce a non-empty string, got ${JSON.stringify(v)}`, path);
      }
      id = v;
    }
    if (isRepeatBlock(header.item)) {
      expandItemBlock(header.item, id, iterCtx, `${path}.item`, depth + 1, budget, source, produced);
      continue;
    }
    if (!isPlainObject(header.item)) {
      throw repeatError("`item` must be an object", path);
    }
    spend(budget, path);
    const item = substitute(header.item, iterCtx, `${path}.item`) as Record<string, unknown>;
    produced.push([id, withSource(item, source)]);
  }
}

function expandTweenBlock(
  block: Record<string, unknown>,
  ctx: SubstitutionContext,
  path: string,
  depth: number,
  budget: Budget,
  source: SourceLocation | undefined,
  idSuffix: string,
  produced: unknown[],
): void {
  const header = readHeader(block, ctx, path, depth, TWEEN_HEADER_KEYS);
  for (let i = 0; i < header.count; i += 1) {
    const iterCtx = withLocal(ctx, header.as, i);
    if (isRepeatBlock(header.item)) {
      expandTweenBlock(
        header.item,
        iterCtx,
        `${path}.item`,
        depth + 1,
        budget,
        source,
        `${idSuffix}__r${i}`,
        produced,
      );
      continue;
    }
    if (!isPlainObject(header.item)) {
      throw repeatError("`item` must be an object", path);
    }
    spend(budget, path);
    const rawId = header.item.id;
    const tween = substitute(header.item, iterCtx, `${path}.item`) as Record<string, unknown>;
    // A constant id would repeat verbatim; suffix it per iteration. Ids that
    // interpolate a loop variable are already unique and stay as authored.
    if (typeof rawId === "string" && tween.id === rawId) {
      tween.id = `${rawId}${idSuffix}__r${i}`;
    }
    produced.push(withSource(tween, source));
  }
}

function readHeader(
  block: Record<string, unknown>,
  ctx: SubstitutionContext,
  path: string,
  depth: number,
  headerKeys: ReadonlySet<string>,
): Header {
  if (depth >= REPEAT_MAX_DEPTH) {
    throw repeatError(`$repeat blocks nest deeper than ${REPEAT_MAX_DEPTH} levels`, path);
  }
  for (const k of Object.keys(block)) {
    if (!BLOCK_KEYS.has(k)) {
      throw repeatError(
        `unexpected key "${k}" next to $repeat — put the repeated entry under "item"`,
        path,
      );
    }
  }
  if (!Object.prototype.hasOwnProperty.call(block, "item")) {
    throw repeatError("missing `item`", path);
  }
  const raw = block.$repeat;
  if (!isPlainObject(raw)) {
    throw repeatError("`$repeat` must be an object like { count, as }", path);
  }
  for (const k of Object.keys(raw)) {
    if (!headerKeys.has(k)) {
      throw repeatError(
        `unknown $repeat option "${k}" (allowed: ${[...headerKeys].join(", ")})`,
        path,
      );
    }
  }

  const as = raw.as ?? DEFAULT_AS;
  if (typeof as !== "string" || !IDENT_RE.test(as) || RESERVED_NAMES.has(as)) {
    throw repeatError(
      `\`as\` must be a plain identifier other than params/min/max/round, got ${JSON.stringify(as)}`,
      path,
    );
  }
  if (ctx.locals !== undefined && Object.prototype.hasOwnProperty.call(ctx.locals, as)) {
    throw repeatError(
      `loop variable "${as}" is already bound by an enclosing $repeat — give the nested block a different \`as\``,
      path,
    );
  }

  if (!Object.prototype.hasOwnProperty.call(raw, "count")) {
    throw repeatError("missing `count`", path);
  }
  const count = substitute(raw.count, ctx, `${path}.$repeat.count`);
  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 0 ||
    count > REPEAT_MAX_COUNT
  ) {
    throw repeatError(
      `count must be an integer between 0 and ${REPEAT_MAX_COUNT}, got ${JSON.stringify(count)}`,
      path,
    );
  }

  const header: Header = { count, as, item: block.item };
  if (raw.id !== undefined) {
    if (typeof raw.id !== "string" || raw.id.length === 0) {
      throw repeatError("`id` must be a non-empty string pattern like \"dot${i}\"", path);
    }
    header.id = raw.id;
  }
  return header;
}

function withLocal(ctx: SubstitutionContext, name: string, i: number): SubstitutionContext {
  return { ...ctx, locals: { ...(ctx.locals ?? {}), [name]: i } };
}

function spend(budget: Budget, path: string): void {
  budget.nodes += 1;
  if (budget.nodes > REPEAT_MAX_NODES) {
    throw repeatError(`expansion produces more than ${REPEAT_MAX_NODES} entries`, path);
  }
}

function claimId(out: Record<string, unknown>, id: string, path: string): void {
  if (Object.prototype.hasOwnProperty.call(out, id)) {
    throw new MCPToolError(
      "E_DUPLICATE_ID",
      `$repeat in ${path} produced item id "${id}" that collides with another item.`,
      "Give the $repeat an `id` pattern that includes the loop variable, e.g. \"dot${i}\".",
    );
  }
}

function sourceOf(block: Record<string, unknown>): SourceLocation | undefined {
  const s = block[SOURCE_FIELD];
  return isPlainObject(s) ? (s as unknown as SourceLocation) : undefined;
}

function withSource(
  entry: Record<string, unknown>,
  source: SourceLocation | undefined,
): Record<string, unknown> {
  if (source === undefined) return entry;
  return { ...entry, [SOURCE_FIELD]: { ...source, originKind: "repeat" } };
}

function repeatError(reason: string, path: string): MCPToolError {
  const at = path || "<root>";
  return new MCPToolError(
    "E_REPEAT_INVALID",
    `Bad $repeat at ${at}: ${reason}.`,
    'Shape: { "$repeat": { "count": 3, "as": "i", "id": "dot${i}" }, "item": { … } } — ' +
      `count is an integer 0–${REPEAT_MAX_COUNT}; \`id\` is only for items; ` +
      `nest at most ${REPEAT_MAX_DEPTH} levels.`,
    { details: { path: at, reason } },
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
