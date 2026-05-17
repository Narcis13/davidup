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
]

export default class AssetsController {
  /**
   * POST /api/assets — multipart upload. Field `file` carries the bytes.
   *
   * Pipeline (see asset_pipeline.ts): hash → name `<hash><ext>` →
   * ffprobe/loadImage for metadata → optional thumbnail → register in
   * `library/index.json`. Returns the asset record.
   *
   * Requires a loaded project (404 with E_NO_PROJECT otherwise).
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

    try {
      const record = await assetPipeline.ingest({
        tmpPath: file.tmpPath,
        clientName: file.clientName,
        contentType: file.headers?.['content-type'] as string | undefined,
        size: file.size,
        target,
      })
      return response.created({ asset: record })
    } catch (err) {
      if (err instanceof AssetIngestError) {
        const status =
          err.code === 'E_NO_PROJECT' ? 404 : err.code === 'E_UNSUPPORTED_TYPE' ? 415 : 500
        return response.status(status).send({
          error: { code: err.code, message: err.message, details: err.details },
        })
      }
      throw err
    }
  }
}
