// `$ref` import resolver — primitive P1 from COMPOSITION_PRIMITIVES.md §5.
//
// Pre-compile pass that walks an authored JSON tree, follows every
// `{ "$ref": "<path>[#<pointer>]" }` to its target, and inlines the result.
// The engine never sees `$ref`; by the time validation runs, every reference
// is gone.
//
//   inline mode  — `{ "$ref": "./a.json" }` → contents of a.json
//   spread mode  — when the `$ref` object is an array element AND the
//                  resolved value is itself an array, the array is spread
//                  into the parent array in place of the single entry.
//   pointer mode — `{ "$ref": "./a.json#/path/to/node" }` selects a sub-tree
//                  via RFC 6901.
//
// Resolution rules (§5.3):
//   - The base directory of a `$ref` is the directory of the FILE THAT
//     CONTAINS IT. Refs inside a loaded file resolve relative to that file,
//     not the root.
//   - Cycles → E_REF_CYCLE. Detected on the *resolution chain*, not on
//     mere repetition: distinct call sites pointing at the same target are
//     fine; only re-entering a (file, pointer) that is currently being
//     resolved is a cycle.
//   - Missing files → E_REF_MISSING.
//   - Each file is parsed once per compile pass; resolved subtrees are
//     cached by `(absolutePath, pointer)`.

import { readFile as fsReadFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { evaluatePointer, JsonPointerError } from "./jsonPointer.js";

export type RefErrorCode =
  | "E_REF_CYCLE"
  | "E_REF_MISSING"
  | "E_REF_PARSE"
  | "E_REF_POINTER"
  | "E_REF_INVALID";

export class RefResolutionError extends Error {
  override readonly name = "RefResolutionError";
  readonly code: RefErrorCode;
  readonly ref: string | undefined;
  readonly chain: readonly string[] | undefined;
  constructor(args: {
    code: RefErrorCode;
    message: string;
    ref?: string;
    chain?: readonly string[];
  }) {
    super(args.message);
    this.code = args.code;
    this.ref = args.ref;
    this.chain = args.chain;
  }
}

export type ReadFile = (absolutePath: string) => Promise<string>;

export interface ResolveImportsOptions {
  /**
   * Custom file reader. Defaults to `fs/promises#readFile` with utf-8 encoding.
   * Useful for tests and for browser-side resolution against an in-memory map.
   */
  readFile?: ReadFile;
}

/**
 * Walk a JSON tree and resolve every `$ref`.
 *
 * @param json     The authored JSON value (already parsed).
 * @param rootPath Path of the file the JSON came from. Used to anchor the
 *                 root's relative refs. Need not exist on disk if `json` has
 *                 no top-level relative refs, but a real path is recommended.
 */
export async function resolveImports(
  json: unknown,
  rootPath: string,
  options: ResolveImportsOptions = {},
): Promise<unknown> {
  const reader = options.readFile ?? defaultReadFile;
  const parsedFiles = new Map<string, unknown>();
  const resolvedRefs = new Map<string, unknown>();
  const rootDir = dirname(resolve(rootPath));

  async function loadFile(absPath: string): Promise<unknown> {
    if (parsedFiles.has(absPath)) return parsedFiles.get(absPath);
    let raw: string;
    try {
      raw = await reader(absPath);
    } catch (err) {
      throw new RefResolutionError({
        code: "E_REF_MISSING",
        message: `Cannot read $ref target file: ${absPath} (${(err as Error).message})`,
        ref: absPath,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new RefResolutionError({
        code: "E_REF_PARSE",
        message: `Failed to parse $ref target as JSON: ${absPath} (${(err as Error).message})`,
        ref: absPath,
      });
    }
    parsedFiles.set(absPath, parsed);
    return parsed;
  }

  async function resolveRef(
    refStr: string,
    baseDir: string,
    chain: readonly string[],
  ): Promise<unknown> {
    const split = splitRef(refStr);
    if (split.pathPart === "") {
      throw new RefResolutionError({
        code: "E_REF_INVALID",
        message: `Same-document $ref (no path before "#") is not supported: ${JSON.stringify(refStr)}`,
        ref: refStr,
      });
    }
    const absPath = isAbsolute(split.pathPart)
      ? resolve(split.pathPart)
      : resolve(baseDir, split.pathPart);
    const key = `${absPath}#${split.pointer}`;

    if (chain.includes(key)) {
      const cycleChain = [...chain, key];
      throw new RefResolutionError({
        code: "E_REF_CYCLE",
        message: `$ref cycle detected: ${cycleChain.join(" -> ")}`,
        ref: refStr,
        chain: cycleChain,
      });
    }

    if (resolvedRefs.has(key)) return resolvedRefs.get(key);

    const fileJson = await loadFile(absPath);
    let target: unknown;
    try {
      target = evaluatePointer(fileJson, split.pointer);
    } catch (err) {
      if (err instanceof JsonPointerError) {
        throw new RefResolutionError({
          code: "E_REF_POINTER",
          message: `JSON pointer ${JSON.stringify(split.pointer)} did not resolve in ${absPath}: ${err.message}`,
          ref: refStr,
        });
      }
      throw err;
    }

    const expanded = await walk(target, dirname(absPath), [...chain, key]);
    resolvedRefs.set(key, expanded);
    return expanded;
  }

  async function walk(
    node: unknown,
    baseDir: string,
    chain: readonly string[],
  ): Promise<unknown> {
    if (Array.isArray(node)) {
      const out: unknown[] = [];
      for (const child of node) {
        if (isRefObject(child)) {
          const resolved = await resolveRef(child.$ref, baseDir, chain);
          if (Array.isArray(resolved)) {
            out.push(...resolved);
          } else {
            out.push(resolved);
          }
        } else {
          out.push(await walk(child, baseDir, chain));
        }
      }
      return out;
    }
    if (isPlainObject(node)) {
      if (isRefObject(node)) {
        return resolveRef(node.$ref, baseDir, chain);
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        out[k] = await walk(v, baseDir, chain);
      }
      return out;
    }
    return node;
  }

  return walk(json, rootDir, []);
}

function defaultReadFile(absolutePath: string): Promise<string> {
  return fsReadFile(absolutePath, "utf8");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRefObject(v: unknown): v is { $ref: string } {
  return isPlainObject(v) && typeof v.$ref === "string";
}

function splitRef(ref: string): { pathPart: string; pointer: string } {
  const hashIdx = ref.indexOf("#");
  if (hashIdx < 0) return { pathPart: ref, pointer: "" };
  return { pathPart: ref.slice(0, hashIdx), pointer: ref.slice(hashIdx + 1) };
}
