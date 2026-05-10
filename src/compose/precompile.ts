// Pre-compile pipeline driver — orchestrates the v0.2/v0.3 authoring →
// canonical passes from COMPOSITION_PRIMITIVES.md §10. Today that's three
// passes: resolveImports → expandTemplates → expandBehaviors. §10 reserves
// room for `expandSceneInstances` (v0.4+) which will slot in between
// templates and behaviors.
//
// Drivers (`renderToFile`, `attach`) call this transparently so callers can
// hand authored JSON straight to the engine without thinking about a
// "compile step". For canonical v0.1 input the call is effectively free —
// detection short-circuits before any walk allocates.

import { expandBehaviors } from "./behaviors.js";
import { resolveImports, type ReadFile } from "./imports.js";
import { expandSceneInstances } from "./scenes.js";
import { expandTemplates } from "./templates.js";
// Side-effect import: registers the v0.3 built-in templates with the global
// registry so any caller that goes through `precompile` (drivers, MCP tools,
// tests) sees them, even if they never reached the public `compose/index.js`.
import "./builtInTemplates.js";

export interface PrecompileOptions {
  /**
   * Path of the file the JSON came from. Required only when the composition
   * contains `$ref` markers — relative paths resolve against this file's
   * directory. Ignored otherwise.
   */
  sourcePath?: string;
  /**
   * Custom file reader for `$ref` resolution. Defaults to
   * `fs/promises#readFile` with utf-8 encoding (suitable for Node).
   * Pass an in-memory map for browser-side resolution.
   */
  readFile?: ReadFile;
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
 * The result is the canonical (post-compile) JSON. The caller is responsible
 * for any schema validation.
 */
export async function precompile(
  comp: unknown,
  options: PrecompileOptions = {},
): Promise<unknown> {
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
