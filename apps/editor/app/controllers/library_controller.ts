import type { HttpContext } from '@adonisjs/core/http'
import libraryIndex, { type LibraryItemKind, type LibraryScope } from '#services/library_index'
import libraryThumbnail from '#services/library_thumbnail'
import projectStore from '#services/project_store'

const ALLOWED_KINDS: LibraryItemKind[] = ['template', 'behavior', 'scene', 'asset', 'font']
const ALLOWED_SCOPES: LibraryScope[] = ['project', 'global']

function isAllowedKind(value: string): value is LibraryItemKind {
  return (ALLOWED_KINDS as readonly string[]).includes(value)
}

function isAllowedScope(value: string): value is LibraryScope {
  return (ALLOWED_SCOPES as readonly string[]).includes(value)
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
    const scopeRaw = typeof qsRaw.scope === 'string' ? qsRaw.scope : undefined
    if (scopeRaw !== undefined && !isAllowedScope(scopeRaw)) {
      return response.badRequest({
        error: {
          code: 'E_BAD_REQUEST',
          message: `Unknown scope "${scopeRaw}". Allowed: ${ALLOWED_SCOPES.join(', ')}.`,
        },
      })
    }

    const catalog = libraryIndex.getCatalog()
    const items = libraryIndex.search({ q, kind: kindRaw, scope: scopeRaw })

    return response.ok({
      root: catalog.root,
      roots: catalog.roots,
      loadedAt: catalog.loadedAt,
      attached: libraryIndex.isAttached,
      globalAttached: libraryIndex.isGlobalAttached,
      projectRoot: projectStore.project?.root ?? null,
      count: items.length,
      total: catalog.items.length,
      query: { q: q ?? null, kind: kindRaw ?? null, scope: scopeRaw ?? null },
      items,
      errors: catalog.errors,
    })
  }

  /**
   * GET /api/library/thumbnail?kind=<kind>&id=<id> — returns a PNG preview
   * thumbnail for a single library item. The first request synthesizes a
   * tiny composition that exercises the item and renders frame 0.5 via the
   * existing `render_preview_frame` path; subsequent requests are served
   * from an in-memory cache.
   *
   * When synthesis isn't viable (missing source file, unsupported kind,
   * etc.) the endpoint returns a deterministic placeholder PNG showing the
   * kind + name. The response includes an `X-Thumbnail-Placeholder: 1`
   * header so the frontend can decide whether to overlay a kind badge.
   */
  async thumbnail({ request, response }: HttpContext) {
    const qsRaw = request.qs() as Record<string, unknown>
    const id = typeof qsRaw.id === 'string' ? qsRaw.id : ''
    const kindRaw = typeof qsRaw.kind === 'string' ? qsRaw.kind : ''
    if (!id || !kindRaw || !isAllowedKind(kindRaw)) {
      return response.badRequest({
        error: {
          code: 'E_BAD_REQUEST',
          message: 'Both `kind` and `id` query params are required.',
        },
      })
    }
    const items = libraryIndex.search({ kind: kindRaw })
    const match = items.find((i) => i.id === id)
    if (!match) {
      return response.notFound({
        error: {
          code: 'E_LIBRARY_ITEM_NOT_FOUND',
          message: `No ${kindRaw} item with id "${id}" in the current library catalog.`,
        },
      })
    }
    libraryThumbnail.invalidateOn(libraryIndex.getCatalog().loadedAt)
    const root = libraryIndex.root
    const thumb = await libraryThumbnail.forItem(match, root)
    response.header('content-type', thumb.mimeType)
    response.header('cache-control', 'public, max-age=60')
    if (thumb.placeholder) response.header('x-thumbnail-placeholder', '1')
    return response.send(thumb.buffer)
  }
}
