import type { HttpContext } from '@adonisjs/core/http'
import libraryIndex, { type LibraryItemKind } from '#services/library_index'
import projectStore from '#services/project_store'

const ALLOWED_KINDS: LibraryItemKind[] = ['template', 'behavior', 'scene', 'asset', 'font']

function isAllowedKind(value: string): value is LibraryItemKind {
  return (ALLOWED_KINDS as readonly string[]).includes(value)
}

export default class LibraryController {
  /**
   * GET /api/library — returns the current library catalog the Library
   * panel renders. Query string supports `?q=` (substring match over
   * id/name/description) and `?kind=` (one of template|behavior|scene|asset|font).
   *
   * Watches `library/index.json` + `library/**\/*.{behavior,template,scene}.json`;
   * the in-memory catalog refreshes within ~1s of any change on disk.
   */
  async index({ request, response }: HttpContext) {
    const qsRaw = request.qs() as Record<string, unknown>
    const q = typeof qsRaw.q === 'string' && qsRaw.q.length > 0 ? qsRaw.q : undefined
    const kindRaw = typeof qsRaw.kind === 'string' ? qsRaw.kind : undefined
    if (kindRaw !== undefined && !isAllowedKind(kindRaw)) {
      return response.badRequest({
        error: {
          code: 'E_BAD_REQUEST',
          message: `Unknown kind "${kindRaw}". Allowed: ${ALLOWED_KINDS.join(', ')}.`,
        },
      })
    }

    const catalog = libraryIndex.getCatalog()
    const items = libraryIndex.search({ q, kind: kindRaw })

    return response.ok({
      root: catalog.root,
      loadedAt: catalog.loadedAt,
      attached: libraryIndex.isAttached,
      projectRoot: projectStore.project?.root ?? null,
      count: items.length,
      total: catalog.items.length,
      query: { q: q ?? null, kind: kindRaw ?? null },
      items,
      errors: catalog.errors,
    })
  }
}
