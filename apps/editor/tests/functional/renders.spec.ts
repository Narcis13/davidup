// Functional tests for the Render-from-editor flow — step 19.
//
// Covers POST /api/renders + GET /api/renders/:id + GET /api/renders/:id/events
// (SSE), end-to-end against the real engine. The composition is intentionally
// tiny (200×120 @ 12 fps × 0.5 s → 6 frames) so the test finishes in a couple
// of seconds while still exercising skia-canvas + ffmpeg + the progress
// callback wiring.

import { test } from '@japa/runner'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import projectStore from '#services/project_store'
import renderJobs, { RenderJob } from '../../app/workers/render_worker.js'

const TINY_COMP = {
  version: '0.1',
  composition: {
    width: 200,
    height: 120,
    fps: 12,
    duration: 0.5, // 6 frames total
    background: '#000020',
  },
  assets: [],
  layers: [
    {
      id: 'fg',
      z: 0,
      opacity: 1,
      blendMode: 'normal',
      items: ['logo'],
    },
  ],
  items: {
    logo: {
      type: 'shape',
      kind: 'rect',
      width: 80,
      height: 80,
      fillColor: '#ff8800',
      cornerRadius: 12,
      transform: {
        x: 100,
        y: 60,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0.5,
        anchorY: 0.5,
        opacity: 1,
      },
    },
  },
  tweens: [
    {
      id: 'fade-in',
      target: 'logo',
      property: 'transform.opacity',
      from: 0,
      to: 1,
      start: 0,
      duration: 0.4,
      easing: 'easeOutQuad',
    },
  ],
}

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-renders-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(TINY_COMP, null, 2), 'utf8')
  return dir
}

function probeMp4(path: string): { width?: number; height?: number; durationS?: number } | null {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) return null
  const parsed = JSON.parse(result.stdout) as {
    streams?: Array<{ width?: number; height?: number; duration?: string }>
    format?: { duration?: string }
  }
  const stream = parsed.streams?.[0]
  const durationS = stream?.duration
    ? Number.parseFloat(stream.duration)
    : parsed.format?.duration
      ? Number.parseFloat(parsed.format.duration)
      : undefined
  return {
    width: stream?.width,
    height: stream?.height,
    durationS,
  }
}

function ffmpegAvailable(): boolean {
  const result = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  return result.status === 0
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test.group('RenderJob · worker', (group) => {
  group.each.setup(async () => {
    await projectStore.unload()
    renderJobs.clear()
  })

  test('emits progress events and writes mp4 to renders/<filename>', async ({ assert }) => {
    if (!ffmpegAvailable()) {
      assert.isTrue(true, 'ffmpeg missing — skipping')
      return
    }
    const dir = await makeProject()
    try {
      const loaded = await projectStore.load(dir)
      const composition = projectStore.composition as never
      const outputPath = join(dir, 'renders', 'test.mp4')

      const job = new RenderJob({
        jobId: 'job-test-1',
        composition,
        outputPath,
        relativeOutputPath: 'renders/test.mp4',
        sourcePath: loaded.compositionPath,
      })

      const events: Array<{ type: string; frame?: number; total?: number }> = []
      job.on('event', (ev: { type: string; frame?: number; total?: number }) => {
        events.push({ type: ev.type, frame: ev.frame, total: ev.total })
      })

      const final = await job.run()

      assert.equal(final.type, 'done', 'job should finish with done event')
      assert.equal(job.status, 'done')

      const progressEvents = events.filter((e) => e.type === 'progress')
      assert.isAtLeast(progressEvents.length, 1, 'at least one progress event')
      assert.equal(progressEvents[progressEvents.length - 1].frame, job.totalFrames)
      assert.equal(progressEvents[progressEvents.length - 1].total, job.totalFrames)

      const doneEvents = events.filter((e) => e.type === 'done')
      assert.equal(doneEvents.length, 1, 'exactly one done event')

      assert.isTrue(existsSync(outputPath), 'mp4 file should be on disk')
      const s = await stat(outputPath)
      assert.isAbove(s.size, 0, 'mp4 file should be non-empty')

      const probe = probeMp4(outputPath)
      if (probe) {
        assert.equal(probe.width, 200)
        assert.equal(probe.height, 120)
        // ffmpeg sometimes reports 0.5s as 0.5 or 0.466667; just sanity check.
        if (probe.durationS !== undefined) {
          assert.isAtLeast(probe.durationS, 0.3)
          assert.isAtMost(probe.durationS, 0.7)
        }
      }
    } finally {
      await projectStore.unload()
      renderJobs.clear()
      await rm(dir, { recursive: true, force: true })
    }
  }).timeout(30_000)

  test('totalFrames is ceil(duration * fps)', async ({ assert }) => {
    const job = new RenderJob({
      jobId: 'tf-1',
      composition: TINY_COMP as never,
      outputPath: '/tmp/nope.mp4',
      relativeOutputPath: 'renders/nope.mp4',
      sourcePath: '/tmp/comp.json',
    })
    assert.equal(job.totalFrames, 6)
  })

  test('errors emit an error event and resolve whenDone()', async ({ assert }) => {
    const dir = await makeProject()
    try {
      const loaded = await projectStore.load(dir)
      const composition = projectStore.composition as never

      // Force a failure by directing output into a path whose *parent path
      // component* is a file, not a directory. mkdir(recursive) will fail.
      const blocker = join(dir, 'blocker')
      await writeFile(blocker, 'i am a file, not a directory', 'utf8')
      const outputPath = join(blocker, 'sub', 'out.mp4')

      const job = new RenderJob({
        jobId: 'job-err-1',
        composition,
        outputPath,
        relativeOutputPath: 'blocker/sub/out.mp4',
        sourcePath: loaded.compositionPath,
      })

      let errorEvent: { type: string; message?: string } | null = null
      job.on('event', (ev: { type: string; message?: string }) => {
        if (ev.type === 'error') errorEvent = ev
      })

      const final = await job.run()
      assert.equal(final.type, 'error')
      assert.equal(job.status, 'error')
      assert.isNotNull(errorEvent)
    } finally {
      await projectStore.unload()
      renderJobs.clear()
    }
  })
})

test.group('Renders · HTTP', (group) => {
  group.each.setup(async () => {
    await projectStore.unload()
    renderJobs.clear()
  })

  test('POST /api/renders returns 404 when no project is loaded', async ({ client }) => {
    const res = await client.post('/api/renders').json({})
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'E_NO_PROJECT' } })
  })

  test('POST /api/renders kicks off a job; GET /api/renders/:id reflects state', async ({
    client,
    assert,
  }) => {
    if (!ffmpegAvailable()) {
      assert.isTrue(true, 'ffmpeg missing — skipping')
      return
    }
    const dir = await makeProject()
    try {
      await client.post('/api/project').json({ directory: dir })

      const startRes = await client.post('/api/renders').json({})
      startRes.assertStatus(201)
      const start = startRes.body() as {
        jobId: string
        totalFrames: number
        outputPath: string
        relativeOutputPath: string
        eventsUrl: string
      }
      assert.isString(start.jobId)
      assert.equal(start.totalFrames, 6)
      assert.isTrue(start.relativeOutputPath.startsWith('renders/'))
      assert.isTrue(start.relativeOutputPath.endsWith('.mp4'))
      assert.equal(start.eventsUrl, `/api/renders/${start.jobId}/events`)

      // Poll the show endpoint until the job finishes (or 30s elapse).
      let final: { status: string; final?: { type: string }; outputPath: string } | null = null
      for (let i = 0; i < 60; i++) {
        const showRes = await client.get(`/api/renders/${start.jobId}`)
        showRes.assertStatus(200)
        const body = showRes.body() as {
          status: string
          final: { type: string } | null
          outputPath: string
        }
        if (body.status === 'done' || body.status === 'error') {
          final = body as never
          break
        }
        await delay(500)
      }
      assert.isNotNull(final, 'job should reach a terminal state within 30s')
      assert.equal(final!.status, 'done')

      // File landed at the reported path under renders/.
      assert.isTrue(existsSync(final!.outputPath), 'mp4 file should exist on disk')
      const files = await readdir(join(dir, 'renders'))
      assert.isAtLeast(files.length, 1)
    } finally {
      await projectStore.unload()
      renderJobs.clear()
      await rm(dir, { recursive: true, force: true })
    }
  }).timeout(45_000)

  test('GET /api/renders lists known jobs', async ({ client, assert }) => {
    const dir = await makeProject()
    try {
      await projectStore.load(dir)
      // Seed a fake job directly so we don't have to wait for ffmpeg.
      const composition = projectStore.composition as never
      const job = new RenderJob({
        jobId: 'list-1',
        composition,
        outputPath: join(dir, 'renders', 'list.mp4'),
        relativeOutputPath: 'renders/list.mp4',
        sourcePath: join(dir, 'composition.json'),
      })
      renderJobs.add(job)

      const res = await client.get('/api/renders')
      res.assertStatus(200)
      const body = res.body() as {
        jobs: Array<{ jobId: string; status: string; totalFrames: number }>
      }
      assert.isArray(body.jobs)
      assert.equal(body.jobs.length, 1)
      assert.equal(body.jobs[0].jobId, 'list-1')
      assert.equal(body.jobs[0].status, 'pending')
      assert.equal(body.jobs[0].totalFrames, 6)
    } finally {
      await projectStore.unload()
      renderJobs.clear()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('GET /api/renders/:id returns 404 for unknown id', async ({ client }) => {
    const res = await client.get('/api/renders/does-not-exist')
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'E_JOB_NOT_FOUND' } })
  })

  test('POST /api/renders rejects unsafe filename', async ({ client }) => {
    const dir = await makeProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      const res = await client.post('/api/renders').json({ filename: '../escape.mp4' })
      res.assertStatus(400)
      res.assertBodyContains({ error: { code: 'E_BAD_REQUEST' } })
    } finally {
      await projectStore.unload()
      renderJobs.clear()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('SSE stream replays final event for a completed job', async ({ assert }) => {
    // Drive the worker first so the job is already in a terminal state when
    // we connect; the controller should replay `final` and close the stream.
    if (!ffmpegAvailable()) {
      assert.isTrue(true, 'ffmpeg missing — skipping')
      return
    }
    const dir = await makeProject()
    const { default: testUtils } = await import('@adonisjs/core/services/test_utils')
    const httpServer = testUtils.httpServer()
    await httpServer.start()
    try {
      await projectStore.load(dir)
      const composition = projectStore.composition as never

      const job = new RenderJob({
        jobId: 'sse-1',
        composition,
        outputPath: join(dir, 'renders', 'sse.mp4'),
        relativeOutputPath: 'renders/sse.mp4',
        sourcePath: join(dir, 'composition.json'),
      })
      renderJobs.add(job)

      const finalEv = await job.run()
      assert.equal(finalEv.type, 'done')

      const baseUrl = `http://${process.env.HOST ?? 'localhost'}:${process.env.PORT ?? '3333'}`
      const res = await fetch(`${baseUrl}/api/renders/sse-1/events`)
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
      const text = await res.text()
      assert.match(text, /event: done/)
      assert.match(text, /"jobId":"sse-1"/)
    } finally {
      await projectStore.unload()
      renderJobs.clear()
      await rm(dir, { recursive: true, force: true })
    }
  }).timeout(30_000)

  test('GET /project-renders/:filename serves a finished render file', async ({
    client,
    assert,
  }) => {
    const dir = await makeProject()
    try {
      await projectStore.load(dir)
      // Drop a tiny stub file in renders/ to confirm the route serves it.
      const rendersDir = join(dir, 'renders')
      await rm(rendersDir, { recursive: true, force: true }).catch(() => {})
      const { mkdir, writeFile: wf } = await import('node:fs/promises')
      await mkdir(rendersDir, { recursive: true })
      const stubBytes = Buffer.from([0, 0, 0, 32, 102, 116, 121, 112]) // "ftyp"-ish
      await wf(join(rendersDir, 'stub.mp4'), stubBytes)

      const res = await client.get('/project-renders/stub.mp4')
      res.assertStatus(200)
    } finally {
      await projectStore.unload()
      renderJobs.clear()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('GET /project-renders/:filename rejects path traversal', async ({ client }) => {
    const dir = await makeProject()
    try {
      await projectStore.load(dir)
      const res = await client.get('/project-renders/..%2Fescape.mp4')
      res.assertStatus(400)
    } finally {
      await projectStore.unload()
      renderJobs.clear()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
