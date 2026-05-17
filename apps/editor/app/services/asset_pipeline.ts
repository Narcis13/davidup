// Asset upload pipeline — step 18 of the editor build plan.
//
// Pipeline (per PRD §18):
//   1. Stream the upload into a temp file (handled by AdonisJS bodyparser).
//   2. Compute a SHA-256 content hash of the bytes.
//   3. Pick a deterministic filename `<hash><ext>` under `<library>/assets/`.
//   4. Detect kind (image | video | audio) and run ffprobe (for video/audio)
//      or read pixel dimensions (for image) to fill in metadata.
//   5. Extract a thumbnail PNG (video only — images are rendered by the
//      existing library_thumbnail service from the source file).
//   6. Register the asset entry in `<library>/index.json` (creating the
//      file if missing). Re-uploading the exact same bytes is a no-op and
//      returns the existing record.
//   7. Return the asset record.
//
// The pipeline is intentionally project-aware: it requires a loaded project
// and writes inside `<project>/library/assets/`. The library_index watcher
// picks up the new files on disk and the catalog refreshes within ~1s.

import { createHash } from 'node:crypto'
import { promises as fs, createReadStream } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { spawn } from 'node:child_process'
import logger from '@adonisjs/core/services/logger'
import projectStore from '#services/project_store'
import libraryIndex from '#services/library_index'

export type AssetKind = 'image' | 'video' | 'audio'

export interface AssetRecord {
  id: string
  name: string
  /** Path relative to the library root, e.g. `assets/<hash>.png`. */
  url: string
  kind: AssetKind
  mediaType: string
  size: number
  hash: string
  width?: number
  height?: number
  duration?: number
  /** Path relative to the library root, when one was extracted. */
  thumbnail?: string
  createdAt: string
}

export interface AssetIngestInput {
  /** Absolute path to the source bytes (the tmp file produced by bodyparser). */
  tmpPath: string
  /** Original filename as supplied by the client (used for display + ext hint). */
  clientName: string
  /** MIME type sent by the client. May be empty / generic. */
  contentType?: string
  /** Pre-computed size (bytes). Optional — stat() is used as fallback. */
  size?: number
}

export type AssetIngestErrorCode =
  | 'E_NO_PROJECT'
  | 'E_UNSUPPORTED_TYPE'
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

const MIME_BY_EXT: Record<string, { kind: AssetKind; mediaType: string }> = {
  '.png': { kind: 'image', mediaType: 'image/png' },
  '.jpg': { kind: 'image', mediaType: 'image/jpeg' },
  '.jpeg': { kind: 'image', mediaType: 'image/jpeg' },
  '.webp': { kind: 'image', mediaType: 'image/webp' },
  '.gif': { kind: 'image', mediaType: 'image/gif' },
  '.svg': { kind: 'image', mediaType: 'image/svg+xml' },
  '.mp4': { kind: 'video', mediaType: 'video/mp4' },
  '.mov': { kind: 'video', mediaType: 'video/quicktime' },
  '.webm': { kind: 'video', mediaType: 'video/webm' },
  '.mkv': { kind: 'video', mediaType: 'video/x-matroska' },
  '.mp3': { kind: 'audio', mediaType: 'audio/mpeg' },
  '.wav': { kind: 'audio', mediaType: 'audio/wav' },
  '.ogg': { kind: 'audio', mediaType: 'audio/ogg' },
  '.m4a': { kind: 'audio', mediaType: 'audio/mp4' },
  '.aac': { kind: 'audio', mediaType: 'audio/aac' },
  '.flac': { kind: 'audio', mediaType: 'audio/flac' },
}

const MIME_TO_EXT: Record<string, string> = {
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
}

function detectMediaType(clientName: string, contentType: string | undefined): {
  ext: string
  kind: AssetKind
  mediaType: string
} | null {
  const lcName = clientName.toLowerCase()
  const ext = extname(lcName)
  if (ext && MIME_BY_EXT[ext]) {
    return { ext, ...MIME_BY_EXT[ext] }
  }
  const ct = (contentType ?? '').toLowerCase().split(';')[0].trim()
  const mapped = MIME_TO_EXT[ct]
  if (mapped) {
    const m = MIME_BY_EXT[mapped]!
    return { ext: mapped, kind: m.kind, mediaType: m.mediaType }
  }
  return null
}

async function hashFile(path: string): Promise<{ hash: string; size: number }> {
  const sha = createHash('sha256')
  let size = 0
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk: string | Buffer) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += buf.length
      sha.update(buf)
    })
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  return { hash: sha.digest('hex'), size }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

async function pathExists(path: string): Promise<boolean> {
  return fs
    .stat(path)
    .then(() => true)
    .catch(() => false)
}

async function moveOrCopy(src: string, dst: string): Promise<void> {
  // rename() fails across filesystems (EXDEV) — bodyparser tmp dir is often
  // on /tmp while the project lives in the user's home. Try rename first,
  // fall back to copy + unlink.
  try {
    await fs.rename(src, dst)
    return
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES') throw err
  }
  await fs.copyFile(src, dst)
  await fs.unlink(src).catch(() => {})
}

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  duration?: string
}
interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: { duration?: string }
}

async function runFfprobe(ffprobePath: string, file: string): Promise<FfprobeOutput | null> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const proc = spawn(
      ffprobePath,
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_streams',
        '-show_format',
        file,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
    proc.on('error', (err) => {
      logger.warn({ err }, 'asset_pipeline: ffprobe spawn failed')
      resolve(null)
    })
    proc.on('close', (code) => {
      if (code !== 0) {
        logger.warn({ code, stderr }, 'asset_pipeline: ffprobe exited non-zero')
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(stdout) as FfprobeOutput)
      } catch (err) {
        logger.warn({ err }, 'asset_pipeline: ffprobe output not JSON')
        resolve(null)
      }
    })
  })
}

async function extractVideoThumbnail(
  ffmpegPath: string,
  src: string,
  dst: string,
  atSeconds: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(
      ffmpegPath,
      [
        '-y',
        '-ss',
        atSeconds.toFixed(2),
        '-i',
        src,
        '-frames:v',
        '1',
        '-vf',
        'scale=480:-2:flags=lanczos',
        '-an',
        dst,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    )
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
    proc.on('error', (err) => {
      logger.warn({ err }, 'asset_pipeline: ffmpeg spawn failed')
      resolve(false)
    })
    proc.on('close', (code) => {
      if (code !== 0) {
        logger.warn({ code, stderr }, 'asset_pipeline: ffmpeg thumbnail failed')
        resolve(false)
      } else {
        resolve(true)
      }
    })
  })
}

interface ResolvedBinaries {
  ffprobe: string | null
  ffmpeg: string | null
}

async function resolveBinaries(): Promise<ResolvedBinaries> {
  let ffprobe: string | null = null
  let ffmpeg: string | null = null
  try {
    const mod = (await import('ffprobe-static' as string)) as unknown as
      | { default?: { path?: string } | string | null; path?: string }
      | null
    const fromDefault = (mod?.default as { path?: string } | string | null | undefined) ?? null
    if (typeof fromDefault === 'string') ffprobe = fromDefault
    else if (fromDefault && typeof fromDefault === 'object' && typeof fromDefault.path === 'string')
      ffprobe = fromDefault.path
    else if (mod && typeof (mod as { path?: string }).path === 'string')
      ffprobe = (mod as { path: string }).path
  } catch {
    /* not installed */
  }
  try {
    const mod = (await import('ffmpeg-static' as string)) as unknown as {
      default?: string | null
    }
    if (typeof mod?.default === 'string') ffmpeg = mod.default
  } catch {
    /* not installed */
  }
  return { ffprobe, ffmpeg }
}

interface SkiaCanvasShim {
  loadImage: (src: string) => Promise<{ width: number; height: number }>
}

let skiaPromise: Promise<SkiaCanvasShim> | null = null
async function loadSkia(): Promise<SkiaCanvasShim | null> {
  if (!skiaPromise) {
    const specifier = 'skia-canvas'
    skiaPromise = (
      Function('s', 'return import(s)') as (s: string) => Promise<SkiaCanvasShim>
    )(specifier)
  }
  try {
    return await skiaPromise
  } catch (err) {
    logger.warn({ err }, 'asset_pipeline: skia-canvas not available')
    return null
  }
}

async function readImageDims(
  file: string
): Promise<{ width: number; height: number } | null> {
  const skia = await loadSkia()
  if (!skia) return null
  try {
    const img = await skia.loadImage(file)
    if (typeof img.width === 'number' && typeof img.height === 'number') {
      return { width: img.width, height: img.height }
    }
  } catch (err) {
    logger.warn({ err, file }, 'asset_pipeline: loadImage failed for dim read')
  }
  return null
}

interface ProbeMetadata {
  width?: number
  height?: number
  duration?: number
}

async function probeMedia(
  file: string,
  kind: AssetKind,
  ffprobePath: string | null
): Promise<ProbeMetadata> {
  const out: ProbeMetadata = {}
  if (kind === 'image') {
    const dims = await readImageDims(file)
    if (dims) {
      out.width = dims.width
      out.height = dims.height
    }
    return out
  }
  if (!ffprobePath) return out
  const probe = await runFfprobe(ffprobePath, file)
  if (!probe) return out
  if (kind === 'video') {
    const stream = (probe.streams ?? []).find((s) => s.codec_type === 'video')
    if (stream) {
      if (typeof stream.width === 'number') out.width = stream.width
      if (typeof stream.height === 'number') out.height = stream.height
    }
  }
  const dur =
    probe.format?.duration ??
    (probe.streams ?? []).find((s) => typeof s.duration === 'string')?.duration
  if (typeof dur === 'string') {
    const n = Number.parseFloat(dur)
    if (Number.isFinite(n)) out.duration = n
  }
  return out
}

function safeDisplayName(clientName: string): string {
  // Strip any path components a malicious client might inject.
  const base = clientName.split(/[\\/]/).pop() ?? clientName
  return base.length > 0 ? base : 'asset'
}

interface IndexShape {
  version?: string
  templates?: unknown[]
  behaviors?: unknown[]
  scenes?: unknown[]
  assets?: unknown[]
  fonts?: unknown[]
  [k: string]: unknown
}

async function readIndex(indexPath: string): Promise<IndexShape> {
  const raw = await fs.readFile(indexPath, 'utf8').catch(() => null)
  if (raw === null) return { version: '0.1', templates: [], behaviors: [], scenes: [], assets: [], fonts: [] }
  try {
    const parsed = JSON.parse(raw) as IndexShape
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    throw new AssetIngestError(
      'E_INGEST_FAILED',
      `library/index.json is not valid JSON: ${(err as Error).message}`
    )
  }
}

async function writeIndexAtomic(indexPath: string, data: IndexShape): Promise<void> {
  const tmp = `${indexPath}.tmp`
  await ensureDir(dirname(indexPath))
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, indexPath)
}

function findAssetById(list: unknown[] | undefined, id: string): AssetRecord | null {
  if (!Array.isArray(list)) return null
  for (const item of list) {
    if (item && typeof item === 'object' && (item as { id?: unknown }).id === id) {
      return item as AssetRecord
    }
  }
  return null
}

export interface AssetPipelineOptions {
  /** Override binary discovery (mostly for tests). */
  ffprobePath?: string | null
  ffmpegPath?: string | null
}

export class AssetPipeline {
  #ffprobeOverride: string | null | undefined
  #ffmpegOverride: string | null | undefined

  constructor(opts: AssetPipelineOptions = {}) {
    this.#ffprobeOverride = opts.ffprobePath
    this.#ffmpegOverride = opts.ffmpegPath
  }

  async ingest(input: AssetIngestInput): Promise<AssetRecord> {
    const project = projectStore.project
    if (!project) {
      throw new AssetIngestError('E_NO_PROJECT', 'No project loaded')
    }

    const displayName = safeDisplayName(input.clientName)
    const detected = detectMediaType(displayName, input.contentType)
    if (!detected) {
      throw new AssetIngestError(
        'E_UNSUPPORTED_TYPE',
        `Unsupported file type for "${displayName}" (content-type: ${input.contentType ?? 'unknown'})`
      )
    }

    const { hash, size } = await hashFile(input.tmpPath)
    const libraryRoot = join(project.root, 'library')
    const assetsDir = join(libraryRoot, 'assets')
    await ensureDir(assetsDir)

    const finalName = `${hash}${detected.ext}`
    const finalPath = join(assetsDir, finalName)
    const relativeUrl = `assets/${finalName}`
    const indexPath = join(libraryRoot, 'index.json')

    const existingIndex = await readIndex(indexPath)
    const existingRecord = findAssetById(existingIndex.assets as unknown[], hash)
    if (existingRecord && (await pathExists(finalPath))) {
      // Idempotent: same bytes already ingested. Drop the tmp upload.
      await fs.unlink(input.tmpPath).catch(() => {})
      return existingRecord
    }

    if (await pathExists(finalPath)) {
      // File already on disk but not in index — drop the tmp copy and reuse.
      await fs.unlink(input.tmpPath).catch(() => {})
    } else {
      await moveOrCopy(input.tmpPath, finalPath)
    }

    const ffprobePath =
      this.#ffprobeOverride === undefined ? null : this.#ffprobeOverride
    const ffmpegPath = this.#ffmpegOverride === undefined ? null : this.#ffmpegOverride
    const resolved =
      this.#ffprobeOverride === undefined || this.#ffmpegOverride === undefined
        ? await resolveBinaries()
        : { ffprobe: ffprobePath, ffmpeg: ffmpegPath }
    const effectiveFfprobe =
      this.#ffprobeOverride === undefined ? resolved.ffprobe : this.#ffprobeOverride
    const effectiveFfmpeg =
      this.#ffmpegOverride === undefined ? resolved.ffmpeg : this.#ffmpegOverride

    const meta = await probeMedia(finalPath, detected.kind, effectiveFfprobe)

    let thumbnail: string | undefined
    if (detected.kind === 'video' && effectiveFfmpeg) {
      const thumbName = `${hash}.thumb.png`
      const thumbPath = join(assetsDir, thumbName)
      const thumbAt = meta.duration ? Math.min(meta.duration / 2, 1) : 0
      const ok = await extractVideoThumbnail(effectiveFfmpeg, finalPath, thumbPath, thumbAt)
      if (ok) thumbnail = `assets/${thumbName}`
    }

    const record: AssetRecord = {
      id: hash,
      name: displayName,
      url: relativeUrl,
      kind: detected.kind,
      mediaType: detected.mediaType,
      size: input.size ?? size,
      hash: `sha256:${hash}`,
      createdAt: new Date().toISOString(),
    }
    if (meta.width !== undefined) record.width = meta.width
    if (meta.height !== undefined) record.height = meta.height
    if (meta.duration !== undefined) record.duration = meta.duration
    if (thumbnail) record.thumbnail = thumbnail

    const nextIndex: IndexShape = {
      version: typeof existingIndex.version === 'string' ? existingIndex.version : '0.1',
      templates: Array.isArray(existingIndex.templates) ? existingIndex.templates : [],
      behaviors: Array.isArray(existingIndex.behaviors) ? existingIndex.behaviors : [],
      scenes: Array.isArray(existingIndex.scenes) ? existingIndex.scenes : [],
      fonts: Array.isArray(existingIndex.fonts) ? existingIndex.fonts : [],
      assets: Array.isArray(existingIndex.assets) ? [...existingIndex.assets] : [],
    }
    // Preserve any other top-level keys the user authored.
    for (const [k, v] of Object.entries(existingIndex)) {
      if (!(k in nextIndex)) nextIndex[k] = v
    }
    const assets = nextIndex.assets as unknown[]
    const existingIdx = assets.findIndex(
      (a) => a && typeof a === 'object' && (a as { id?: unknown }).id === record.id
    )
    if (existingIdx >= 0) assets[existingIdx] = record
    else assets.push(record)

    await writeIndexAtomic(indexPath, nextIndex)

    // Nudge the watcher in case fs.watch missed the directory creation
    // (recursive watching can be flaky on the first write after mkdir).
    await libraryIndex.flush().catch(() => {})

    return record
  }
}

const assetPipeline = new AssetPipeline()
export default assetPipeline
