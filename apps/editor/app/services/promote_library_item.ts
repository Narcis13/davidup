// Library promotion — move a project-scoped library definition into the
// global pool so every project sees it.
//
// Supported:
//   * `template`, `behavior`, `scene` — file-backed JSON definitions stored
//     as `<id>.template.json` / `<id>.behavior.json` / `<id>.scene.json`.
//     Read the project file's bytes, write them under the global root, then
//     unlink the project copy.
//   * `asset`, `font` (v1.1 S29) — `index.json` entries. The entry moves from
//     the project index to the global one; its binary (when the src is a local
//     file) is copied to `<global>/{assets,fonts}/<basename>` and the src is
//     rewritten to `global:{assets,fonts}/<basename>`, the global pool's own
//     encoding. The project copy of the binary is removed unless the open
//     composition still loads it.
//
// Out of scope: inline template/behavior/scene definitions written into
// `<root>/library/index.json` — move them to their own file first.
//
// The library watcher picks every write up within ~1s; we also force a
// reload so the response reflects the merged catalog.

import { promises as fs } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import libraryIndex, {
  indexEntryId,
  type LibraryItem,
  type LibraryItemKind,
} from '#services/library_index'
import projectStore from '#services/project_store'

export type PromotableKind = 'template' | 'behavior' | 'scene' | 'asset' | 'font'

export const PROMOTABLE_KINDS: ReadonlySet<LibraryItemKind> = new Set([
  'template',
  'behavior',
  'scene',
  'asset',
  'font',
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
      `Promotion for kind "${kind}" is not supported. Supported: ${[...PROMOTABLE_KINDS].join(', ')}.`,
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
  if (promotableKind === 'asset' || promotableKind === 'font') {
    return promoteIndexEntry(promotableKind, id, projectRoot, globalRoot, opts.force === true)
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

type IndexKind = 'asset' | 'font'
type IndexDoc = Record<string, unknown>

const INDEX_KEY: Record<IndexKind, 'assets' | 'fonts'> = { asset: 'assets', font: 'fonts' }
const SRC_FIELDS = ['url', 'src', 'path'] as const

async function readIndex(path: string): Promise<IndexDoc> {
  const raw = await fs.readFile(path, 'utf8').catch((err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new PromoteError('E_PROMOTE_FAILED', `Failed to read ${path}: ${(err as Error).message}`)
  })
  if (raw === null) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as IndexDoc
  } catch {
    /* fall through */
  }
  throw new PromoteError('E_PROMOTE_FAILED', `${path} is not a JSON object; fix it before promoting.`)
}

async function writeIndex(path: string, doc: IndexDoc): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, path)
}

function entriesOf(doc: IndexDoc, kind: IndexKind): Record<string, unknown>[] {
  const list = doc[INDEX_KEY[kind]]
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : []
}

function findEntry(doc: IndexDoc, kind: IndexKind, id: string): number {
  return entriesOf(doc, kind).findIndex(
    (e) => !!e && typeof e === 'object' && indexEntryId(kind, e) === id,
  )
}

function isRemoteSrc(src: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('global:')
}

/** Project library srcs resolve against the library root first, then the project root (as the thumbnailer does). */
async function resolveLocalFile(libraryRoot: string, src: string): Promise<string | null> {
  const stripped = src.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '')
  const candidates = isAbsolute(src)
    ? [src]
    : [join(libraryRoot, stripped), join(dirname(libraryRoot), stripped)]
  for (const c of candidates) {
    const stat = await fs.stat(c).catch(() => null)
    if (stat?.isFile()) return c
  }
  return null
}

/** True when the loaded composition registers an asset whose src is `file`. */
function compositionUsesFile(file: string): boolean {
  const project = projectStore.project
  const assets = (project?.composition as { assets?: unknown } | null)?.assets
  if (!project || !Array.isArray(assets)) return false
  return assets.some((a) => {
    const src = (a as { src?: unknown })?.src
    return typeof src === 'string' && !isRemoteSrc(src) && resolve(project.root, src) === file
  })
}

async function promoteIndexEntry(
  kind: IndexKind,
  id: string,
  projectRoot: string,
  globalRoot: string,
  force: boolean,
): Promise<PromoteResult> {
  const projectIndexPath = join(projectRoot, 'index.json')
  const globalIndexPath = join(globalRoot, 'index.json')
  const projectDoc = await readIndex(projectIndexPath)
  const at = findEntry(projectDoc, kind, id)
  if (at < 0) {
    throw new PromoteError('E_ITEM_NOT_FOUND', `No ${kind} with id "${id}" in the project library index.json.`)
  }
  const entry = entriesOf(projectDoc, kind)[at]!
  const srcField = SRC_FIELDS.find((f) => typeof entry[f] === 'string' && (entry[f] as string).length > 0)
  const src = srcField ? (entry[srcField] as string) : null

  // Local binary → copy under the canonical global subdir.
  let fromFile: string | null = null
  let toRelative: string | null = null
  let bytes: Buffer | null = null
  if (src !== null && !isRemoteSrc(src)) {
    fromFile = await resolveLocalFile(projectRoot, src)
    if (!fromFile) {
      throw new PromoteError('E_ITEM_NOT_FOUND', `The ${kind} file "${src}" for "${id}" was not found in the project.`)
    }
    bytes = await fs.readFile(fromFile)
    toRelative = `${INDEX_KEY[kind]}/${basename(fromFile)}`
  }
  const toFile = toRelative ? join(globalRoot, toRelative) : null

  const globalDoc = await readIndex(globalIndexPath)
  const existingAt = findEntry(globalDoc, kind, id)
  if (!force) {
    const clash =
      existingAt >= 0
        ? `Global library already has ${kind} "${id}".`
        : toFile && bytes
          ? await fs
              .readFile(toFile)
              .then((b) => (b.equals(bytes!) ? null : `Global library already has a different ${toRelative}.`))
              .catch(() => null)
          : null
    if (clash) {
      throw new PromoteError('E_TARGET_EXISTS', `${clash} Pass force=true to overwrite.`, {
        existingPath: toFile ?? globalIndexPath,
        existingRelative: toRelative ?? 'index.json',
      })
    }
  }

  const promoted = srcField && toRelative ? { ...entry, [srcField]: `global:${toRelative}` } : { ...entry }
  const globalList = [...entriesOf(globalDoc, kind)]
  if (existingAt >= 0) globalList[existingAt] = promoted
  else globalList.push(promoted)
  const projectList = entriesOf(projectDoc, kind).filter((_, i) => i !== at)

  const priorTarget = toFile ? await fs.readFile(toFile).catch(() => null) : null
  if (toFile && bytes) {
    await fs.mkdir(dirname(toFile), { recursive: true })
    await fs.writeFile(toFile, bytes)
  }
  try {
    await writeIndex(globalIndexPath, { ...globalDoc, [INDEX_KEY[kind]]: globalList })
    try {
      await writeIndex(projectIndexPath, { ...projectDoc, [INDEX_KEY[kind]]: projectList })
    } catch (err) {
      await writeIndex(globalIndexPath, globalDoc).catch(() => {})
      throw err
    }
  } catch (err) {
    // Roll the copied binary back so the global pool is unchanged.
    if (toFile && bytes) {
      if (priorTarget) await fs.writeFile(toFile, priorTarget).catch(() => {})
      else await fs.unlink(toFile).catch(() => {})
    }
    throw new PromoteError('E_PROMOTE_FAILED', `Failed to move ${kind} "${id}": ${(err as Error).message}. Rolled back.`)
  }

  // Drop the project copy of the binary unless something still loads it:
  // another project entry with the same src, or the open composition.
  if (fromFile) {
    const stillListed = projectList.some((e) => SRC_FIELDS.some((f) => e?.[f] === src))
    if (!stillListed && !compositionUsesFile(fromFile)) {
      await fs.unlink(fromFile).catch(() => {})
    }
  }

  await libraryIndex.reloadNow()

  return {
    kind,
    id,
    from: fromFile ?? projectIndexPath,
    to: toFile ?? globalIndexPath,
    toRelative: toRelative ?? 'index.json',
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
