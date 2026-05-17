/**
 * Renders controller — step 19 of the editor build plan.
 *
 *   POST /api/renders          → enqueue a new render of the currently-loaded
 *                                composition. Returns the jobId immediately so
 *                                the editor strip can subscribe before the
 *                                first frame lands.
 *   GET  /api/renders          → list known jobs (in-memory only, capped).
 *   GET  /api/renders/:id      → snapshot the current state of a job.
 *   GET  /api/renders/:id/events → SSE channel: `progress` / `done` / `error`.
 *
 * The PRD names this an "AdonisJS Transmit SSE channel". Transmit 3 requires
 * Adonis 7 (we're on 6) and Transmit 2 fails to install against our lock; so
 * for v1.0 the controller ships its own native SSE writer. The wire format
 * (server-sent `event:` + `data:` frames) is the same shape Transmit emits,
 * which keeps a future swap cheap. See `render_worker.ts` for the lifecycle.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path'

import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'

import projectStore from '#services/project_store'
import renderJobs, { RenderJob, type RenderEvent } from '../workers/render_worker.js'

function timestampStamp(now = new Date()): string {
  // Compact, sortable, filesystem-safe: 20260517-141512-123
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    now.getUTCFullYear().toString() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    '-' +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds()) +
    '-' +
    pad(now.getUTCMilliseconds(), 3)
  )
}

interface CreateRenderBody {
  /** Optional output filename, relative to `renders/` or absolute under the project. */
  filename?: unknown
}

export default class RendersController {
  /**
   * POST /api/renders — start a render of the currently-loaded composition.
   *
   * Returns immediately (200) with the jobId + total frame count so the UI
   * can subscribe to the SSE channel before the first progress event lands.
   * If no project is loaded → 404. If the composition is mid-mutation, the
   * snapshot taken at request-time is what gets rendered (intentional — the
   * disk file may be debounced behind it).
   */
  async store({ request, response }: HttpContext) {
    const project = projectStore.project
    const composition = projectStore.composition as
      | { composition: { duration: number; fps: number; width: number; height: number } }
      | null
    if (!project || !composition) {
      return response.notFound({
        error: { code: 'E_NO_PROJECT', message: 'No project loaded' },
      })
    }

    const body = (request.body() ?? {}) as CreateRenderBody
    const userFilename =
      typeof body.filename === 'string' && body.filename.trim().length > 0
        ? body.filename.trim()
        : null

    const stamp = timestampStamp()
    const baseName = userFilename ?? `${stamp}.mp4`
    if (baseName.includes('..') || baseName.startsWith('/')) {
      return response.badRequest({
        error: { code: 'E_BAD_REQUEST', message: 'filename must be a simple basename' },
      })
    }
    const safeName = extname(baseName) ? baseName : `${baseName}.mp4`

    const rendersDir = join(project.root, 'renders')
    await mkdir(rendersDir, { recursive: true })
    const outputPath = join(rendersDir, safeName)
    const relativeOutputPath = relative(project.root, outputPath)

    const jobId = randomUUID()
    const job = new RenderJob({
      jobId,
      composition: composition as never,
      outputPath,
      relativeOutputPath,
      sourcePath: project.compositionPath,
    })
    renderJobs.add(job)

    // Fire-and-forget; clients subscribe via SSE for progress.
    // We don't `await` because the response must return before the worker
    // starts emitting frames — otherwise the SSE subscriber misses the
    // early frames.
    void job.run().catch((err) => {
      logger.error({ err, jobId }, 'renders_controller: job.run threw unexpectedly')
    })

    return response.created({
      jobId,
      totalFrames: job.totalFrames,
      outputPath,
      relativeOutputPath,
      eventsUrl: `/api/renders/${jobId}/events`,
    })
  }

  /** GET /api/renders — list known jobs (newest first). */
  async index({ response }: HttpContext) {
    const list = renderJobs.list().map((j) => ({
      jobId: j.jobId,
      status: j.status,
      outputPath: j.outputPath,
      relativeOutputPath: j.relativeOutputPath,
      totalFrames: j.totalFrames,
      lastProgress: j.lastProgress,
      final: j.final,
      startedAt: j.startedAt,
    }))
    list.reverse()
    return response.ok({ jobs: list })
  }

  /** GET /api/renders/:id — snapshot a single job's state. */
  async show({ params, response }: HttpContext) {
    const job = renderJobs.get(params.id)
    if (!job) {
      return response.notFound({
        error: { code: 'E_JOB_NOT_FOUND', message: `No job with id ${params.id}` },
      })
    }
    return response.ok({
      jobId: job.jobId,
      status: job.status,
      outputPath: job.outputPath,
      relativeOutputPath: job.relativeOutputPath,
      totalFrames: job.totalFrames,
      lastProgress: job.lastProgress,
      final: job.final,
      startedAt: job.startedAt,
    })
  }

  /**
   * GET /api/renders/:id/events — SSE subscription.
   *
   * Wire format (one frame per event):
   *
   *     event: progress
   *     data: {"jobId":"…","frame":42,"total":360,"elapsedMs":1234}
   *
   *     event: done
   *     data: {"jobId":"…","outputPath":"…","frameCount":360,"durationMs":4321}
   *
   *     event: error
   *     data: {"jobId":"…","message":"ffmpeg exited with code 1: …"}
   *
   * On connect we always replay the latest known state (last progress event
   * if running, or the terminal event if finished) so the UI doesn't have to
   * race the network. Then we relay live events until either the job ends
   * or the client disconnects.
   */
  async events({ params, request, response }: HttpContext) {
    const job = renderJobs.get(params.id)
    if (!job) {
      return response.notFound({
        error: { code: 'E_JOB_NOT_FOUND', message: `No job with id ${params.id}` },
      })
    }

    const raw = response.response
    // Write headers directly on the underlying Node response — going through
    // `response.header(...)` here is a no-op because we then bypass Adonis's
    // own serialisation by calling `raw.writeHead`. The two layers don't
    // share state, so the SSE-specific headers must travel with `writeHead`.
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Hint to reverse proxies (nginx, Cloudflare) not to buffer the stream.
      'X-Accel-Buffering': 'no',
    })
    if (typeof raw.flushHeaders === 'function') raw.flushHeaders()

    // Disable AdonisJS's lazy-body inference — we own the response now.
    // Calling `response.stream` semantics manually: we write bytes directly
    // and resolve a promise when the client disconnects or job finishes.

    function write(event: RenderEvent): void {
      try {
        raw.write(`event: ${event.type}\n`)
        raw.write(`data: ${JSON.stringify(event)}\n\n`)
      } catch (err) {
        logger.warn({ err, jobId: params.id }, 'renders_controller: SSE write failed')
      }
    }

    // Initial hello so clients can detect connection without waiting for the
    // first frame (helps EventSource clients flip to OPEN immediately).
    raw.write(`: connected\n\n`)

    // Catch-up: replay last known state.
    if (job.final) {
      write(job.final)
      // Job already finished; end the stream after a short tick so the
      // browser can process the final event before EOF.
      setImmediate(() => raw.end())
    } else if (job.lastProgress) {
      write(job.lastProgress)
    }

    // Heartbeat: SSE comment frame every 15s so intermediaries don't reap
    // the connection during long renders.
    const heartbeat = setInterval(() => {
      try {
        raw.write(`: ping ${Date.now()}\n\n`)
      } catch {
        clearInterval(heartbeat)
      }
    }, 15_000)

    const onEvent = (event: RenderEvent): void => {
      write(event)
      if (event.type === 'done' || event.type === 'error') {
        cleanup()
        setImmediate(() => raw.end())
      }
    }

    const cleanup = (): void => {
      clearInterval(heartbeat)
      job.off('event', onEvent)
    }

    job.on('event', onEvent)

    // End the response when the client disconnects.
    return new Promise<void>((resolveStream) => {
      const onClose = () => {
        cleanup()
        resolveStream()
      }
      request.request.on('close', onClose)
      raw.on('close', onClose)
    })
  }

  /**
   * GET /project-renders/:filename — serve a finished render file by basename.
   *
   * The editor's "RenderStrip" links to this URL once `done` fires. We
   * resolve the basename against the loaded project's `renders/` directory
   * (never outside it) so the editor can preview the file without exposing
   * the rest of the filesystem.
   */
  async file({ params, response }: HttpContext) {
    const project = projectStore.project
    if (!project) {
      return response.notFound({
        error: { code: 'E_NO_PROJECT', message: 'No project loaded' },
      })
    }
    const filename = String(params.filename ?? '')
    if (!filename || filename.includes('..') || isAbsolute(filename) || filename.includes('/')) {
      return response.badRequest({
        error: { code: 'E_BAD_REQUEST', message: 'Invalid filename' },
      })
    }
    const target = resolvePath(project.root, 'renders', filename)
    const inside = resolvePath(project.root, 'renders')
    if (!target.startsWith(inside + '/') && target !== inside) {
      return response.forbidden({
        error: { code: 'E_FORBIDDEN', message: 'File outside renders/ directory' },
      })
    }
    if (!existsSync(target)) {
      return response.notFound({
        error: { code: 'E_NOT_FOUND', message: 'Render file not found' },
      })
    }
    return response.download(target)
  }
}
