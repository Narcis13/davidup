/*
|--------------------------------------------------------------------------
| Project switch — full reset (polish_plan 20.11)
|--------------------------------------------------------------------------
|
| When `ProjectStore#load()` is invoked against an already-loaded server,
| state tied to the prior project must be wiped before the new composition
| is swapped in:
|
|   1. `commandBus.resetUndo()` — undo history is project-scoped (FR-09);
|      reverting into the prior project's snapshots would corrupt the new
|      composition.
|   2. `renderJobs.abortInFlight()` — in-flight renders reference the old
|      paths / composition. SSE subscribers must see a clean shutdown.
|   3. `libraryIndex.detachProject()` — project pool unbinds; global pool
|      stays attached for the next project.
|
| The controller also gets a path-traversal guard on POST /api/project
| (audit §8) so anyone with HTTP access cannot ask the editor to open any
| directory on the host.
|
| After a successful switch the server broadcasts `changed` on the
| `/api/projects/events` SSE channel so connected Inertia tabs refetch.
*/

import { test } from '@japa/runner'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import projectStore from '#services/project_store'
import commandBus from '#services/command_bus'
import projectEvents from '#services/project_events'
import renderJobs, { RenderJob } from '../../app/workers/render_worker.js'
import type { Command } from '#types/commands'
import type { Composition } from 'davidup/schema'

const VALID_COMP = {
  version: '0.1',
  composition: {
    width: 1280,
    height: 720,
    fps: 60,
    duration: 3,
    background: '#0a0e27',
  },
  assets: [],
  layers: [{ id: 'fg', z: 10, opacity: 1, blendMode: 'normal', items: [] }],
  items: {},
  tweens: [],
}

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-switch-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(VALID_COMP, null, 2), 'utf8')
  return dir
}

test.group('CommandBus · resetUndo', (group) => {
  group.each.setup(async () => {
    await projectStore.unload()
  })

  test('resetUndo clears the stack but keeps subscribers', async ({ assert }) => {
    const dir = await makeProject()
    try {
      await projectStore.load(dir)
      commandBus.reset()

      let events = 0
      const off = commandBus.on(() => {
        events += 1
      })
      try {
        await commandBus.apply({
          kind: 'add_shape',
          payload: {
            layerId: 'fg',
            kind: 'rect',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            fillColor: '#fff',
            id: 'S-reset-undo',
          },
          source: 'ui',
        } satisfies Command)
        assert.equal(commandBus.undoStackSize, 1)
        assert.equal(events, 1)

        commandBus.resetUndo()
        assert.equal(commandBus.undoStackSize, 0)
        // Stack is empty — undo() pops nothing and emits nothing.
        assert.isNull(commandBus.undo())
        assert.equal(events, 1)

        // Subscriber survives — applying another command still fires it.
        await commandBus.apply({
          kind: 'set_composition_property',
          payload: { property: 'duration', value: 4 },
          source: 'ui',
        } satisfies Command)
        assert.equal(events, 2)
      } finally {
        off()
      }
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

test.group('RenderJobRegistry · abortInFlight', (group) => {
  group.each.setup(() => {
    renderJobs.clear()
  })
  group.each.teardown(() => {
    renderJobs.clear()
  })

  test('abortInFlight emits error events for non-terminal jobs and skips terminal ones', ({
    assert,
  }) => {
    // Three jobs: one running, one already done, one already errored.
    const running = new RenderJob({
      jobId: 'r1',
      composition: VALID_COMP as unknown as Composition,
      outputPath: '/tmp/r1.mp4',
      relativeOutputPath: 'renders/r1.mp4',
      sourcePath: '/tmp/r1.json',
    })
    running.status = 'running'

    const done = new RenderJob({
      jobId: 'r2',
      composition: VALID_COMP as unknown as Composition,
      outputPath: '/tmp/r2.mp4',
      relativeOutputPath: 'renders/r2.mp4',
      sourcePath: '/tmp/r2.json',
    })
    done.status = 'done'

    const errored = new RenderJob({
      jobId: 'r3',
      composition: VALID_COMP as unknown as Composition,
      outputPath: '/tmp/r3.mp4',
      relativeOutputPath: 'renders/r3.mp4',
      sourcePath: '/tmp/r3.json',
    })
    errored.status = 'error'

    renderJobs.add(running)
    renderJobs.add(done)
    renderJobs.add(errored)

    const seenEvents: Array<{ jobId: string; type: string }> = []
    running.on('event', (e: { type: string; jobId: string }) => seenEvents.push(e))
    done.on('event', (e: { type: string; jobId: string }) => seenEvents.push(e))
    errored.on('event', (e: { type: string; jobId: string }) => seenEvents.push(e))

    const n = renderJobs.abortInFlight('test abort')
    assert.equal(n, 1)
    assert.equal(running.status, 'error')
    assert.equal(running.aborted, true)
    assert.equal(running.final?.type, 'error')
    if (running.final?.type === 'error') {
      assert.equal(running.final.message, 'test abort')
    }
    // Done / errored stay untouched.
    assert.equal(done.status, 'done')
    assert.equal(errored.status, 'error')
    assert.equal(seenEvents.length, 1)
    assert.equal(seenEvents[0].jobId, 'r1')
  })
})

test.group('ProjectStore · switch full reset', (group) => {
  group.each.setup(async () => {
    await projectStore.unload()
    commandBus.reset()
    renderJobs.clear()
  })
  group.each.teardown(async () => {
    await projectStore.unload()
    commandBus.reset()
    renderJobs.clear()
  })

  test('loading a different project clears the undo stack', async ({ assert }) => {
    const a = await makeProject()
    const b = await makeProject()
    try {
      await projectStore.load(a)
      await commandBus.apply({
        kind: 'add_shape',
        payload: {
          layerId: 'fg',
          kind: 'rect',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          fillColor: '#fff',
          id: 'S-switch',
        },
        source: 'ui',
      } satisfies Command)
      assert.equal(commandBus.undoStackSize, 1)

      await projectStore.load(b)
      assert.equal(commandBus.undoStackSize, 0)
    } finally {
      await rm(a, { recursive: true, force: true })
      await rm(b, { recursive: true, force: true })
    }
  })

  test('loading a different project aborts in-flight renders', async ({ assert }) => {
    const a = await makeProject()
    const b = await makeProject()
    try {
      await projectStore.load(a)
      // Inject a fake in-flight job — we don't need the heavy engine path.
      const job = new RenderJob({
        jobId: 'inflight',
        composition: VALID_COMP as unknown as Composition,
        outputPath: '/tmp/inflight.mp4',
        relativeOutputPath: 'renders/inflight.mp4',
        sourcePath: join(a, 'composition.json'),
      })
      job.status = 'running'
      renderJobs.add(job)

      const events: Array<{ type: string }> = []
      job.on('event', (e: { type: string }) => events.push(e))

      await projectStore.load(b)
      assert.equal(job.status, 'error')
      assert.equal(job.aborted, true)
      assert.equal(events.length, 1)
      assert.equal(events[0].type, 'error')
    } finally {
      await rm(a, { recursive: true, force: true })
      await rm(b, { recursive: true, force: true })
    }
  })

  test('loading a different project broadcasts a changed event', async ({ assert }) => {
    const a = await makeProject()
    const b = await makeProject()
    try {
      await projectStore.load(a)
      const seen: Array<{ type: string; root: string }> = []
      const handler = (p: { type: string; root: string }) => seen.push(p)
      projectEvents.on('changed', handler)
      try {
        await projectStore.load(b)
        assert.equal(seen.length, 1)
        assert.equal(seen[0].type, 'changed')
        assert.equal(seen[0].root, b)
      } finally {
        projectEvents.off('changed', handler)
      }
    } finally {
      await rm(a, { recursive: true, force: true })
      await rm(b, { recursive: true, force: true })
    }
  })

  test('loading the same project does NOT broadcast (idempotent reload)', async ({ assert }) => {
    const a = await makeProject()
    try {
      await projectStore.load(a)
      const seen: unknown[] = []
      const handler = () => seen.push(null)
      projectEvents.on('changed', handler)
      try {
        await projectStore.load(a)
        assert.equal(seen.length, 0)
      } finally {
        projectEvents.off('changed', handler)
      }
    } finally {
      await rm(a, { recursive: true, force: true })
    }
  })

  test('first-load (no prior project) does NOT broadcast', async ({ assert }) => {
    const a = await makeProject()
    try {
      const seen: unknown[] = []
      const handler = () => seen.push(null)
      projectEvents.on('changed', handler)
      try {
        await projectStore.load(a)
        assert.equal(seen.length, 0)
      } finally {
        projectEvents.off('changed', handler)
      }
    } finally {
      await rm(a, { recursive: true, force: true })
    }
  })
})

test.group('POST /api/project · path-traversal guard', (group) => {
  group.each.setup(async () => {
    await projectStore.unload()
  })
  group.each.teardown(async () => {
    await projectStore.unload()
  })

  test('rejects empty / missing directory with 400', async ({ client }) => {
    const res1 = await client.post('/api/project').json({})
    res1.assertStatus(400)
    res1.assertBodyContains({ error: { code: 'E_BAD_REQUEST' } })

    const res2 = await client.post('/api/project').json({ directory: '' })
    res2.assertStatus(400)
    res2.assertBodyContains({ error: { code: 'E_BAD_REQUEST' } })

    const res3 = await client.post('/api/project').json({ directory: 42 })
    res3.assertStatus(400)
    res3.assertBodyContains({ error: { code: 'E_BAD_REQUEST' } })
  })

  test('rejects control characters in directory with 400', async ({ client }) => {
    for (const bad of ['/tmp/foo\x00bar', '/tmp/foo\nbar', '/tmp/foo\tbar']) {
      const res = await client.post('/api/project').json({ directory: bad })
      res.assertStatus(400)
      res.assertBodyContains({ error: { code: 'E_BAD_REQUEST' } })
    }
  })

  test('rejects `..` segments with 403', async ({ client }) => {
    const res = await client.post('/api/project').json({ directory: '/tmp/../etc' })
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'E_FORBIDDEN_PATH' } })
  })

  test('rejects sensitive system roots with 403', async ({ client }) => {
    for (const dir of ['/etc', '/etc/passwd', '/proc/self', '/sys/kernel', '/dev/null']) {
      const res = await client.post('/api/project').json({ directory: dir })
      res.assertStatus(403)
      res.assertBodyContains({ error: { code: 'E_FORBIDDEN_PATH' } })
    }
  })

  test('accepts a legitimate /tmp path (sanity)', async ({ client }) => {
    const dir = await makeProject()
    try {
      const res = await client.post('/api/project').json({ directory: dir })
      res.assertStatus(200)
      res.assertBodyContains({ root: dir })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('POST /api/projects (scaffold) also enforces the guard', async ({ client }) => {
    const res = await client.post('/api/projects').json({ directory: '/etc/badplace' })
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'E_FORBIDDEN_PATH' } })
  })
})
