// Pre-compile pipeline driver — orchestrates the v0.2 authoring → canonical
// passes from COMPOSITION_PRIMITIVES.md §10. Today that's just two passes
// (resolveImports, expandBehaviors); §10 reserves room for templates and
// scenes (v0.3+) which will slot in here as additional steps.
//
// Drivers (`renderToFile`, `attach`) call this transparently so callers can
// hand authored JSON straight to the engine without thinking about a
// "compile step". For canonical v0.1 input the call is effectively free —
// detection short-circuits before any walk allocates.

import { expandBehaviors } from "./behaviors.js";
import { resolveImports, type ReadFile } from "./imports.js";

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
 *   1. resolveImports  — inline every `$ref`
 *   2. expandBehaviors — replace each `{ $behavior }` tween with its expansion
 *
 * Returns the input unchanged when no v0.2 markers are present, so calling
 * this on a canonical v0.1 composition is a near-zero-cost no-op.
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
