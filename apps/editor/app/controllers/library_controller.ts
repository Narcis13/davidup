import type { HttpContext } from '@adonisjs/core/http'
import libraryIndex, { type LibraryItemKind, type LibraryScope } from '#services/library_index'
import libraryThumbnail from '#services/library_thumbnail'
import projectStore from '#services/project_store'
import { promoteLibraryItem, PromoteError } from '#services/promote_library_item'
import {
  saveLibraryDefinition,
  SaveDefinitionError,
  type DefinitionKind,
} from '#services/save_library_definition'

const ALLOWED_KINDS: LibraryItemKind[] = ['template', 'behavior', 'scene', 'asset', 'font']
const ALLOWED_SCOPES: LibraryScope[] = ['project', 'global']
const PROMOTABLE_KINDS: LibraryItemKind[] = ['template', 'behavior', 'scene']

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

  /**
   * POST /api/library/promote — copy a project-scoped library definition
   * into the global pool, then delete it from the project. Body:
   *   { kind: 'template'|'behavior'|'scene', id: string, force?: boolean }
   *
   * Out of scope today: `asset`, `font`, and inline (index.json) entries.
   * The library watcher picks the file move up on its own; this handler
   * also calls `libraryIndex.flush()` so the response already reflects
   * the merged catalog.
   */
  async promote({ request, response }: HttpContext) {
    const body = request.body() as { kind?: unknown; id?: unknown; force?: unknown }
    const kindRaw = typeof body.kind === 'string' ? body.kind : ''
    const id = typeof body.id === 'string' ? body.id : ''
    if (!kindRaw || !id) {
      return response.badRequest({
        error: { code: 'E_BAD_REQUEST', message: 'Body `kind` and `id` are required.' },
      })
    }
    if (!isAllowedKind(kindRaw)) {
      return response.badRequest({
        error: {
          code: 'E_BAD_REQUEST',
          message: `Unknown kind "${kindRaw}". Allowed: ${ALLOWED_KINDS.join(', ')}.`,
        },
      })
    }
    if (!(PROMOTABLE_KINDS as readonly string[]).includes(kindRaw)) {
      return response.status(422).send({
        error: {
          code: 'E_KIND_UNSUPPORTED',
          message: `Promotion is only supported for ${PROMOTABLE_KINDS.join(', ')} today.`,
        },
      })
    }
    const force = body.force === true

    try {
      const result = await promoteLibraryItem({ kind: kindRaw, id, force })
      return response.ok({ ...result })
    } catch (err) {
      if (err instanceof PromoteError) {
        const status =
          err.code === 'E_BAD_REQUEST'
            ? 400
            : err.code === 'E_ITEM_NOT_FOUND'
              ? 404
              : err.code === 'E_TARGET_EXISTS'
                ? 409
                : err.code === 'E_KIND_UNSUPPORTED' ||
                    err.code === 'E_INLINE_ITEM' ||
                    err.code === 'E_NO_PROJECT_LIBRARY' ||
                    err.code === 'E_NO_GLOBAL_LIBRARY'
                  ? 422
                  : 500
        return response.status(status).send({
          error: { code: err.code, message: err.message, details: err.details },
        })
      }
      throw err
    }
  }

  /**
   * POST /api/library/definitions — write a user-authored template /
   * behavior / scene to disk under either the project library or the
   * global library. The body shape:
   *   {
   *     kind: 'template'|'behavior'|'scene',
   *     id: string,
   *     target: 'project'|'global',
   *     body: { ...definition fields (description, params, items, tweens, …) },
   *     force?: boolean,
   *   }
   *
   * The `target` field is the user-facing "save to Project | Global" choice
   * — same shape used for asset uploads. The watcher in library_index
   * propagates the new file to the merged catalog automatically.
   */
  async saveDefinition({ request, response }: HttpContext) {
    const raw = request.body() as {
      kind?: unknown
      id?: unknown
      target?: unknown
      body?: unknown
      force?: unknown
    }
    const kind = typeof raw.kind === 'string' ? raw.kind : ''
    const id = typeof raw.id === 'string' ? raw.id : ''
    const target = typeof raw.target === 'string' ? raw.target : ''
    if (!kind || !id || !target) {
      return response.badRequest({
        error: {
          code: 'E_BAD_REQUEST',
          message: 'Body `kind`, `id`, and `target` are required.',
        },
      })
    }
    if (!(['template', 'behavior', 'scene'] as const).includes(kind as DefinitionKind)) {
      return response.badRequest({
        error: {
          code: 'E_BAD_REQUEST',
          message: `Unknown kind "${kind}". Allowed: template, behavior, scene.`,
        },
      })
    }
    if (target !== 'project' && target !== 'global') {
      return response.badRequest({
        error: {
          code: 'E_BAD_REQUEST',
          message: `Unknown target "${target}". Allowed: project, global.`,
        },
      })
    }
    if (!raw.body || typeof raw.body !== 'object' || Array.isArray(raw.body)) {
      return response.badRequest({
        error: { code: 'E_BAD_REQUEST', message: 'Body `body` must be a JSON object.' },
      })
    }
    const force = raw.force === true

    try {
      const result = await saveLibraryDefinition({
        kind: kind as DefinitionKind,
        id,
        target,
        body: raw.body as Record<string, unknown>,
        force,
      })
      return response.created({ ...result })
    } catch (err) {
      if (err instanceof SaveDefinitionError) {
        const status =
          err.code === 'E_BAD_REQUEST'
            ? 400
            : err.code === 'E_TARGET_EXISTS'
              ? 409
              : err.code === 'E_KIND_UNSUPPORTED' ||
                  err.code === 'E_NO_PROJECT_LIBRARY' ||
                  err.code === 'E_NO_GLOBAL_LIBRARY'
                ? 422
                : 500
        return response.status(status).send({
          error: { code: err.code, message: err.message, details: err.details },
        })
      }
      throw err
    }
  }
}
