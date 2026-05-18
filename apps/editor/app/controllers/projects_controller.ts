import type { HttpContext } from '@adonisjs/core/http'
import { scaffoldProject, ScaffoldError } from 'davidup/cli/scaffold'
import projectStore, { ProjectLoadError } from '#services/project_store'
import projectEvents, { type ProjectChangedPayload } from '#services/project_events'
import recents from '#services/recents'
import { guardProjectDirectory } from '#services/project_paths'

export default class ProjectsController {
  /**
   * GET /api/project — return the currently loaded composition (the
   * in-memory source of truth) plus the resolved on-disk paths.
   *
   * 404 if no project is loaded. Step 04 (the `davidup edit` CLI) is the
   * normal entrypoint that loads one at boot; tests / future endpoints
   * may also drive `ProjectStore#load`.
   */
  async show({ response }: HttpContext) {
    const project = projectStore.project
    if (!project) {
      return response.notFound({
        error: {
          code: 'E_NO_PROJECT',
          message:
            'No project loaded. Boot the editor with `davidup edit <dir>` or call ProjectStore#load().',
        },
      })
    }

    return response.ok({
      root: project.root,
      compositionPath: project.compositionPath,
      libraryIndexPath: project.libraryIndexPath,
      assetsDir: project.assetsDir,
      loadedAt: project.loadedAt,
      composition: project.composition,
    })
  }

  /**
   * POST /api/project — load a project from a directory on disk.
   * Body: `{ directory: string }` (absolute path or relative to cwd).
   *
   * Provides a programmatic load path before the CLI lands in step 04.
   */
  async load({ request, response }: HttpContext) {
    const body = request.body() as { directory?: unknown }
    const guard = guardProjectDirectory(body?.directory)
    if (!guard.ok) {
      const status = guard.code === 'E_FORBIDDEN_PATH' ? 403 : 400
      return response.status(status).send({ error: { code: guard.code, message: guard.message } })
    }

    try {
      const project = await projectStore.load(guard.directory)
      return response.ok({
        root: project.root,
        compositionPath: project.compositionPath,
        libraryIndexPath: project.libraryIndexPath,
        assetsDir: project.assetsDir,
        loadedAt: project.loadedAt,
        composition: project.composition,
      })
    } catch (err) {
      if (err instanceof ProjectLoadError) {
        const status = err.code === 'E_PROJECT_NOT_FOUND' || err.code === 'E_COMPOSITION_MISSING'
          ? 404
          : 422
        return response.status(status).send({
          error: { code: err.code, message: err.message, details: err.details },
        })
      }
      throw err
    }
  }

  /**
   * GET /api/projects/recent — return the recents list sorted newest first.
   * Entries whose `path` no longer resolves to a directory are pruned.
   * Always returns 200 with `{ projects: [...] }` (empty array if none).
   */
  async recent({ response }: HttpContext) {
    const projects = await recents.list()
    return response.ok({ projects })
  }

  /**
   * POST /api/projects — scaffold a fresh project then load it.
   * Body: `{ directory: string, name?: string, template?: string }`.
   *
   * `directory` is the project root to create (absolute, or resolved against
   * cwd). `name` overrides the recents entry label. `template` selects the
   * scaffold template (default "basic"). On success returns the loaded
   * composition in the same shape as POST /api/project (load).
   */
  async store({ request, response }: HttpContext) {
    const body = request.body() as {
      directory?: unknown
      name?: unknown
      template?: unknown
    }
    const guard = guardProjectDirectory(body?.directory)
    if (!guard.ok) {
      const status = guard.code === 'E_FORBIDDEN_PATH' ? 403 : 400
      return response.status(status).send({ error: { code: guard.code, message: guard.message } })
    }
    const template = typeof body?.template === 'string' && body.template.length > 0
      ? body.template
      : undefined
    const name = typeof body?.name === 'string' && body.name.length > 0 ? body.name : undefined
    const targetDir = guard.directory

    try {
      await scaffoldProject({
        targetDir,
        ...(template !== undefined ? { template } : {}),
      })
    } catch (err) {
      if (err instanceof ScaffoldError) {
        const status =
          err.code === 'E_TARGET_NOT_EMPTY'
            ? 409
            : err.code === 'E_TEMPLATE_NOT_FOUND'
              ? 404
              : 422
        return response.status(status).send({
          error: { code: err.code, message: err.message, details: err.details },
        })
      }
      throw err
    }

    try {
      const project = await projectStore.load(targetDir)
      if (name) {
        await recents.touch(project.root, name).catch(() => {})
      }
      return response.created({
        root: project.root,
        compositionPath: project.compositionPath,
        libraryIndexPath: project.libraryIndexPath,
        assetsDir: project.assetsDir,
        loadedAt: project.loadedAt,
        composition: project.composition,
      })
    } catch (err) {
      if (err instanceof ProjectLoadError) {
        return response.status(422).send({
          error: { code: err.code, message: err.message, details: err.details },
        })
      }
      throw err
    }
  }

  /**
   * DELETE /api/projects/recent/:idx — forget a recents entry by its index
   * in the sorted list returned from GET /api/projects/recent. Does NOT
   * delete anything from disk. 400 on a malformed index; 404 if out of
   * range.
   */
  async forget({ params, response }: HttpContext) {
    const raw = String(params.idx)
    const idx = Number.parseInt(raw, 10)
    if (!Number.isInteger(idx) || idx < 0 || String(idx) !== raw) {
      return response.badRequest({
        error: {
          code: 'E_BAD_REQUEST',
          message: '`idx` must be a non-negative integer',
        },
      })
    }
    const current = await recents.list()
    if (idx >= current.length) {
      return response.notFound({
        error: {
          code: 'E_RECENT_NOT_FOUND',
          message: `No recent project at index ${idx} (have ${current.length})`,
        },
      })
    }
    const target = current[idx]!
    const projects = await recents.forget(target.path)
    return response.ok({ projects })
  }

  /**
   * GET /api/projects/events — SSE channel for project lifecycle events.
   *
   * Today only one event is emitted: `changed`, fired when the loaded project
   * is swapped via POST /api/project or POST /api/projects. Inertia clients
   * subscribe via EventSource and call `router.reload()` on receipt.
   *
   * Wire format (matches `renders_controller.events` for consistency with the
   * future Transmit migration):
   *
   *     event: changed
   *     data: {"type":"changed","root":"/Users/me/proj","at":1747401812345}
   */
  async events({ request, response }: HttpContext) {
    const raw = response.response
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    if (typeof raw.flushHeaders === 'function') raw.flushHeaders()

    // Hello frame so EventSource flips to OPEN immediately.
    raw.write(`: connected\n\n`)

    function write(event: ProjectChangedPayload): void {
      try {
        raw.write(`event: ${event.type}\n`)
        raw.write(`data: ${JSON.stringify(event)}\n\n`)
      } catch {
        // The client closed the socket — cleanup handlers below will fire.
      }
    }

    // Heartbeat every 15s so reverse proxies don't reap an idle stream.
    const heartbeat = setInterval(() => {
      try {
        raw.write(`: ping ${Date.now()}\n\n`)
      } catch {
        clearInterval(heartbeat)
      }
    }, 15_000)

    const onChanged = (payload: ProjectChangedPayload): void => {
      write(payload)
    }
    projectEvents.on('changed', onChanged)

    const cleanup = (): void => {
      clearInterval(heartbeat)
      projectEvents.off('changed', onChanged)
    }

    return new Promise<void>((resolveStream) => {
      const onClose = () => {
        cleanup()
        resolveStream()
      }
      request.request.on('close', onClose)
      raw.on('close', onClose)
    })
  }
}
