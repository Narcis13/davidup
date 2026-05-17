import type { HttpContext } from '@adonisjs/core/http'
import { resolve } from 'node:path'
import { scaffoldProject, ScaffoldError } from 'davidup/cli/scaffold'
import projectStore, { ProjectLoadError } from '#services/project_store'
import recents from '#services/recents'

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
    const directory = typeof body?.directory === 'string' ? body.directory : ''
    if (!directory) {
      return response.badRequest({
        error: { code: 'E_BAD_REQUEST', message: 'Body `directory` (string) is required' },
      })
    }

    try {
      const project = await projectStore.load(directory)
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
    const directoryRaw = typeof body?.directory === 'string' ? body.directory : ''
    if (!directoryRaw) {
      return response.badRequest({
        error: { code: 'E_BAD_REQUEST', message: 'Body `directory` (string) is required' },
      })
    }
    const template = typeof body?.template === 'string' && body.template.length > 0
      ? body.template
      : undefined
    const name = typeof body?.name === 'string' && body.name.length > 0 ? body.name : undefined
    const targetDir = resolve(directoryRaw)

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
}
