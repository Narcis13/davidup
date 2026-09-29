// Asset upload pipeline — step 18 of the editor build plan, on the asset
// library since E2 (docs/asset-library-plan.md).
//
// A file dropped on the editor is put on an asset library shelf: the open
// project's `assets/` (target `project`), or the user's pool,
// `~/.davidup/assets` or `$DAVIDUP_ASSETS` (target `global`). The put is the
// MCP `add_asset` tool's, so an upload and an agent's `add_asset` are the same
// door: sha256, the kind's fields read off the file (a raster's size, alpha and
// palette; a video's or audio's streams through ffprobe; a font's family; a
// cutout's silhouette by hdf when it sits beside davidup), validation before
// anything is written, the catalogue written atomically.
//
//   - kind: from the extension (image, video, audio, font), or the form's
//     `kind` (`cutout`, `stock`, `sample`, ...).
//   - id: the file's name as an id (`Warm Paper.png` → `warm-paper`), with
//     `-2`, `-3`, ... when a shelf already holds the id, so an upload never
//     shadows or replaces another record.
//   - the same bytes again: the record the shelf already holds for them is
//     returned (`status: 'unchanged bytes'`), whatever the file is called now.
//   - provenance: `licence` defaults to `own` for a file the user dropped, with
//     a warning saying so; `credit`, `source`, `tags`, `name`, `desc` come from
//     the form.
//
// The Library panel lists the record once the shelf's catalogue is re-read,
// which this pipeline asks for before it returns.

import { mkdtemp, rename, copyFile, unlink, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { CompositionStore, TOOLS, dispatchTool } from 'davidup/mcp'
import {
  ID,
  LICENCES,
  assetSrc,
  openLibrary,
  sha,
  standardShelves,
  type Licence,
} from 'davidup/assetlib'
import projectStore from '#services/project_store'
import libraryIndex from '#services/library_index'

export type AssetKind = 'image' | 'video' | 'audio' | 'font'

export type AssetTarget = 'project' | 'global'

/** What the upload answers: the record as the shelf now holds it, and where. */
export interface AssetRecord {
  id: string
  /** The record's kind (`image`, `cutout`, `video`, `sample`, `font`, ...). */
  kind: string
  name: string
  /** `project` or `user`. */
  shelf: string
  /** The pinned src a composition registers it by: `asset:<id>@<sha12>`. */
  src: string
  sha: string
  ext: string
  bytes: number
  licence: string
  credit: string
  source: string
  tags: string[]
  added?: string
  w?: number
  h?: number
  sec?: number
  family?: string
  [field: string]: unknown
}

export interface AssetIngestResult {
  asset: AssetRecord
  /** `new`, or `unchanged bytes` when the shelf already held these bytes. */
  status: 'new' | 'unchanged bytes'
  /** What the put noticed (a licence defaulted, a probe missing, ...). */
  warnings: string[]
}

/** The record's own fields a form may give. */
export interface AssetIngestFields {
  kind?: string
  name?: string
  licence?: string
  credit?: string
  source?: string
  tags?: string[]
  desc?: string
  family?: string
}

export interface AssetIngestInput extends AssetIngestFields {
  /** Absolute path to the source bytes (the tmp file produced by bodyparser). */
  tmpPath: string
  /** Original filename as supplied by the client (used for display + ext hint). */
  clientName: string
  /** MIME type sent by the client. May be empty / generic. */
  contentType?: string
  /** Pre-computed size (bytes). Unused: the shelf counts the bytes it holds. */
  size?: number
  /**
   * Which shelf to put on. `'project'` (default) is `<project>/assets/`;
   * `'global'` is the user's pool (`$DAVIDUP_ASSETS`, else ~/.davidup/assets).
   */
  target?: AssetTarget
}

export type AssetIngestErrorCode =
  | 'E_NO_PROJECT'
  | 'E_UNSUPPORTED_TYPE'
  | 'E_INVALID_VALUE'
  | 'E_INGEST_FAILED'

export class AssetIngestError extends Error {
  code: AssetIngestErrorCode
  details?: unknown
  constructor(code: AssetIngestErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AssetIngestError'
    this.code = code
    this.details = details
  }
}

const KIND_BY_EXT: Record<string, AssetKind> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.svg': 'image',
  '.mp4': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.mkv': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.ogg': 'audio',
  '.m4a': 'audio',
  '.aac': 'audio',
  '.flac': 'audio',
  '.ttf': 'font',
  '.otf': 'font',
  '.woff': 'font',
  '.woff2': 'font',
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'font/ttf': '.ttf',
  'font/otf': '.otf',
  'font/woff': '.woff',
  'font/woff2': '.woff2',
  // Legacy / non-standard MIME types browsers still send for fonts.
  'application/font-sfnt': '.ttf',
  'application/x-font-ttf': '.ttf',
  'application/x-font-otf': '.otf',
  'application/font-woff': '.woff',
  'application/font-woff2': '.woff2',
}

/** The file's extension (from its name, else its MIME type) and the davidup kind it is. */
function detect(
  clientName: string,
  contentType: string | undefined
): { ext: string; kind: AssetKind } | null {
  const ext = extname(clientName.toLowerCase())
  if (ext && KIND_BY_EXT[ext]) return { ext, kind: KIND_BY_EXT[ext]! }
  const mapped = EXT_BY_MIME[(contentType ?? '').toLowerCase().split(';')[0]!.trim()]
  return mapped ? { ext: mapped, kind: KIND_BY_EXT[mapped]! } : null
}

function safeDisplayName(clientName: string): string {
  // Strip any path components a malicious client might inject.
  const base = clientName.split(/[\\/]/).pop() ?? clientName
  return base.length > 0 ? base : 'asset'
}

/** A file name as a library id: `Warm Paper (2).png` → `warm-paper-2`; `asset` when nothing is left. */
export function idOfFileName(stem: string): string {
  const id = stem
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '')
  return id && ID.test(id) ? id : 'asset'
}

async function moveOrCopy(src: string, dst: string): Promise<void> {
  // rename() fails across filesystems (EXDEV) — bodyparser tmp dir is often
  // on /tmp while the project lives in the user's home. Try rename first,
  // fall back to copy + unlink.
  try {
    await rename(src, dst)
    return
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES') throw err
  }
  await copyFile(src, dst)
  await unlink(src).catch(() => {})
}

const ADD_ASSET = TOOLS.find((t) => t.name === 'add_asset')

const OWN_WARNING =
  'Licence set to own: you dropped the file. If it is not yours, set its licence and credit.'

export class AssetPipeline {
  async ingest(input: AssetIngestInput): Promise<AssetIngestResult> {
    const target: AssetTarget = input.target ?? 'project'
    // The open project's shelf is read either way (an id it holds is taken);
    // it is written only for target `project`.
    const project = projectStore.project?.root
    if (target === 'project' && !project) {
      throw new AssetIngestError('E_NO_PROJECT', 'No project loaded')
    }
    const shelf = target === 'project' ? 'project' : 'user'

    const displayName = safeDisplayName(input.clientName)
    const detected = detect(displayName, input.contentType)
    if (!detected) {
      throw new AssetIngestError(
        'E_UNSUPPORTED_TYPE',
        `Unsupported file type for "${displayName}" (content-type: ${input.contentType ?? 'unknown'})`
      )
    }
    if (input.licence !== undefined && !(LICENCES as readonly string[]).includes(input.licence)) {
      throw new AssetIngestError(
        'E_INVALID_VALUE',
        `Unknown licence "${input.licence}". Allowed: ${LICENCES.join(', ')}.`
      )
    }
    const stem =
      displayName.slice(0, displayName.length - extname(displayName).length) || displayName
    const bytes = await readFile(input.tmpPath)
    const hex = sha(bytes)

    // The same bytes on the target shelf: that record, not a second one.
    const lib = openLibrary({ shelves: standardShelves(project ? { project } : {}) })
    const held = lib.shelves.some((s) => s.name === shelf)
      ? [...lib.shelf(shelf).entries].find(([, e]) => e.sha === hex)
      : undefined
    if (held) {
      await unlink(input.tmpPath).catch(() => {})
      const [id] = held
      return { asset: recordOn(lib, shelf, id), status: 'unchanged bytes', warnings: [] }
    }

    // An id no shelf holds, so the upload neither replaces nor shadows a record.
    const base = idOfFileName(stem)
    let id = base
    for (let n = 2; lib.shelves.some((s) => s.has(id)); n++) id = `${base}-${n}`

    // add_asset reads a file; it is named as the user named it, since the
    // extension says what an audio, video or font payload is.
    const dir = await mkdtemp(join(tmpdir(), 'davidup-upload-'))
    const file = join(dir, `${stem.replace(/[^\w.() -]+/g, '_') || 'asset'}${detected.ext}`)
    try {
      await moveOrCopy(input.tmpPath, file)
      const kind = input.kind ?? detected.kind
      const licence = (input.licence ?? 'own') as Licence
      // assetlib reads a TrueType, OpenType or WOFF font's family, not a WOFF2's.
      const family =
        input.family ?? (kind === 'font' && detected.ext === '.woff2' ? stem : undefined)
      const args: Record<string, unknown> = {
        path: file,
        id,
        kind,
        name: input.name ?? stem,
        licence,
        shelf,
        ...(input.credit !== undefined ? { credit: input.credit } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.desc !== undefined ? { desc: input.desc } : {}),
        ...(family !== undefined ? { family } : {}),
      }
      if (!ADD_ASSET)
        throw new AssetIngestError('E_INGEST_FAILED', 'This davidup has no add_asset tool.')
      const out = await dispatchTool(ADD_ASSET, args, {
        store: new CompositionStore(),
        ...(project ? { assetProject: project } : {}),
      })
      if (!out.ok) {
        const code = out.error.code === 'E_INVALID_VALUE' ? 'E_INVALID_VALUE' : 'E_INGEST_FAILED'
        throw new AssetIngestError(code, out.error.message, {
          code: out.error.code,
          ...(out.error.hint ? { hint: out.error.hint } : {}),
        })
      }
      const result = out.result as { warnings?: string[] }
      const warnings = [...(result.warnings ?? [])]
      if (input.licence === undefined) warnings.unshift(OWN_WARNING)
      // The panel lists the record now rather than on the shelf's next poll.
      await libraryIndex.reloadNow().catch(() => {})
      const after = openLibrary({ shelves: standardShelves(project ? { project } : {}) })
      return { asset: recordOn(after, shelf, id), status: 'new', warnings }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/** The record `id` on `shelf`, with its shelf and pinned src, without its bulky fields. */
function recordOn(lib: ReturnType<typeof openLibrary>, shelf: string, id: string): AssetRecord {
  const entry = { ...lib.shelf(shelf).entry(id) } as Record<string, unknown>
  for (const k of ['sil', 'align', 'mouth']) delete entry[k]
  return {
    ...entry,
    id,
    shelf,
    src: assetSrc({ ...(entry as { sha: string }), id }),
  } as AssetRecord
}

const assetPipeline = new AssetPipeline()
export default assetPipeline
