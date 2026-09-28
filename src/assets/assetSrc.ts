// `asset:<id>[@<sha12>]` — a composition asset that names a record of the
// asset library (docs/asset-library-plan.md D1) instead of a path. Pure: the
// browser loader reads the scheme through here; the Node side resolves it
// against the shelves in `library.ts`.
//
//   asset:teapot                  the record `teapot`, wherever it now points
//   asset:teapot@611b2de0b430     only those bytes (12+ hex of the sha256);
//                                 E_ASSET_STALE when `teapot` has moved on
//
// Ids follow the library's rule (`assetlib/record.js` ID): flat, lower case,
// optionally `pack:`-prefixed.

export const ASSET_SRC_PREFIX = "asset:";

const REF_RE = /^((?:pack:)?[a-z0-9][a-z0-9-]*)(?:@([0-9a-f]{12,64}))?$/;

export interface AssetSrcRef {
  /** The library id. */
  id: string;
  /** The pinned sha prefix, when the src carries one. */
  pin?: string;
}

export function isAssetSrc(src: unknown): src is `asset:${string}` {
  return typeof src === "string" && src.startsWith(ASSET_SRC_PREFIX);
}

/**
 * The id and pin of an `asset:` src; `null` for any other src. Throws on an
 * `asset:` src that names no valid id or pin, so a typo is not read as a path.
 */
export function parseAssetSrc(src: string): AssetSrcRef | null {
  if (!isAssetSrc(src)) return null;
  const ref = src.slice(ASSET_SRC_PREFIX.length);
  const m = REF_RE.exec(ref);
  if (!m) {
    throw new Error(
      `"${src}" is not an asset src: use asset:<id> or asset:<id>@<sha12>, the id lower case (a-z, 0-9, -) and the pin 12 or more hex of the record's sha`,
    );
  }
  return m[2] !== undefined ? { id: m[1]!, pin: m[2] } : { id: m[1]! };
}
