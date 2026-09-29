import type { HttpContext } from '@adonisjs/core/http'
import assetPipeline, { AssetIngestError, type AssetTarget } from '#services/asset_pipeline'
import projectStore from '#services/project_store'

const ALLOWED_EXTNAMES = [
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
  // Fonts — put on the shelf as `font` records (the family read off the file).
  'ttf',
  'otf',
  'woff',
  'woff2',
]

/** An optional text field: trimmed, undefined when absent or not a string. */
function textField(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

/** `tags`: comma-separated, or the field repeated. */
function tagsField(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  const parts = (Array.isArray(value) ? value : [value])
    .filter((v): v is string => typeof v === 'string')
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
  return [...new Set(parts)]
}

export default class AssetsController {
  /**
   * POST /api/assets — multipart upload. Field `file` carries the bytes.
   *
   * The file is put on an asset library shelf (asset_pipeline.ts, asset
   * library E2): the open project's `assets/`, or with `target=global` the
   * user's pool (`$DAVIDUP_ASSETS`, else ~/.davidup/assets). Optional fields
   * say what search reads: `licence` (default `own`, with a warning),
   * `credit`, `source`, `tags` (comma-separated or repeated), `name`, `desc`,
   * `kind` (`cutout`, `stock`, `sample`, ... instead of the extension's),
   * `family` (a font's). Returns `{ asset, status, warnings }`; `asset.src`
   * is the pinned `asset:<id>@<sha12>` a composition registers it by.
   *
   * Requires a loaded project unless `target=global` (404 E_NO_PROJECT).
   */
  async store({ request, response }: HttpContext) {
    const rawTarget = request.input('target')
    let target: AssetTarget = 'project'
    if (rawTarget !== undefined && rawTarget !== null && rawTarget !== '') {
      if (rawTarget === 'project' || rawTarget === 'global') {
        target = rawTarget
      } else {
        return response.badRequest({
          error: {
            code: 'E_BAD_REQUEST',
            message: `Unknown target "${String(rawTarget)}". Allowed: project, global.`,
          },
        })
      }
    }

    if (target === 'project' && !projectStore.project) {
      return response.notFound({
        error: { code: 'E_NO_PROJECT', message: 'No project loaded' },
      })
    }

    const file = request.file('file', {
      size: '50mb',
      extnames: ALLOWED_EXTNAMES,
    })
    if (!file) {
      return response.badRequest({
        error: { code: 'E_BAD_REQUEST', message: 'Multipart field `file` is required' },
      })
    }
    if (!file.isValid) {
      return response.badRequest({
        error: {
          code: 'E_BAD_REQUEST',
          message: 'Upload failed validation',
          details: file.errors,
        },
      })
    }
    if (!file.tmpPath) {
      return response.internalServerError({
        error: { code: 'E_INGEST_FAILED', message: 'Uploaded file has no tmp path' },
      })
    }

    const fields = {
      kind: textField(request.input('kind')) || undefined,
      name: textField(request.input('name')) || undefined,
      licence: textField(request.input('licence')) || undefined,
      credit: textField(request.input('credit')),
      source: textField(request.input('source')),
      tags: tagsField(request.input('tags')),
      desc: textField(request.input('desc')) || undefined,
      family: textField(request.input('family')) || undefined,
    }

    try {
      const out = await assetPipeline.ingest({
        tmpPath: file.tmpPath,
        clientName: file.clientName,
        contentType: file.headers?.['content-type'] as string | undefined,
        size: file.size,
        target,
        ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
      })
      return response.created(out)
    } catch (err) {
      if (err instanceof AssetIngestError) {
        const status =
          err.code === 'E_NO_PROJECT'
            ? 404
            : err.code === 'E_UNSUPPORTED_TYPE'
              ? 415
              : err.code === 'E_INVALID_VALUE'
                ? 400
                : 500
        return response.status(status).send({
          error: { code: err.code, message: err.message, details: err.details },
        })
      }
      throw err
    }
  }
}
