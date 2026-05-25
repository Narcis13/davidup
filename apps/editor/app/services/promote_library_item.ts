// Library promotion — move a project-scoped library definition into the
// global pool so every project sees it.
//
// In scope for v1:
//   * `template`, `behavior`, `scene` — file-backed JSON definitions stored
//     as `<id>.template.json` / `<id>.behavior.json` / `<id>.scene.json`.
//
// Out of scope:
//   * inline definitions written into `<root>/library/index.json` — they
//     don't have a standalone file to move; promoting them would require
//     surgical edits to two index files.
//   * assets / fonts — promoting these means moving the binary AND its
//     index.json entry, with hash/path rewrites. Deferred.
//
// The flow is intentionally narrow: read the project file's bytes, write
// them under the global root, then unlink the project copy. The library
// watcher picks both events up within ~1s and the merged catalog converges.

import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import libraryIndex, {
  type LibraryItem,
  type LibraryItemKind,
} from '#services/library_index'

export type PromotableKind = 'template' | 'behavior' | 'scene'

const PROMOTABLE_KINDS: ReadonlySet<LibraryItemKind> = new Set([
  'template',
  'behavior',
  'scene',
])

export type PromoteErrorCode =
  | 'E_BAD_REQUEST'
  | 'E_KIND_UNSUPPORTED'
  | 'E_NO_PROJECT_LIBRARY'
  | 'E_NO_GLOBAL_LIBRARY'
  | 'E_ITEM_NOT_FOUND'
  | 'E_INLINE_ITEM'
  | 'E_TARGET_EXISTS'
  | 'E_PROMOTE_FAILED'

export class PromoteError extends Error {
  code: PromoteErrorCode
  details?: unknown
  constructor(code: PromoteErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'PromoteError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export interface PromoteResult {
  kind: PromotableKind
  id: string
  /** Absolute path of the source file inside the project library. */
  from: string
  /** Absolute path of the destination file inside the global library. */
  to: string
  /** Path relative to the global library root — used by the UI for hints. */
  toRelative: string
}

export interface PromoteOptions {
  kind: LibraryItemKind
  id: string
  /**
   * When the target file already exists, overwrite it. Without `force` the
   * service raises E_TARGET_EXISTS so the caller can confirm with the user.
   */
  force?: boolean
}

export async function promoteLibraryItem(opts: PromoteOptions): Promise<PromoteResult> {
  const { kind, id } = opts
  if (!id || typeof id !== 'string') {
    throw new PromoteError('E_BAD_REQUEST', '`id` is required')
  }
  if (!PROMOTABLE_KINDS.has(kind)) {
    throw new PromoteError(
      'E_KIND_UNSUPPORTED',
      `Promotion for kind "${kind}" is not implemented yet. Supported: template, behavior, scene.`,
    )
  }
  const promotableKind = kind as PromotableKind

  const projectRoot = libraryIndex.root
  if (!projectRoot) {
    throw new PromoteError(
      'E_NO_PROJECT_LIBRARY',
      'No project library is attached. Open a project first.',
    )
  }
  const globalRoot = libraryIndex.globalRoot
  if (!globalRoot) {
    throw new PromoteError(
      'E_NO_GLOBAL_LIBRARY',
      'Global library is not attached. Set DAVIDUP_LIBRARY or use ~/.davidup/library.',
    )
  }

  // Resolve the winning (kind,id) within the project scope only — the
  // merged catalog already discriminates by scope, so this picks the
  // project file even if a global copy exists with the same id.
  const candidates = libraryIndex.search({ kind: promotableKind, scope: 'project' })
  const item = candidates.find((c) => c.id === id)
  if (!item) {
    throw new PromoteError(
      'E_ITEM_NOT_FOUND',
      `No ${promotableKind} with id "${id}" in the project library.`,
    )
  }
  if (item.source === 'index.json') {
    throw new PromoteError(
      'E_INLINE_ITEM',
      `"${id}" is defined inline in <project>/library/index.json. Move it to its own *.${promotableKind}.json file first, then promote.`,
    )
  }

  const from = join(projectRoot, item.source)
  const toRelative = canonicalGlobalPath(promotableKind, item)
  const to = join(globalRoot, toRelative)

  // Confirm the source file is still readable so we don't leave a dangling
  // promotion record if the watcher's view is stale.
  const sourceBytes = await fs.readFile(from).catch((err) => {
    throw new PromoteError(
      'E_ITEM_NOT_FOUND',
      `Failed to read source file ${from}: ${(err as Error).message}`,
    )
  })

  const targetStat = await fs.stat(to).catch(() => null)
  if (targetStat && !opts.force) {
    throw new PromoteError(
      'E_TARGET_EXISTS',
      `Global library already has ${promotableKind} "${id}" at ${toRelative}. Pass force=true to overwrite.`,
      { existingPath: to, existingRelative: toRelative },
    )
  }

  await fs.mkdir(dirname(to), { recursive: true })
  // Write-then-unlink, not rename, because the two paths may live on
  // different filesystems (e.g. project on an external drive, global in
  // $HOME). `fs.rename` returns EXDEV across devices.
  await fs.writeFile(to, sourceBytes)
  try {
    await fs.unlink(from)
  } catch (err) {
    // Roll back the destination so the user doesn't end up with two copies.
    await fs.unlink(to).catch(() => {})
    throw new PromoteError(
      'E_PROMOTE_FAILED',
      `Wrote ${to} but failed to remove source ${from}: ${(err as Error).message}. Rolled back.`,
    )
  }

  // Watcher will pick this up on its own; force a synchronous re-read so
  // the response reflects the merged catalog and the UI doesn't show stale
  // state for ~1s. We use `reloadNow()` rather than `flush()` because the
  // file change might not have triggered a debounced reload yet.
  await libraryIndex.reloadNow()

  return {
    kind: promotableKind,
    id,
    from,
    to,
    toRelative: relative(globalRoot, to).split('\\').join('/'),
  }
}

function canonicalGlobalPath(kind: PromotableKind, item: LibraryItem): string {
  // Preserve the file basename (so an authored name like `card-glow` stays
  // readable in global), but force the canonical subdir. Authors sometimes
  // stash files under nested folders inside the project library; we don't
  // carry that hierarchy over because the global library has a single flat
  // layout per kind.
  const baseFromSource = item.source.split('/').pop() ?? `${item.id}.${kind}.json`
  // Make sure the basename matches `<something>.<kind>.json` so the global
  // watcher classifies it correctly. If the project file used a different
  // suffix (legacy or hand-edited), normalize to `<id>.<kind>.json`.
  const expected = `.${kind}.json`
  const base = baseFromSource.toLowerCase().endsWith(expected)
    ? baseFromSource
    : `${item.id}.${kind}.json`
  return `${kindSubdir(kind)}/${base}`
}

function kindSubdir(kind: PromotableKind): string {
  // Mirrors LIBRARY_SUBDIRS in global_library_root.ts. The plural form is
  // the on-disk convention; reading any subdir works because the watcher
  // scans the root recursively, but writing into the canonical one keeps
  // the layout predictable.
  return `${kind}s`
}
