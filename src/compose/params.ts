// Param substitution engine — shared by templates (§7) and, in v0.4+,
// scenes (§8) and user-defined behaviors (§6.6). Spec reference:
// COMPOSITION_PRIMITIVES.md §7.4 and the §17 risks-table note that pins
// substitution to whole-string placeholders only:
//
//   "Substitute only on values that match `^${(params|$)..*}$` exactly —
//    no partial substitution into longer strings unless
//    `format: 'string-template'`."
//
// In practice that means a placeholder REPLACES the whole string value
// (allowing any JSON type to come back — a number, an object, etc.),
// while strings that merely *contain* a `${...}` somewhere in the middle
// pass through unchanged. v0.3 ships literal substitution only — no
// arithmetic, no defaults-in-string. Authors compute offsets in their app
// before passing params (§7.4).

import { MCPToolError } from "../mcp/errors.js";

export interface SubstitutionContext {
  /** Resolved params keyed by descriptor name. Looked up via `${params.X}`. */
  params: Record<string, unknown>;
  /**
   * Reserved namespace for context-dependent values addressable as `${$.X}`.
   * Templates expose `start` (the instance's global start time).
   */
  meta?: Record<string, unknown>;
}

/** Matches a whole-string placeholder of the form `${params.X}` or `${$.X}`. */
const PLACEHOLDER_RE = /^\$\{(params|\$)\.([A-Za-z_$][A-Za-z0-9_$]*)\}$/;

/**
 * Recursively walk `value` and replace whole-string placeholders. Pure: returns
 * a new tree (with new objects/arrays only where a substitution actually
 * occurred is not promised — callers should not rely on identity).
 *
 * Throws `MCPToolError` (E_TEMPLATE_PARAM_MISSING) if a placeholder names a
 * key not present in the context.
 */
export function substitute(
  value: unknown,
  ctx: SubstitutionContext,
  path = "",
): unknown {
  if (typeof value === "string") {
    const m = PLACEHOLDER_RE.exec(value);
    if (m === null) return value;
    const ns = m[1] as "params" | "$";
    const key = m[2] as string;
    if (ns === "params") {
      if (!hasOwn(ctx.params, key)) {
        throw new MCPToolError(
          "E_TEMPLATE_PARAM_MISSING",
          `Unknown param "${key}" referenced at ${path || "<root>"}.`,
        );
      }
      return ctx.params[key];
    }
    const meta = ctx.meta ?? {};
    if (!hasOwn(meta, key)) {
      throw new MCPToolError(
        "E_TEMPLATE_PARAM_MISSING",
        `Unknown $.${key} reference at ${path || "<root>"}.`,
      );
    }
    return meta[key];
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => substitute(v, ctx, `${path}[${i}]`));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) {
      out[k] = substitute(value[k], ctx, path === "" ? k : `${path}.${k}`);
    }
    return out;
  }
  return value;
}

function hasOwn(o: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
