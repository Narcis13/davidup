/*
|--------------------------------------------------------------------------
| CommandBus · undo carries source (step 20.2, closes F5)
|--------------------------------------------------------------------------
|
| Before this step `CommandBus.undo()` hard-coded `source: 'ui'` on the
| event it built — and then never emitted it. That broke two things:
|
|   1. subscribers received no `undo` event at all (the variable was
|      assigned and immediately `void`ed),
|   2. when an emission was eventually wired up, the source would have
|      reported every undo as UI-attributed even when the command being
|      reverted came from MCP.
|
| The Inspector's "AI edit" pill (step 20.2 / FR-13 foundation) relies on
| the second of those: undoing an MCP edit must look like an MCP change to
| any per-item attribution map, otherwise the pill flips back to UI as soon
| as the user presses ⌘Z.
|
| This test pushes one MCP command and one UI command through the bus,
| then undoes twice and asserts the emitted source matches the original
| command's source in each case.
*/

import { test } from '@japa/runner'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import projectStore from '#services/project_store'
import commandBus, { type ChangeEvent } from '#services/command_bus'
import type { Command } from '#types/commands'

const BASE_COMP = {
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

function cloneBase() {
  return JSON.parse(JSON.stringify(BASE_COMP))
}

async function resetToBaseline() {
  projectStore.update(cloneBase())
  commandBus.reset()
}

test.group('CommandBus · undo source (FR-13 foundation)', (group) => {
  let dir: string

  group.setup(async () => {
    await projectStore.unload()
    dir = await mkdtemp(join(tmpdir(), 'davidup-cmd-undo-'))
    await writeFile(join(dir, 'composition.json'), JSON.stringify(BASE_COMP, null, 2), 'utf8')
    await projectStore.load(dir)
  })

  group.teardown(async () => {
    await projectStore.unload()
    await rm(dir, { recursive: true, force: true })
  })

  test('undo emits event carrying the original command source', async ({ assert }) => {
    await resetToBaseline()

    const events: ChangeEvent[] = []
    const off = commandBus.on((e) => events.push(e))

    try {
      const mcpCmd: Command = {
        kind: 'add_shape',
        payload: {
          layerId: 'fg',
          kind: 'rect',
          x: 10,
          y: 10,
          width: 50,
          height: 50,
          fillColor: '#ff00ff',
          id: 'shape-from-mcp',
        },
        source: 'mcp',
      }
      const uiCmd: Command = {
        kind: 'set_composition_property',
        payload: { property: 'duration', value: 5 },
        source: 'ui',
      }

      await commandBus.apply(mcpCmd)
      await commandBus.apply(uiCmd)

      // Two forward applies emit two `undo: false` events.
      assert.equal(events.length, 2)
      assert.equal(events[0].source, 'mcp')
      assert.equal(events[0].undo, false)
      assert.equal(events[1].source, 'ui')
      assert.equal(events[1].undo, false)

      // First undo reverts the UI duration change — should report 'ui'.
      const restored1 = commandBus.undo()
      assert.exists(restored1)
      assert.equal(events.length, 3)
      assert.equal(events[2].undo, true)
      assert.equal(events[2].source, 'ui')
      assert.equal(events[2].command.kind, 'set_composition_property')

      // Second undo reverts the MCP add_shape — must report 'mcp', not 'ui'.
      // This is the precise regression the F5 fix targets.
      const restored2 = commandBus.undo()
      assert.exists(restored2)
      assert.equal(events.length, 4)
      assert.equal(events[3].undo, true)
      assert.equal(events[3].source, 'mcp')
      assert.equal(events[3].command.kind, 'add_shape')
    } finally {
      off()
    }
  })

  test('undo on empty stack is a no-op and emits nothing', async ({ assert }) => {
    await resetToBaseline()

    const events: ChangeEvent[] = []
    const off = commandBus.on((e) => events.push(e))

    try {
      const result = commandBus.undo()
      assert.isNull(result)
      assert.equal(events.length, 0)
    } finally {
      off()
    }
  })

  test('undo restores the pre-command composition byte-identically', async ({ assert }) => {
    await resetToBaseline()
    const before = JSON.stringify(projectStore.composition)

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
        id: 'S-undo-byte',
      },
      source: 'mcp',
    } satisfies Command)

    commandBus.undo()
    const after = JSON.stringify(projectStore.composition)
    assert.equal(after, before)
  })
})
