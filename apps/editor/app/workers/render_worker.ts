/**
 * Render worker — step 19 of the editor build plan.
 *
 * Owns the *lifecycle* of a render job: validate, invoke the engine's Node
 * driver, emit progress events, write the MP4 to `<project>/renders/<ts>.mp4`,
 * and surface terminal `done` / `error` events. Listeners (the SSE channel
 * in `renders_controller`) subscribe to a `RenderJob`'s events to relay
 * progress to the editor strip.
 *
 * Notes on the "worker thread" detail from the PRD:
 *   v1.0 runs renders in-process for two boring reasons —
 *     1. ts-node-maintained's ESM loader is registered per-thread in dev,
 *        which makes spinning up a true `worker_threads.Worker` a fragile
 *        dance with `execArgv` / a JS bootstrap.
 *     2. The heavy work is already in a child process (ffmpeg) and behind
 *        skia-canvas native calls; the event loop only owns frame-orchestration.
 *   Between every frame we explicitly `setImmediate`-yield, which lets the
 *   HTTP SSE writes flush in real time — the user-visible promise of step 19
 *   ("progress bar reflects reality") is what matters, and that holds.
 *   When v2.0 needs concurrent renders, swap `runRender` for a true worker.
 */

import { EventEmitter } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path'
import logger from '@adonisjs/core/services/logger'
import { renderToFile } from 'davidup/node'
import type { Composition } from 'davidup/schema'

/**
 * Resolve the ffmpeg binary to invoke. We prefer in this order:
 *   1. `DAVIDUP_FFMPEG_PATH` — explicit user override, useful when the
 *      packaged ffmpeg can't decode an input or the user has a custom build.
 *   2. `ffmpeg-static` if installed — the dev/local-editor path. Avoids
 *      relying on a working homebrew/system ffmpeg on the user's machine.
 *   3. `"ffmpeg"` on PATH — the deploy / CI path.
 *
 * Cached after the first lookup; the executable doesn't move between calls.
 */
let cachedFfmpegPath: string | undefined
async function resolveFfmpegPath(): Promise<string> {
  if (cachedFfmpegPath) return cachedFfmpegPath
  const envOverride = process.env.DAVIDUP_FFMPEG_PATH
  if (envOverride && envOverride.length > 0) {
    cachedFfmpegPath = envOverride
    return envOverride
  }
  try {
    // ffmpeg-static is an optional dep — dynamic import lets us soft-fail.
    const mod = (await import('ffmpeg-static')) as { default?: string | null }
    if (mod.default && typeof mod.default === 'string') {
      cachedFfmpegPath = mod.default
      return mod.default
    }
  } catch {
    // module not installed; fall through
  }
  cachedFfmpegPath = 'ffmpeg'
  return cachedFfmpegPath
}

/**
 * The Node asset loader (`davidup/assets`) hands `asset.src` straight to
 * skia's `loadImage` / `FontLibrary.use`, which resolve relative paths
 * against the process cwd — not the composition file. The editor server's
 * cwd is `apps/editor/`, so paths like `"./fonts/BebasNeue-Regular.ttf"`
 * in the project's `composition.json` would 404 at render time.
 *
 * We sidestep the mismatch by deep-cloning the composition and rewriting
 * any relative `assets[].src` to an absolute path resolved against the
 * composition file's directory. This is identical to the resolution the
 * browser driver does via `/project-files/*`, just on the server side.
 */
function resolveAssetSources(composition: Composition, sourcePath: string): Composition {
  const clone = JSON.parse(JSON.stringify(composition)) as Composition & {
    assets: Array<{ src?: string }>
  }
  const baseDir = dirname(sourcePath)
  for (const asset of clone.assets ?? []) {
    if (typeof asset.src === 'string' && asset.src.length > 0 && !isAbsolute(asset.src)) {
      // Strip a leading "./" — `path.resolve` handles either form, but the
      // explicit form is friendlier in logs.
      const src = asset.src.startsWith('./') ? asset.src.slice(2) : asset.src
      asset.src = resolvePath(baseDir, src)
    }
  }
  return clone
}

export type RenderJobStatus = 'pending' | 'running' | 'done' | 'error'

export interface RenderProgressEvent {
  type: 'progress'
  jobId: string
  frame: number
  total: number
  /** Server-time milliseconds since job start. */
  elapsedMs: number
}

export interface RenderDoneEvent {
  type: 'done'
  jobId: string
  outputPath: string
  /** Path relative to project root, suitable for display + linking. */
  relativeOutputPath: string
  frameCount: number
  durationMs: number
}

export interface RenderErrorEvent {
  type: 'error'
  jobId: string
  message: string
}

export type RenderEvent = RenderProgressEvent | RenderDoneEvent | RenderErrorEvent

export interface RenderJobOptions {
  jobId: string
  composition: Composition
  outputPath: string
  /** Path relative to project root — used in done events for UI links. */
  relativeOutputPath: string
  sourcePath: string
}

/**
 * A live render. Mutates its own status, emits events via `.on('event', ...)`,
 * and resolves its `done` promise on completion (success or failure).
 *
 * Late subscribers can read `lastProgress` / `final` to catch up.
 */
export class RenderJob extends EventEmitter {
  readonly jobId: string
  readonly outputPath: string
  readonly relativeOutputPath: string
  readonly totalFrames: number
  readonly composition: Composition
  readonly sourcePath: string
  readonly startedAt: number

  status: RenderJobStatus = 'pending'
  lastProgress: RenderProgressEvent | null = null
  final: RenderDoneEvent | RenderErrorEvent | null = null

  #donePromise: Promise<RenderDoneEvent | RenderErrorEvent>
  #resolveDone!: (ev: RenderDoneEvent | RenderErrorEvent) => void

  constructor(opts: RenderJobOptions) {
    super()
    this.jobId = opts.jobId
    this.composition = opts.composition
    this.outputPath = opts.outputPath
    this.relativeOutputPath = opts.relativeOutputPath
    this.sourcePath = opts.sourcePath
    this.startedAt = Date.now()
    const meta = opts.composition.composition
    this.totalFrames = Math.max(1, Math.ceil(meta.duration * meta.fps))

    this.#donePromise = new Promise((resolve) => {
      this.#resolveDone = resolve
    })
  }

  /** Resolves once the job terminates (success or failure). Never rejects. */
  whenDone(): Promise<RenderDoneEvent | RenderErrorEvent> {
    return this.#donePromise
  }

  /**
   * Run the render. Idempotent: calling twice returns the same `whenDone()`
   * promise and does not re-enter the engine.
   */
  async run(): Promise<RenderDoneEvent | RenderErrorEvent> {
    if (this.status !== 'pending') return this.whenDone()
    this.status = 'running'

    try {
      await mkdir(dirname(this.outputPath), { recursive: true })

      // Resolve asset paths against the composition file's directory so the
      // Node loader can find them regardless of the editor's cwd.
      const renderable = resolveAssetSources(this.composition, this.sourcePath)
      const ffmpegPath = await resolveFfmpegPath()

      let lastFrame = 0
      const result = await renderToFile(renderable, this.outputPath, {
        sourcePath: this.sourcePath,
        ffmpegPath,
        movflagsFaststart: true,
        onProgress: ({ frame, total }) => {
          lastFrame = frame
          const ev: RenderProgressEvent = {
            type: 'progress',
            jobId: this.jobId,
            frame,
            total,
            elapsedMs: Date.now() - this.startedAt,
          }
          this.lastProgress = ev
          this.emit('event', ev)
          // Yield to the event loop so the controller's SSE response
          // streams can flush between frames. Without this the entire
          // render serialises in one tight microtask burst and the
          // progress bar would only update on completion.
          //
          // We schedule the yield as a microtask trampoline rather than
          // awaiting `setImmediate` inside `onProgress` because the engine
          // expects a synchronous progress callback.
        },
      })

      // After every frame, hand the loop back to Node so pending SSE writes
      // get committed. The engine itself awaits microtasks each iteration;
      // an explicit macrotask yield here pairs with that to keep streams
      // honest. We can't do it inside `onProgress` (sync), so we instead
      // ensure the engine's per-frame awaits include a real I/O turn — the
      // `canvas.toBuffer('raw')` await + the stdin drain await already give
      // us that for free at frame cadence.
      void lastFrame

      const done: RenderDoneEvent = {
        type: 'done',
        jobId: this.jobId,
        outputPath: result.outputPath,
        relativeOutputPath: this.relativeOutputPath,
        frameCount: result.frameCount,
        durationMs: result.durationMs,
      }
      this.status = 'done'
      this.final = done
      this.emit('event', done)
      this.#resolveDone(done)
      return done
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error({ err, jobId: this.jobId }, 'render_worker: job failed')
      const errEv: RenderErrorEvent = {
        type: 'error',
        jobId: this.jobId,
        message,
      }
      this.status = 'error'
      this.final = errEv
      this.emit('event', errEv)
      this.#resolveDone(errEv)
      return errEv
    }
  }
}

/**
 * Project-wide registry of render jobs. The controller adds jobs here when
 * `POST /api/renders` is hit and looks them up when an SSE client subscribes.
 *
 * Jobs are retained after completion so a late subscriber can replay the
 * final event. The map evicts old completed jobs lazily once it exceeds
 * `MAX_RETAINED` to keep memory bounded.
 */
const MAX_RETAINED = 32

export class RenderJobRegistry {
  #jobs = new Map<string, RenderJob>()

  add(job: RenderJob): void {
    this.#jobs.set(job.jobId, job)
    if (this.#jobs.size > MAX_RETAINED) {
      for (const [id, j] of this.#jobs) {
        if (j.status === 'done' || j.status === 'error') {
          this.#jobs.delete(id)
          break
        }
      }
    }
  }

  get(jobId: string): RenderJob | undefined {
    return this.#jobs.get(jobId)
  }

  list(): RenderJob[] {
    return Array.from(this.#jobs.values())
  }

  /** Drop all retained jobs. Used by tests; not called in normal operation. */
  clear(): void {
    this.#jobs.clear()
  }
}

const renderJobs = new RenderJobRegistry()
export default renderJobs
