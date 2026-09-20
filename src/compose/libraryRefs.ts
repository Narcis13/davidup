// `global:` template / behavior references — the compile-time half of the
// global library (COMPOSITION_PRIMITIVES.md §12, L-1).
//
// A composition may name a definition that lives in the on-disk library
// (`$DAVIDUP_LIBRARY`, default `~/.davidup/library`) the same way an
// `asset.src` names a library file:
//
//   "items":  { "follow": { "$template": "global:ctaButton", "params": {…} } }
//   "tweens": [ { "$behavior": "global:neonFlicker", "target": "venn", … } ]
//
// This pass runs after `$ref` inlining and before every expansion pass. It
// walks the authored tree, loads `<root>/templates/<name>.template.json` and
// `<root>/behaviors/<name>.behavior.json` for each distinct reference, and
// merges them into the composition's own `templates{}` / `behaviors{}` blocks
// **under their prefixed key** — so `expandTemplates` / `expandBehaviors`
// resolve `global:ctaButton` by an ordinary map lookup and no expansion pass
// learns about the library at all. Loaded definitions are scanned in turn, so
// a library template whose tweens use a library behavior resolves too.
//
// Authoring wins over the library: a `templates: { "global:ctaButton": … }`
// key written in the composition shadows the file on disk, which is how a
// composition pins a definition it does not want re-resolved.
//
// Scheme, not namespace: `global:` mirrors the asset-src prefix
// (`src/assets/node.ts#resolveGlobalSrc`) and has one colon. The `alias::name`
// form of §12.3 stays reserved — `idSchema` still rejects `::` in an id.
//
// Node only. The library is a directory on disk; a browser host gets
// `E_FEATURE_UNAVAILABLE` naming the inline alternative rather than a
// bundler-time import failure — which is also why `node:path` and
// `../assets/node.js` are *lazily* imported here (the compose layer is part
// of the browser bundle; see the same note in `imports.ts`).

import { MCPToolError } from "../engine/errors.js";
import { defaultReadFile, type ReadFile } from "./imports.js";

/** `global:` — the only scheme the library resolver understands today. */
const GLOBAL_PREFIX = "global:";

export interface ResolveLibraryRefsOptions {
  /**
   * Custom file reader, shared with `$ref` resolution. Defaults to
   * `fs/promises#readFile` with utf-8 encoding.
   */
  readFile?: ReadFile;
  /**
   * Library root override. Defaults to `$DAVIDUP_LIBRARY`, else
   * `~/.davidup/library` — the same rule the asset loader applies to
   * `global:` srcs (`defaultGlobalLibraryRoot`).
   */
  libraryRoot?: string;
}

interface LibraryRefs {
  templates: Set<string>;
  behaviors: Set<string>;
}

/**
 * Inline every `global:`-prefixed `$template` / `$behavior` reference's
 * definition into the composition's compile-time blocks.
 *
 * Returns the input unchanged (same reference) when there are no `global:`
 * references anywhere, so the pass costs one walk and no I/O for the common
 * case.
 *
 * Throws `MCPToolError`:
 *   - `E_FEATURE_UNAVAILABLE` — not running on Node, so there is no library.
 *   - `E_TEMPLATE_UNKNOWN` / `E_BEHAVIOR_UNKNOWN` — no such file under the
 *     library root; the message names the path it looked for.
 *   - `E_INVALID_VALUE` — malformed reference name, or a file that is not a
 *     JSON object.
 */
export async function resolveLibraryRefs(
  comp: unknown,
  options: ResolveLibraryRefsOptions = {},
): Promise<unknown> {
  const refs: LibraryRefs = { templates: new Set(), behaviors: new Set() };
  collectRefs(comp, refs);
  if (refs.templates.size === 0 && refs.behaviors.size === 0) return comp;
  if (!isPlainObject(comp)) return comp;

  const { join, root } = await resolveLibraryPaths(options.libraryRoot);
  const read = options.readFile ?? defaultReadFile;

  const templates: Record<string, unknown> = {};
  const behaviors: Record<string, unknown> = {};
  // Transitive: a loaded definition may reference further library entries.
  // Sorted queues keep the order definitions are read (and therefore which
  // missing file is reported first) independent of authoring order.
  const pendingTemplates = [...refs.templates].sort();
  const pendingBehaviors = [...refs.behaviors].sort();
  while (pendingTemplates.length > 0 || pendingBehaviors.length > 0) {
    const next: LibraryRefs = { templates: new Set(), behaviors: new Set() };
    for (const name of pendingTemplates.splice(0)) {
      const key = GLOBAL_PREFIX + name;
      if (key in templates) continue;
      templates[key] = await loadDefinition(
        read,
        join(root, "templates", `${name}.template.json`),
        "template",
        name,
      );
      collectRefs(templates[key], next);
    }
    for (const name of pendingBehaviors.splice(0)) {
      const key = GLOBAL_PREFIX + name;
      if (key in behaviors) continue;
      behaviors[key] = await loadDefinition(
        read,
        join(root, "behaviors", `${name}.behavior.json`),
        "behavior",
        name,
      );
      collectRefs(behaviors[key], next);
    }
    for (const n of [...next.templates].sort()) {
      if (!(GLOBAL_PREFIX + n in templates)) pendingTemplates.push(n);
    }
    for (const n of [...next.behaviors].sort()) {
      if (!(GLOBAL_PREFIX + n in behaviors)) pendingBehaviors.push(n);
    }
  }

  const out: Record<string, unknown> = { ...comp };
  mergeBlock(out, "templates", templates);
  mergeBlock(out, "behaviors", behaviors);
  return out;
}

/**
 * Merge loaded definitions under `key`, letting anything the composition
 * authored itself win. A non-object authored block is left exactly as it is
 * so the expansion pass reports it (`\`templates\` must be an object …`)
 * instead of this pass silently replacing it.
 */
function mergeBlock(
  out: Record<string, unknown>,
  key: "templates" | "behaviors",
  loaded: Record<string, unknown>,
): void {
  if (Object.keys(loaded).length === 0) return;
  const authored = out[key];
  if (authored === undefined) {
    out[key] = loaded;
  } else if (isPlainObject(authored)) {
    out[key] = { ...loaded, ...authored };
  }
}

// ──────────────── Reference collection ────────────────

function collectRefs(node: unknown, into: LibraryRefs): void {
  if (Array.isArray(node)) {
    for (const child of node) collectRefs(child, into);
    return;
  }
  if (!isPlainObject(node)) return;
  addRef(node.$template, into.templates, "template");
  addRef(node.$behavior, into.behaviors, "behavior");
  for (const v of Object.values(node)) collectRefs(v, into);
}

function addRef(
  value: unknown,
  into: Set<string>,
  kind: "template" | "behavior",
): void {
  if (typeof value !== "string" || !value.startsWith(GLOBAL_PREFIX)) return;
  const name = value.slice(GLOBAL_PREFIX.length);
  // The name is pasted into a filesystem path, so it must be a bare library
  // id — never a path that could climb out of the library root.
  if (name.length === 0 || /[\\/]/.test(name) || name.includes("..")) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `"${value}" is not a valid library ${kind} reference.`,
      `Use "global:<id>" with a bare library id, e.g. "global:ctaButton".`,
    );
  }
  into.add(name);
}

// ──────────────── Loading ────────────────

async function loadDefinition(
  read: ReadFile,
  path: string,
  kind: "template" | "behavior",
  name: string,
): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await read(path);
  } catch (err) {
    throw new MCPToolError(
      kind === "template" ? "E_TEMPLATE_UNKNOWN" : "E_BEHAVIOR_UNKNOWN",
      `Library ${kind} "${name}" not found at ${path} (${(err as Error).message}).`,
      `Run \`bun run seed:library\`, point $DAVIDUP_LIBRARY at the right root, or define "${name}" in the composition's \`${kind}s\` block.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Library ${kind} "${name}" is not valid JSON (${path}): ${(err as Error).message}`,
    );
  }
  if (!isPlainObject(parsed)) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Library ${kind} "${name}" must be a JSON object (${path}).`,
    );
  }
  return parsed;
}

// ──────────────── Node-only plumbing ────────────────

interface LibraryPaths {
  join: (...parts: string[]) => string;
  root: string;
}

async function resolveLibraryPaths(override?: string): Promise<LibraryPaths> {
  if (
    typeof process === "undefined" ||
    process.versions === undefined ||
    process.versions.node === undefined
  ) {
    throw featureUnavailable();
  }
  try {
    // Lazy + non-literal specifiers: browser bundlers must not try to resolve
    // `node:path` (or, through `../assets/node.js`, `node:os`) at build time.
    const pathSpecifier = "node:path";
    const nodePath = (await import(/* @vite-ignore */ pathSpecifier)) as {
      join: (...parts: string[]) => string;
    };
    if (override !== undefined && override.length > 0) {
      return { join: nodePath.join, root: override };
    }
    const assetsSpecifier = "../assets/node.js";
    const assets = (await import(/* @vite-ignore */ assetsSpecifier)) as {
      defaultGlobalLibraryRoot: () => string;
    };
    return { join: nodePath.join, root: assets.defaultGlobalLibraryRoot() };
  } catch (err) {
    if (err instanceof MCPToolError) throw err;
    throw featureUnavailable((err as Error).message);
  }
}

function featureUnavailable(detail?: string): MCPToolError {
  return new MCPToolError(
    "E_FEATURE_UNAVAILABLE",
    `\`global:\` templates and behaviors are read from the on-disk library, which is only available on Node${
      detail !== undefined ? ` (${detail})` : ""
    }.`,
    "Inline the definition in the composition's `templates` / `behaviors` block, or precompile on the server and hand the browser the canonical output.",
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
