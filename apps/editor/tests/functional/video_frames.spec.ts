// Functional tests for the stage video-frame endpoints — v1.1 S5.
//
//   GET /api/video-clips                          → clip metadata per item
//   GET /project-video-frames/:itemId/:frame.png  → one cached PNG frame
//
// Runs the real extractor (bundled ffmpeg-static) against the committed
// 320×240, 1 s small.mp4 fixture. The frame cache is redirected to a temp
// dir via $DAVIDUP_CACHE so the developer's ~/.davidup cache is untouched.

import { test } from '@japa/runner'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import projectStore from '#services/project_store'
import videoFrames, { resolveVideoSources } from '#services/video_frames'

const SMALL_MP4 = resolve(
  import.meta.dirname,
  '../../../../tests/drivers/fixtures/video/small.mp4'
)

function videoComp(src = './assets/clip.mp4') {
  return {
    version: '0.1',
    composition: { width: 320, height: 240, fps: 10, duration: 1, background: '#000000' },
    assets: [{ id: 'clip', type: 'video', src, duration: 1, width: 320, height: 240, fps: 30 }],
    layers: [{ id: 'L', z: 0, opacity: 1, blendMode: 'normal', items: ['v'] }],
    items: {
      v: {
        type: 'video',
        asset: 'clip',
        width: 160,
        height: 120,
        start: 0,
        trimIn: 0,
        trimOut: 1,
        fit: 'contain',
        loop: false,
        transform: {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
    },
    tweens: [],
  }
}

async function makeProject(comp: unknown, withClip = true): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-video-frames-'))
  await mkdir(join(dir, 'assets'), { recursive: true })
  if (withClip) await copyFile(SMALL_MP4, join(dir, 'assets', 'clip.mp4'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(comp, null, 2), 'utf8')
  return dir
}

test.group('Stage video frames · HTTP', (group) => {
  let cacheDir: string
  let prevCache: string | undefined
  const dirs: string[] = []

  group.setup(async () => {
    prevCache = process.env.DAVIDUP_CACHE
    cacheDir = await mkdtemp(join(tmpdir(), 'davidup-video-frames-cache-'))
    process.env.DAVIDUP_CACHE = cacheDir
    return async () => {
      if (prevCache === undefined) delete process.env.DAVIDUP_CACHE
      else process.env.DAVIDUP_CACHE = prevCache
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  group.each.setup(async () => {
    await projectStore.unload()
    videoFrames.clear()
    return async () => {
      await projectStore.unload()
      while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  test('404 when no project is loaded', async ({ client }) => {
    const r1 = await client.get('/api/video-clips')
    r1.assertStatus(404)
    const r2 = await client.get('/project-video-frames/v/1.png')
    r2.assertStatus(404)
  })

  test('clips report extracted metadata; frames stream from the cache', async ({
    client,
    assert,
  }) => {
    const dir = await makeProject(videoComp())
    dirs.push(dir)
    await projectStore.load(dir)

    const res = await client.get('/api/video-clips')
    res.assertStatus(200)
    const body = res.body() as {
      clips: Record<string, { hash: string; frameCount: number; width: number; height: number }>
      extracted: boolean
      warnings: string[]
    }
    assert.deepEqual(body.warnings, [])
    assert.isTrue(body.extracted)
    const clip = body.clips.v
    assert.exists(clip)
    assert.equal(clip.frameCount, 10) // 1 s @ 10 fps
    // Source aspect kept, capped by the 160×120 box (B-1 policy).
    assert.equal(clip.width, 160)
    assert.equal(clip.height, 120)

    // Second call is a cache hit.
    const again = await client.get('/api/video-clips')
    assert.isFalse((again.body() as { extracted: boolean }).extracted)

    const frame = await client.get(`/project-video-frames/v/1.png`).qs({ h: clip.hash })
    frame.assertStatus(200)
    assert.include(frame.header('content-type') ?? '', 'image/png')
    assert.include(frame.header('cache-control') ?? '', 'immutable')

    const stale = await client.get(`/project-video-frames/v/10.png`).qs({ h: 'old' })
    stale.assertStatus(200)
    assert.equal(stale.header('cache-control'), 'no-cache')

    ;(await client.get('/project-video-frames/v/11.png')).assertStatus(404)
    ;(await client.get('/project-video-frames/v/0.png')).assertStatus(404)
    ;(await client.get('/project-video-frames/nope/1.png')).assertStatus(404)
    ;(await client.get('/project-video-frames/v/abc.png')).assertStatus(400)
  })

  test('missing source surfaces a warning instead of an error', async ({ client, assert }) => {
    const dir = await makeProject(videoComp(), false)
    dirs.push(dir)
    await projectStore.load(dir)

    const res = await client.get('/api/video-clips')
    res.assertStatus(200)
    const body = res.body() as { clips: Record<string, unknown>; warnings: string[] }
    assert.deepEqual(body.clips, {})
    assert.lengthOf(body.warnings, 1)
    assert.include(body.warnings[0], 'Video frames unavailable')
  })

  test('resolveVideoSources resolves relative video srcs against the project root', ({
    assert,
  }) => {
    const comp = videoComp() as never
    const out = resolveVideoSources(comp, '/proj') as unknown as ReturnType<typeof videoComp>
    assert.equal(out.assets[0].src, resolve('/proj', 'assets/clip.mp4'))
    for (const src of ['global:videos/a.mp4', '/abs/a.mp4', 'https://x/a.mp4']) {
      const o = resolveVideoSources(videoComp(src) as never, '/proj') as unknown as ReturnType<
        typeof videoComp
      >
      assert.equal(o.assets[0].src, src)
    }
  })
})
