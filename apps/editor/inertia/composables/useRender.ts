// useRender — step 19 of the editor build plan.
//
// Browser side of the Render-from-editor flow: POST /api/renders kicks off a
// worker on the server; this composable owns the lifecycle and progress state
// the RenderStrip component renders. It is a module-singleton so the whole
// editor sees the same job state (toasts, strip, status bar all stay in sync).
//
// Events arrive over an SSE channel (GET /api/renders/:id/events). We use the
// browser's native EventSource which auto-reconnects on transient failures —
// if the server drops the connection mid-render, the catch-up reply on
// reconnect re-aligns the progress bar.

import { computed, reactive, readonly, type ComputedRef } from 'vue'

export type RenderStatus = 'idle' | 'pending' | 'running' | 'done' | 'error'

export interface RenderJobState {
  jobId: string
  status: Exclude<RenderStatus, 'idle'>
  totalFrames: number
  frame: number
  startedAt: number
  /** From the most recent progress event. */
  elapsedMs: number
  /** Path relative to project root once the render is finished. */
  outputPath: string | null
  relativeOutputPath: string | null
  /** Duration the *server* took to render, in ms. */
  serverDurationMs: number | null
  error: string | null
}

interface RenderJobInternal extends RenderJobState {
  source: EventSource | null
}

interface State {
  current: RenderJobInternal | null
  history: RenderJobState[]
}

const state = reactive<State>({ current: null, history: [] })

const HISTORY_LIMIT = 8

function publicSnapshot(j: RenderJobInternal): RenderJobState {
  // Strip the EventSource so consumers can JSON-serialise the state without
  // pulling in the live connection.
  const { source: _omit, ...rest } = j
  return { ...rest }
}

function closeStream(j: RenderJobInternal | null): void {
  if (!j) return
  if (j.source) {
    try {
      j.source.close()
    } catch {
      // EventSource throws synchronously when already closed — harmless.
    }
    j.source = null
  }
}

function attachStream(job: RenderJobInternal, eventsUrl: string): void {
  if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
    // SSR / unsupported environment — skip SSE, just poll once at end.
    return
  }
  const es = new EventSource(eventsUrl, { withCredentials: true })
  job.source = es

  es.addEventListener('progress', (ev) => {
    try {
      const payload = JSON.parse((ev as MessageEvent).data) as {
        jobId: string
        frame: number
        total: number
        elapsedMs: number
      }
      if (payload.jobId !== job.jobId) return
      job.status = 'running'
      job.frame = payload.frame
      job.totalFrames = payload.total
      job.elapsedMs = payload.elapsedMs
    } catch {
      // Malformed payload — drop silently.
    }
  })

  es.addEventListener('done', (ev) => {
    try {
      const payload = JSON.parse((ev as MessageEvent).data) as {
        jobId: string
        outputPath: string
        relativeOutputPath: string
        frameCount: number
        durationMs: number
      }
      if (payload.jobId !== job.jobId) return
      job.status = 'done'
      job.frame = payload.frameCount
      job.outputPath = payload.outputPath
      job.relativeOutputPath = payload.relativeOutputPath
      job.serverDurationMs = payload.durationMs
      closeStream(job)
      pushHistory(job)
    } catch {
      // ignore
    }
  })

  es.addEventListener('error', (ev) => {
    // SSE 'error' event has two shapes: a `MessageEvent` from the server
    // (carries our typed payload) and a connection-level `Event` from the
    // browser. We distinguish by presence of `data`.
    const data = (ev as MessageEvent).data
    if (typeof data === 'string') {
      try {
        const payload = JSON.parse(data) as { jobId: string; message: string }
        if (payload.jobId === job.jobId) {
          job.status = 'error'
          job.error = payload.message
          closeStream(job)
          pushHistory(job)
          return
        }
      } catch {
        // fallthrough to connection-error handling
      }
    }
    // Browser-level error: only mark as failed if the connection is closed
    // *and* the job did not finish. EventSource auto-reconnects on transient
    // network errors, so a single error event isn't terminal.
    if (es.readyState === EventSource.CLOSED && job.status !== 'done') {
      job.status = 'error'
      job.error = job.error ?? 'SSE connection closed unexpectedly'
      closeStream(job)
      pushHistory(job)
    }
  })
}

function pushHistory(job: RenderJobInternal): void {
  const snapshot = publicSnapshot(job)
  state.history.unshift(snapshot)
  if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT
}

interface StartRenderOptions {
  filename?: string
}

interface StartRenderResult {
  ok: boolean
  jobId?: string
  error?: { code: string; message: string }
}

async function startRender(opts: StartRenderOptions = {}): Promise<StartRenderResult> {
  // Cancel-in-place: if a render is already in flight, refuse rather than
  // double-booking ffmpeg. Future versions may queue.
  if (state.current && (state.current.status === 'pending' || state.current.status === 'running')) {
    return {
      ok: false,
      error: { code: 'E_BUSY', message: 'A render is already running.' },
    }
  }

  closeStream(state.current)
  state.current = null

  try {
    const res = await fetch('/api/renders', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.filename ? { filename: opts.filename } : {}),
    })
    if (!res.ok) {
      let detail: { code?: string; message?: string } | null = null
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } }
        detail = body.error ?? null
      } catch {
        // ignore
      }
      return {
        ok: false,
        error: {
          code: detail?.code ?? `E_HTTP_${res.status}`,
          message: detail?.message ?? `Render request failed (${res.status})`,
        },
      }
    }
    const body = (await res.json()) as {
      jobId: string
      totalFrames: number
      outputPath: string
      relativeOutputPath: string
      eventsUrl: string
    }

    const job: RenderJobInternal = {
      jobId: body.jobId,
      status: 'pending',
      totalFrames: body.totalFrames,
      frame: 0,
      startedAt: Date.now(),
      elapsedMs: 0,
      outputPath: body.outputPath,
      relativeOutputPath: body.relativeOutputPath,
      serverDurationMs: null,
      error: null,
      source: null,
    }
    state.current = job
    // `state.current` now holds Vue's reactive proxy wrapping `job`. Pass the
    // proxy (not the raw `job` reference) to `attachStream` so SSE mutations
    // are visible to the computed `current` consumed by RenderStrip. Mutating
    // the raw object would update the captured closure but never tick any
    // reactivity dependency, which is exactly the bug the previous version
    // shipped with.
    attachStream(state.current as RenderJobInternal, body.eventsUrl)
    return { ok: true, jobId: body.jobId }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'E_NETWORK', message: (err as Error).message || 'Network error' },
    }
  }
}

function dismissCurrent(): void {
  closeStream(state.current)
  state.current = null
}

/**
 * Module-singleton accessor. Exported as a function so tests can mock the
 * underlying state if needed (mirrors useAssetUpload's shape).
 */
export interface RenderApi {
  current: ComputedRef<RenderJobState | null>
  history: ComputedRef<readonly RenderJobState[]>
  isBusy: ComputedRef<boolean>
  startRender(opts?: StartRenderOptions): Promise<StartRenderResult>
  dismissCurrent(): void
}

let api: RenderApi | null = null

export function useRender(): RenderApi {
  if (api) return api
  api = {
    current: computed(() => (state.current ? publicSnapshot(state.current) : null)),
    history: computed(() => readonly(state.history)),
    isBusy: computed(
      () => !!state.current && (state.current.status === 'pending' || state.current.status === 'running')
    ),
    startRender,
    dismissCurrent,
  }
  return api
}

/** Testing helper — wipes state between specs. Not used at runtime. */
export function __resetRenderForTests(): void {
  closeStream(state.current)
  state.current = null
  state.history.length = 0
  api = null
}
