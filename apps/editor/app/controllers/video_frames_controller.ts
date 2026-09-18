import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import type { HttpContext } from '@adonisjs/core/http'
import type { Composition } from 'davidup/schema'
import projectStore from '#services/project_store'
import videoFrames from '#services/video_frames'

export default class VideoFramesController {
  /**
   * GET /api/video-clips — clip metadata (`hash`, `frameCount`, `width`,
   * `height`) for every video item in the loaded composition, keyed by item
   * id. Runs frame extraction on a cache miss, so the first call after a clip
   * is added can take a few seconds. Problems (missing source, ffmpeg
   * failure) come back as `warnings`, never as an error status — the stage
   * still renders everything else.
   */
  async clips({ response }: HttpContext) {
    const project = projectStore.project
    if (!project) {
      return response.notFound({ error: { code: 'E_NO_PROJECT', message: 'No project loaded' } })
    }
    const result = await videoFrames.clipsFor(project.composition as Composition, project.root)
    return response.ok(result)
  }

  /**
   * GET /project-video-frames/:itemId/:frame.png — one extracted frame
   * (1-based, matching the cache's `%05d.png`) for a video item. When the
   * `h` query matches the clip's current cache hash the response is
   * immutable-cacheable; otherwise it is served `no-cache`.
   */
  async frame({ params, request, response }: HttpContext) {
    const project = projectStore.project
    if (!project) {
      return response.notFound({ error: { code: 'E_NO_PROJECT', message: 'No project loaded' } })
    }
    const match = /^(\d+)(?:\.png)?$/.exec(String(params.frame ?? ''))
    if (!match) {
      return response.badRequest({
        error: { code: 'E_BAD_REQUEST', message: 'Frame must be a 1-based index, e.g. 12.png' },
      })
    }
    const itemId = String(params.itemId ?? '')
    const found = await videoFrames.framePath(
      project.composition as Composition,
      project.root,
      itemId,
      Number(match[1])
    )
    const stat = found ? await fs.stat(found.path).catch(() => null) : null
    if (!found || !stat || !stat.isFile()) {
      return response.notFound({
        error: {
          code: 'E_FRAME_NOT_FOUND',
          message: `No frame ${match[1]} for video item "${itemId}"`,
        },
      })
    }
    const qs = request.qs() as Record<string, unknown>
    response.header('content-length', String(stat.size))
    response.header(
      'cache-control',
      qs.h === found.hash ? 'private, max-age=31536000, immutable' : 'no-cache'
    )
    response.type('image/png')
    return response.stream(createReadStream(found.path))
  }
}
