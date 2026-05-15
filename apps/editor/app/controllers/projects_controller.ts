import type { HttpContext } from '@adonisjs/core/http'
import projectStore, { ProjectLoadError } from '#services/project_store'

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
}
