// `/asset-files/*` — the asset library's blobs for the browser (asset library
// plan D1). Two forms:
//
//   /asset-files/<id>[@<sha12>]           a record, resolved like an
//                                         `asset:<id>[@sha12]` src: the project's
//                                         shelf, then the user's pool, then the
//                                         house shelf (the browser loader's URL)
//   /asset-files/<shelf>/<sha>.<ext>      one blob on a named shelf
//
// Nothing outside the three shelves' `blobs/` directories is ever served: a
// record's path comes from its catalogue entry (sha + ext), and the blob form
// accepts only a shelf name and a sha256 file name.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AssetRefError, openAssetLibrary, resolveLibraryAsset } from 'davidup/assets'

export type AssetFileAnswer =
  | { ok: true; path: string; immutable: boolean }
  | { ok: false; status: 400 | 404 | 409; code: string; message: string }

const BLOB_RE = /^[0-9a-f]{64}\.[a-z0-9]+$/

export function resolveAssetFile(
  segments: string[],
  project: string | undefined
): AssetFileAnswer {
  if (segments.length === 1) {
    const ref = segments[0]!
    try {
      const { path } = resolveLibraryAsset(`asset:${ref}`, { project })
      if (!existsSync(path)) {
        return { ok: false, status: 404, code: 'E_FILE_NOT_FOUND', message: `asset:${ref}: blob missing at ${path}` }
      }
      return { ok: true, path, immutable: ref.includes('@') }
    } catch (err) {
      if (!(err instanceof AssetRefError)) throw err
      const status = err.code === 'E_ASSET_STALE' ? 409 : err.code === 'E_ASSET_MISSING' ? 404 : 400
      return { ok: false, status, code: err.code, message: err.message }
    }
  }
  if (segments.length === 2) {
    const [shelfName, blob] = segments as [string, string]
    if (!BLOB_RE.test(blob)) {
      return { ok: false, status: 400, code: 'E_ASSET_INVALID', message: `${blob} is not <sha256>.<ext>` }
    }
    const shelf = openAssetLibrary({ project }).shelves.find((s) => s.name === shelfName)
    if (!shelf) {
      return { ok: false, status: 404, code: 'E_ASSET_MISSING', message: `no shelf '${shelfName}'` }
    }
    const path = join(shelf.root, 'blobs', blob)
    if (!existsSync(path)) {
      return { ok: false, status: 404, code: 'E_FILE_NOT_FOUND', message: `no blob ${blob} on shelf ${shelfName}` }
    }
    return { ok: true, path, immutable: true }
  }
  return {
    ok: false,
    status: 400,
    code: 'E_ASSET_INVALID',
    message: 'use /asset-files/<id>[@<sha12>] or /asset-files/<shelf>/<sha>.<ext>',
  }
}
