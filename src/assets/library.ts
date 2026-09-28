// The asset library from davidup's Node side (docs/asset-library-plan.md D1).
//
// An `asset:<id>[@sha12]` src (assetSrc.ts) is resolved here, against the
// standard shelves in search order: the project's `assets/`, the user's pool
// (`$DAVIDUP_ASSETS`, else ~/.davidup/assets), the house shelf
// (`$DAVIDUP_HOUSE`). The project is the one the caller names — the render
// CLI names the composition's directory when it holds `assets/catalogue.json`
// ({@link assetProjectOf}), the editor its open project — else
// `$DAVIDUP_PROJECT`, else there is no project shelf.
//
// The shelves are read on every call: a catalogue is a few KB of JSON, and a
// long-lived process (the editor, the MCP server) sees a record the moment
// `asset add` writes it.

import { existsSync } from "node:fs";
import * as nodePath from "node:path";
import {
  openLibrary,
  standardShelves,
  type AssetRecord,
  type Library,
  type Previewers,
} from "../../assetlib/index.js";
import { parseAssetSrc } from "./assetSrc.js";

export type AssetRefErrorCode = "E_ASSET_MISSING" | "E_ASSET_STALE" | "E_ASSET_INVALID";

/** An `asset:` src that does not resolve: a bad ref, no such record, or a pin the record has moved from. */
export class AssetRefError extends Error {
  readonly code: AssetRefErrorCode;
  constructor(code: AssetRefErrorCode, message: string) {
    super(message);
    this.name = "AssetRefError";
    this.code = code;
  }
}

export interface AssetLibraryOptions {
  /** The project directory whose `assets/` is searched first. Default `$DAVIDUP_PROJECT`. */
  project?: string | undefined;
  /** The environment the shelves are read from (tests). Default `process.env`. */
  env?: Record<string, string | undefined>;
  /** The home directory the user's pool defaults under (tests). */
  home?: string;
  /** What draws each kind's preview (assetlib's `loadHosts().previewers`); default none, the card. */
  previewers?: Previewers;
}

export interface ResolvedLibraryAsset {
  /** The blob's absolute path. */
  path: string;
  /** The record as the library returns it (entry + id, media, shelf, shadowed). */
  record: AssetRecord;
  /** The shelf it resolved on. */
  shelf: string;
  /** The shelf root it resolved on (`<root>/blobs/<sha>.<ext>` is `path`). */
  root: string;
}

/**
 * `dir` when it holds an asset shelf (`dir/assets/catalogue.json`), else
 * undefined — the rule the render CLI uses to take the composition's
 * directory as the project.
 */
export function assetProjectOf(dir: string): string | undefined {
  return existsSync(nodePath.join(dir, "assets", "catalogue.json")) ? dir : undefined;
}

/** The standard shelves, `project` first when there is one. */
export function openAssetLibrary(opts: AssetLibraryOptions = {}): Library {
  const env = opts.env ?? process.env;
  const project = opts.project ?? (env.DAVIDUP_PROJECT || undefined);
  return openLibrary({
    shelves: standardShelves({
      ...(project !== undefined ? { project } : {}),
      env,
      ...(opts.home !== undefined ? { home: opts.home } : {}),
    }),
    ...(opts.previewers !== undefined ? { previewers: opts.previewers } : {}),
  });
}

/**
 * Resolve an `asset:` src to its blob and record. Throws {@link AssetRefError}:
 * `E_ASSET_INVALID` for a src that is not `asset:<id>[@hex]` or a shelf that
 * cannot be read, `E_ASSET_MISSING` naming the shelves searched, and
 * `E_ASSET_STALE` when the pin is not the record's sha.
 */
export function resolveLibraryAsset(
  src: string,
  opts: AssetLibraryOptions = {},
): ResolvedLibraryAsset {
  let ref;
  try {
    ref = parseAssetSrc(src);
  } catch (err) {
    throw new AssetRefError("E_ASSET_INVALID", (err as Error).message);
  }
  if (!ref) throw new AssetRefError("E_ASSET_INVALID", `"${src}" is not an asset: src`);

  let lib: Library;
  try {
    lib = openAssetLibrary(opts);
  } catch (err) {
    throw new AssetRefError("E_ASSET_INVALID", `${src}: ${(err as Error).message}`);
  }
  if (!lib.has(ref.id)) {
    const searched = lib.shelves.map((s) => `${s.name} (${s.root})`).join(", ");
    throw new AssetRefError(
      "E_ASSET_MISSING",
      `${src}: no asset '${ref.id}' on shelves ${searched}. \`asset find\` searches them; \`asset add\` puts a file on one.`,
    );
  }
  const loc = lib.locate(ref.id);
  const sha = String(loc.entry.sha ?? "");
  if (ref.pin !== undefined && !sha.startsWith(ref.pin)) {
    throw new AssetRefError(
      "E_ASSET_STALE",
      `${src} is pinned to ${ref.pin}, but '${ref.id}' on shelf ${loc.shelf} is now ${sha.slice(0, 12)}. ` +
        `Re-pin to asset:${ref.id}@${sha.slice(0, 12)}, or drop the pin to follow the record.`,
    );
  }
  return { path: loc.path, record: lib.get(ref.id), shelf: loc.shelf, root: loc.root };
}
