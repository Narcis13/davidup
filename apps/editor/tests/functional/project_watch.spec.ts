/*
|--------------------------------------------------------------------------
| composition.json watcher — v1.1 Session 25
|--------------------------------------------------------------------------
|
| An agent (or `git checkout`) writing composition.json while the editor is
| open must refresh the in-memory composition, broadcast exactly one
| `changed` event (`reason: 'external'`) on the /api/projects/events SSE
| channel, and land as a single undo step. The editor's own debounced
| writes must NOT trigger the watcher (content-hash skip).
*/

import { test } from '@japa/runner'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import projectStore from '#services/project_store'
import commandBus from '#services/command_bus'
import projectEvents, { type ProjectChangedPayload } from '#services/project_events'
import type { Command } from '#types/commands'

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

// Long enough for fs.watch delivery + the 100 ms watcher debounce + compile.
const SETTLE_MS = 600

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-watch-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(VALID_COMP, null, 2), 'utf8')
  return dir
}

function recordEvents() {
  const events: ProjectChangedPayload[] = []
  const onChanged = (p: ProjectChangedPayload) => events.push(p)
  projectEvents.on('changed', onChanged)
  return { events, off: () => projectEvents.off('changed', onChanged) }
}

async function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function withDuration(duration: number) {
  return { ...VALID_COMP, composition: { ...VALID_COMP.composition, duration } }
}

test.group('ProjectStore · composition.json watcher', (group) => {
  group.each.setup(async () => {
    await projectStore.unload()
    commandBus.reset()
  })

  test('out-of-band write → /api/project reflects it and SSE fires once', async ({
    client,
    assert,
  }) => {
    const dir = await makeProject()
    const rec = recordEvents()
    try {
      await projectStore.load(dir)
      await writeFile(
        join(dir, 'composition.json'),
        JSON.stringify(withDuration(7), null, 2),
        'utf8'
      )

      await waitFor(() => rec.events.length > 0)
      await sleep(SETTLE_MS)
      assert.lengthOf(rec.events, 1)
      assert.equal(rec.events[0].reason, 'external')
      assert.equal(rec.events[0].root, dir)
      assert.equal(rec.events[0].undoStackSize, 1)

      const res = await client.get('/api/project')
      res.assertStatus(200)
      assert.equal(res.body().composition.composition.duration, 7)
    } finally {
      rec.off()
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('the editor’s own debounced writes do not trigger the watcher', async ({ assert }) => {
    const dir = await makeProject()
    const rec = recordEvents()
    try {
      await projectStore.load(dir)
      await commandBus.apply({
        kind: 'set_composition_property',
        payload: { property: 'duration', value: 5 },
        source: 'ui',
      } satisfies Command)
      await projectStore.flush()
      await sleep(SETTLE_MS)

      const onDisk = JSON.parse(await readFile(join(dir, 'composition.json'), 'utf8'))
      assert.equal(onDisk.composition.duration, 5)
      assert.lengthOf(rec.events, 0)
      assert.equal(commandBus.undoStackSize, 1)
    } finally {
      rec.off()
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('the external edit is one undo step; undo restores the prior in-memory state', async ({
    assert,
  }) => {
    const dir = await makeProject()
    const rec = recordEvents()
    try {
      await projectStore.load(dir)
      await commandBus.apply({
        kind: 'set_composition_property',
        payload: { property: 'duration', value: 4 },
        source: 'ui',
      } satisfies Command)
      await projectStore.flush()

      await writeFile(
        join(dir, 'composition.json'),
        JSON.stringify(withDuration(9), null, 2),
        'utf8'
      )
      await waitFor(() => rec.events.length > 0)
      const comp = () => projectStore.composition as { composition: { duration: number } }
      assert.equal(comp().composition.duration, 9)
      assert.equal(commandBus.undoStackSize, 2)

      commandBus.undo()
      assert.equal(comp().composition.duration, 4)
      commandBus.redo()
      assert.equal(comp().composition.duration, 9)
      commandBus.undo()
      commandBus.undo()
      assert.equal(comp().composition.duration, 3)

      // The undo writes go through the normal writer and stay self-writes.
      await projectStore.flush()
      await sleep(SETTLE_MS)
      assert.lengthOf(rec.events, 1)
    } finally {
      rec.off()
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('an invalid external edit is ignored; the next valid one is adopted', async ({
    assert,
  }) => {
    const dir = await makeProject()
    const rec = recordEvents()
    try {
      await projectStore.load(dir)
      await writeFile(join(dir, 'composition.json'), '{ "version": "0.1", ', 'utf8')
      await sleep(SETTLE_MS)
      assert.lengthOf(rec.events, 0)
      assert.equal(
        (projectStore.composition as { composition: { duration: number } }).composition.duration,
        3
      )

      await writeFile(
        join(dir, 'composition.json'),
        JSON.stringify(withDuration(6), null, 2),
        'utf8'
      )
      await waitFor(() => rec.events.length > 0)
      assert.equal(
        (projectStore.composition as { composition: { duration: number } }).composition.duration,
        6
      )
    } finally {
      rec.off()
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('unload() stops watching', async ({ assert }) => {
    const dir = await makeProject()
    const rec = recordEvents()
    try {
      await projectStore.load(dir)
      await projectStore.unload()
      await writeFile(
        join(dir, 'composition.json'),
        JSON.stringify(withDuration(8), null, 2),
        'utf8'
      )
      await sleep(SETTLE_MS)
      assert.lengthOf(rec.events, 0)
      assert.isNull(projectStore.composition)
    } finally {
      rec.off()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
