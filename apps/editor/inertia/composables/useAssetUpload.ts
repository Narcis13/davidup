// useAssetUpload — step 18b of the editor build plan.
//
// Browser side of FR-12: drop a file on the editor (anywhere or specifically
// on the Library panel) → POST it to `/api/assets` → show per-file progress
// and result toasts → let the existing library_index watcher reveal the new
// asset card. Since asset library E2 the server puts the file on a shelf and
// answers with the record (`id`, `kind`, `shelf`, `src`, `w`/`h`, `licence`)
// and the put's warnings (a licence defaulted to `own`), which the toast shows.
//
// The composable is a module-singleton so the LibraryPanel, the EditorShell,
// and the UploadToasts component all observe the same queue: the panels push
// files in, the toasts host pops them out.
//
// XHR is used (rather than fetch) because it exposes upload progress events
// — fetch's ReadableStream upload still isn't broadly supported and the PRD
// asks for a progress indicator. Each XHR is tracked so callers can abort by
// id if we ever need to wire a cancel button (out of scope for v1.0; the
// dismiss action just removes the toast).

import { computed, reactive, readonly, type ComputedRef, type DeepReadonly } from 'vue'

export type UploadStatus = 'uploading' | 'success' | 'error'

/** The asset library record an upload put on a shelf (POST /api/assets `asset`). */
export interface UploadedAsset {
  id: string
  name: string
  /** The record's kind: image, video, audio, font (or cutout, stock, sample, ...). */
  kind: string
  /** `project` or `user`. */
  shelf: string
  /** The pinned `asset:<id>@<sha12>` src a composition registers it by. */
  src: string
  sha: string
  ext: string
  bytes: number
  licence: string
  credit?: string
  tags?: readonly string[]
  w?: number
  h?: number
  sec?: number
  family?: string
}

export interface UploadJob {
  id: string
  fileName: string
  size: number
  /** 0..1, only meaningful while status === 'uploading'. */
  progress: number
  status: UploadStatus
  /** Set when status === 'success'. */
  asset?: UploadedAsset
  /** `unchanged bytes` when the shelf already held the file (its record is `asset`). */
  uploadStatus?: 'new' | 'unchanged bytes'
  /** What the server noticed putting it (a licence defaulted to `own`, a probe missing). */
  warnings?: readonly string[]
  /** Set when status === 'error'. */
  error?: { code: string; message: string }
  startedAt: number
  completedAt?: number
}

interface UploadJobInternal extends UploadJob {
  xhr: XMLHttpRequest | null
}

interface State {
  jobs: UploadJobInternal[]
  seq: number
}

const state = reactive<State>({ jobs: [], seq: 0 })

const TOAST_LINGER_MS = 4000
const ERROR_LINGER_MS = 8000

/** Files allowed by the server pipeline. Mirrored from assets_controller.ts. */
const ALLOWED_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'svg',
  'mp4',
  'mov',
  'webm',
  'mkv',
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'aac',
  'flac',
  'ttf',
  'otf',
  'woff',
  'woff2',
])

function extOf(name: string): string {
  const lc = name.toLowerCase()
  const dot = lc.lastIndexOf('.')
  if (dot < 0 || dot === lc.length - 1) return ''
  return lc.slice(dot + 1)
}

export function isUploadableFile(file: { name: string }): boolean {
  return ALLOWED_EXT.has(extOf(file.name))
}

export type UploadTarget = 'project' | 'global'

export interface UploadOptions {
  /** Override the upload endpoint (used in tests). */
  endpoint?: string
  /** Override the XHR factory (used in tests). */
  xhrFactory?: () => XMLHttpRequest
  /** Delay before successful toasts auto-dismiss (ms). */
  successLingerMs?: number
  /** Delay before error toasts auto-dismiss (ms). */
  errorLingerMs?: number
  /**
   * Which library root the server should write into. Defaults to `'project'`;
   * `'global'` writes to the shared pool at `$DAVIDUP_LIBRARY`.
   */
  target?: UploadTarget
}

export interface UseAssetUploadApi {
  jobs: ComputedRef<DeepReadonly<UploadJob[]>>
  activeCount: ComputedRef<number>
  isUploading: ComputedRef<boolean>
  uploadFiles(files: Iterable<File>, opts?: UploadOptions): UploadJob[]
  dismissJob(id: string): void
  clearCompleted(): void
}

export function useAssetUpload(): UseAssetUploadApi {
  return {
    jobs: computed(() => state.jobs.map(stripInternal)) as ComputedRef<DeepReadonly<UploadJob[]>>,
    activeCount: computed(() => state.jobs.filter((j) => j.status === 'uploading').length),
    isUploading: computed(() => state.jobs.some((j) => j.status === 'uploading')),
    uploadFiles,
    dismissJob,
    clearCompleted,
  }
}

function stripInternal(job: UploadJobInternal): UploadJob {
  const { xhr: _xhr, ...rest } = job
  return rest
}

function uploadFiles(files: Iterable<File>, opts: UploadOptions = {}): UploadJob[] {
  const endpoint = opts.endpoint ?? '/api/assets'
  const created: UploadJob[] = []
  for (const file of files) {
    const id = `u_${++state.seq}_${Date.now().toString(36)}`
    const job: UploadJobInternal = reactive({
      id,
      fileName: file.name,
      size: file.size,
      progress: 0,
      status: 'uploading',
      startedAt: Date.now(),
      xhr: null,
    }) as UploadJobInternal
    state.jobs.push(job)
    created.push(stripInternal(job))
    if (!isUploadableFile(file)) {
      finalizeError(
        job,
        {
          code: 'E_UNSUPPORTED_TYPE',
          message: `"${file.name}" is not an image, video, audio or font file we accept`,
        },
        opts.errorLingerMs ?? ERROR_LINGER_MS
      )
      continue
    }
    startUpload(job, file, endpoint, opts)
  }
  return created
}

function startUpload(
  job: UploadJobInternal,
  file: File,
  endpoint: string,
  opts: UploadOptions
): void {
  const factory = opts.xhrFactory ?? (() => new XMLHttpRequest())
  const xhr = factory()
  job.xhr = xhr

  const form = new FormData()
  form.append('file', file, file.name)
  if (opts.target) form.append('target', opts.target)

  xhr.open('POST', endpoint)
  xhr.responseType = 'json'
  xhr.withCredentials = true

  if (xhr.upload) {
    xhr.upload.addEventListener('progress', (event: ProgressEvent) => {
      if (event.lengthComputable && event.total > 0) {
        job.progress = Math.min(1, event.loaded / event.total)
      }
    })
  }

  xhr.addEventListener('load', () => {
    const status = xhr.status
    const body = parseBody(xhr)
    if (status >= 200 && status < 300 && body && typeof body === 'object' && 'asset' in body) {
      const out = body as { asset: UploadedAsset; status?: unknown; warnings?: unknown }
      const warnings = Array.isArray(out.warnings)
        ? out.warnings.filter((w): w is string => typeof w === 'string')
        : []
      finalizeSuccess(
        job,
        out.asset,
        out.status === 'unchanged bytes' ? 'unchanged bytes' : 'new',
        warnings,
        // A toast with warnings stays as long as an error's, so they can be read.
        warnings.length > 0
          ? (opts.errorLingerMs ?? ERROR_LINGER_MS)
          : (opts.successLingerMs ?? TOAST_LINGER_MS)
      )
      return
    }
    const err =
      body && typeof body === 'object' && 'error' in body
        ? ((body as { error: { code?: string; message?: string } }).error ?? {})
        : {}
    finalizeError(
      job,
      {
        code: typeof err.code === 'string' ? err.code : `E_HTTP_${status || 0}`,
        message:
          typeof err.message === 'string' && err.message.length > 0
            ? err.message
            : `Upload failed (HTTP ${status || 'unknown'})`,
      },
      opts.errorLingerMs ?? ERROR_LINGER_MS
    )
  })

  xhr.addEventListener('error', () => {
    finalizeError(
      job,
      { code: 'E_NETWORK', message: 'Network error during upload' },
      opts.errorLingerMs ?? ERROR_LINGER_MS
    )
  })

  xhr.addEventListener('abort', () => {
    finalizeError(
      job,
      { code: 'E_ABORTED', message: 'Upload aborted' },
      opts.errorLingerMs ?? ERROR_LINGER_MS
    )
  })

  try {
    xhr.send(form)
  } catch (err) {
    finalizeError(
      job,
      {
        code: 'E_SEND_FAILED',
        message: err instanceof Error ? err.message : 'Failed to send upload',
      },
      opts.errorLingerMs ?? ERROR_LINGER_MS
    )
  }
}

function parseBody(xhr: XMLHttpRequest): unknown {
  if (xhr.response && typeof xhr.response === 'object') return xhr.response
  if (typeof xhr.response === 'string' && xhr.response.length > 0) {
    try {
      return JSON.parse(xhr.response) as unknown
    } catch {
      return null
    }
  }
  if (typeof xhr.responseText === 'string' && xhr.responseText.length > 0) {
    try {
      return JSON.parse(xhr.responseText) as unknown
    } catch {
      return null
    }
  }
  return null
}

function finalizeSuccess(
  job: UploadJobInternal,
  asset: UploadedAsset,
  uploadStatus: 'new' | 'unchanged bytes',
  warnings: string[],
  lingerMs: number
): void {
  job.status = 'success'
  job.progress = 1
  job.asset = asset
  job.uploadStatus = uploadStatus
  if (warnings.length > 0) job.warnings = warnings
  job.completedAt = Date.now()
  job.xhr = null
  scheduleAutoDismiss(job.id, lingerMs)
}

function finalizeError(
  job: UploadJobInternal,
  error: { code: string; message: string },
  lingerMs: number
): void {
  job.status = 'error'
  job.error = error
  job.completedAt = Date.now()
  job.xhr = null
  scheduleAutoDismiss(job.id, lingerMs)
}

function scheduleAutoDismiss(id: string, lingerMs: number): void {
  if (typeof window === 'undefined' || lingerMs <= 0) return
  window.setTimeout(() => dismissJob(id), lingerMs)
}

function dismissJob(id: string): void {
  const idx = state.jobs.findIndex((j) => j.id === id)
  if (idx < 0) return
  const job = state.jobs[idx]!
  if (job.status === 'uploading' && job.xhr) {
    try {
      job.xhr.abort()
    } catch {
      /* already done */
    }
  }
  state.jobs.splice(idx, 1)
}

function clearCompleted(): void {
  for (let i = state.jobs.length - 1; i >= 0; i--) {
    const j = state.jobs[i]!
    if (j.status !== 'uploading') state.jobs.splice(i, 1)
  }
}

// Test-only escape hatch. Production code should use `dismissJob` /
// `clearCompleted`; tests need to start each case from a clean queue.
export function __resetUploadsForTests(): void {
  for (const j of state.jobs) {
    if (j.xhr) {
      try {
        j.xhr.abort()
      } catch {
        /* ignore */
      }
    }
  }
  state.jobs.splice(0, state.jobs.length)
  state.seq = 0
}

// Read-only snapshot for components that need a static reference (e.g. for
// computed wrappers that don't go through the composable API).
export const uploadJobsState = readonly(state)
