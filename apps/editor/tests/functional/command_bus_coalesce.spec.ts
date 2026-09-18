/*
|--------------------------------------------------------------------------
| CommandBus · coalesced undo + editor polygon dispatch (v1.1 S26)
|--------------------------------------------------------------------------
|
| Arrow-key nudges send one `update_item` per press, all tagged with the
| same `coalesceKey`. The bus must fold a burst of those into ONE undo step
| (undo restores the pre-burst position), while a different key, an
| unkeyed command in between, or a gap longer than the window each start a
| fresh step. The polygon tool's `add_shape` payload must survive both the
| editor's command schema and the engine's post-validation.
*/

import { test } from '@japa/runner'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import projectStore from '#services/project_store'
import commandBus, { CommandBus } from '#services/command_bus'
import { buildPolygonShapePayload } from '../../inertia/composables/polygonToolMath.js'
import { useNudge } from '../../inertia/composables/useNudge.js'

const BASE_COMP = {
  version: '0.1',
  composition: { width: 1280, height: 720, fps: 30, duration: 3, background: '#000000' },
  assets: [],
  layers: [{ id: 'fg', z: 10, opacity: 1, blendMode: 'normal', items: ['a', 'b'] }],
  items: {
    a: {
      type: 'shape',
      kind: 'rect',
      width: 10,
      height: 10,
      fillColor: '#ff0000',
      transform: { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
    },
    b: {
      type: 'shape',
      kind: 'rect',
      width: 10,
      height: 10,
      fillColor: '#00ff00',
      transform: { x: 200, y: 200, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
    },
  },
  tweens: [],
}

function nudgeCmd(id: string, x: number, y: number, coalesceKey?: string) {
  return {
    kind: 'update_item',
    payload: { id, props: { x, y } },
    source: 'ui',
    ...(coalesceKey ? { coalesceKey } : {}),
  }
}

function pos(id: string): { x: number; y: number } {
  const comp = projectStore.composition as unknown as {
    items: Record<string, { transform: { x: number; y: number } }>
  }
  const t = comp.items[id]!.transform
  return { x: t.x, y: t.y }
}

test.group('CommandBus · coalesceKey (S26 nudge)', (group) => {
  let dir: string

  group.setup(async () => {
    await projectStore.unload()
    dir = await mkdtemp(join(tmpdir(), 'davidup-cmd-coalesce-'))
    await writeFile(join(dir, 'composition.json'), JSON.stringify(BASE_COMP, null, 2), 'utf8')
    await projectStore.load(dir)
  })

  group.each.setup(() => {
    projectStore.update(JSON.parse(JSON.stringify(BASE_COMP)))
    commandBus.reset()
  })

  group.teardown(async () => {
    await projectStore.unload()
    await rm(dir, { recursive: true, force: true })
  })

  test('a burst with one key is a single undo step', async ({ assert }) => {
    await commandBus.apply(nudgeCmd('a', 101, 100, 'nudge:a'))
    await commandBus.apply(nudgeCmd('a', 102, 100, 'nudge:a'))
    await commandBus.apply(nudgeCmd('a', 103, 100, 'nudge:a'))
    assert.equal(commandBus.undoStackSize, 1)
    assert.deepEqual(pos('a'), { x: 103, y: 100 })

    commandBus.undo()
    assert.deepEqual(pos('a'), { x: 100, y: 100 })
    assert.equal(commandBus.undoStackSize, 0)

    // Redo restores the end of the burst, not just its first step.
    commandBus.redo()
    assert.deepEqual(pos('a'), { x: 103, y: 100 })
  })

  test('a multi-item nudge (one command per item) is a single undo step', async ({ assert }) => {
    await commandBus.apply(nudgeCmd('a', 110, 100, 'nudge:a,b'))
    await commandBus.apply(nudgeCmd('b', 210, 200, 'nudge:a,b'))
    assert.equal(commandBus.undoStackSize, 1)
    commandBus.undo()
    assert.deepEqual(pos('a'), { x: 100, y: 100 })
    assert.deepEqual(pos('b'), { x: 200, y: 200 })
  })

  test('different key, unkeyed command, or undo in between breaks the burst', async ({
    assert,
  }) => {
    await commandBus.apply(nudgeCmd('a', 101, 100, 'nudge:a'))
    await commandBus.apply(nudgeCmd('b', 201, 200, 'nudge:b'))
    assert.equal(commandBus.undoStackSize, 2)

    await commandBus.apply(nudgeCmd('b', 202, 200))
    await commandBus.apply(nudgeCmd('b', 203, 200, 'nudge:b'))
    assert.equal(commandBus.undoStackSize, 4)

    commandBus.undo()
    await commandBus.apply(nudgeCmd('b', 205, 200, 'nudge:b'))
    assert.equal(commandBus.undoStackSize, 4)
    commandBus.undo()
    assert.deepEqual(pos('b'), { x: 202, y: 200 })
  })

  test('a gap longer than the window starts a new step', async ({ assert }) => {
    const bus = new CommandBus({ coalesceWindowMs: 20 })
    await bus.apply(nudgeCmd('a', 101, 100, 'nudge:a'))
    await bus.apply(nudgeCmd('a', 102, 100, 'nudge:a'))
    await sleep(60)
    await bus.apply(nudgeCmd('a', 103, 100, 'nudge:a'))
    assert.equal(bus.undoStackSize, 2)
    bus.undo()
    assert.deepEqual(pos('a'), { x: 102, y: 100 })
  })

  test('useNudge over the real bus: held-key repeat lands every step, one undo', async ({
    assert,
  }) => {
    let selected: string[] = ['a', 'b']
    const nudger = useNudge({
      getComposition: () => projectStore.composition as never,
      getSelectedIds: () => selected,
      apply: async (command) => {
        await commandBus.apply(command)
      },
    })
    // Fire 12 presses synchronously — faster than any round-trip, so every
    // press after the first sees the stale composition.
    for (let i = 0; i < 10; i++) assert.isTrue(nudger.nudge(1, 0))
    assert.isTrue(nudger.nudge(0, -10))
    assert.isTrue(nudger.nudge(0, -10))
    await nudger.settled()

    assert.deepEqual(pos('a'), { x: 110, y: 80 })
    assert.deepEqual(pos('b'), { x: 210, y: 180 })
    assert.equal(commandBus.undoStackSize, 1)
    commandBus.undo()
    assert.deepEqual(pos('a'), { x: 100, y: 100 })
    assert.deepEqual(pos('b'), { x: 200, y: 200 })

    selected = []
    assert.isFalse(nudger.nudge(1, 0))
  })

  test('the polygon tool payload validates and lands as a polygon shape', async ({ assert }) => {
    const payload = buildPolygonShapePayload('fg', [
      [300, 100],
      [400, 300],
      [200, 300],
      [200, 300], // dblclick's duplicate click
    ])
    assert.isNotNull(payload)
    const result = await commandBus.apply({ kind: 'add_shape', payload, source: 'ui' })
    const id = (result.toolResult as { itemId: string }).itemId
    const item = (result.composition as unknown as { items: Record<string, any> }).items[id]
    assert.equal(item.kind, 'polygon')
    assert.deepEqual(item.points, [
      [100, 0],
      [200, 200],
      [0, 200],
    ])
    assert.equal(item.width, 200)
    assert.equal(item.height, 200)
    assert.equal(item.transform.x, 300)
    assert.equal(item.transform.y, 200)
  })
})
