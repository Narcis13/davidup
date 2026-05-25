import { test } from '@japa/runner'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import projectStore from '#services/project_store'
import { applyCommand, ApplyCommandError } from '#services/apply_command'
import commandBus, {
  CommandBus,
  CommandRejectedError,
  CommandValidationError,
  PostValidationError,
} from '#services/command_bus'
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
  layers: [{ id: 'fg', z: 10, opacity: 1, blendMode: 'normal', items: ['logo'] }],
  items: {
    logo: {
      type: 'shape',
      kind: 'rect',
      width: 320,
      height: 320,
      fillColor: '#ff6b35',
      transform: {
        x: 640,
        y: 360,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0.5,
        anchorY: 0.5,
        opacity: 1,
      },
    },
  },
  tweens: [],
}

function cloneComp() {
  return JSON.parse(JSON.stringify(BASE_COMP))
}

async function makeProject(comp: unknown = cloneComp()): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-cmd-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(comp, null, 2), 'utf8')
  return dir
}

// ──────────────── applyCommand · pure function ────────────────

test.group('applyCommand · pure', () => {
  test('set_composition_property updates meta without mutating input', async ({ assert }) => {
    const input = cloneComp()
    const before = JSON.stringify(input)
    const next = await applyCommand(input, {
      kind: 'set_composition_property',
      payload: { property: 'duration', value: 4.5 },
      source: 'ui',
    })
    assert.equal(next.composition.duration, 4.5)
    // Input untouched (purity).
    assert.equal(JSON.stringify(input), before)
  })

  test('add_layer appends a new layer with default opacity/blendMode', async ({ assert }) => {
    const next = await applyCommand(cloneComp(), {
      kind: 'add_layer',
      payload: { id: 'bg', z: 0 },
      source: 'ui',
    })
    assert.equal(next.layers.length, 2)
    const bg = next.layers.find((l) => l.id === 'bg')
    assert.exists(bg)
    assert.equal(bg!.opacity, 1)
    assert.equal(bg!.blendMode, 'normal')
  })

  test('add_shape places item into target layer', async ({ assert }) => {
    const next = await applyCommand(cloneComp(), {
      kind: 'add_shape',
      payload: {
        layerId: 'fg',
        kind: 'circle',
        x: 200,
        y: 200,
        width: 100,
        height: 100,
        fillColor: '#ffffff',
        id: 'dot',
      },
      source: 'ui',
    })
    assert.exists(next.items.dot)
    assert.include(next.layers[0].items, 'dot')
  })

  test('update_item patches nested transform fields', async ({ assert }) => {
    const next = await applyCommand(cloneComp(), {
      kind: 'update_item',
      payload: { id: 'logo', props: { opacity: 0.5, x: 100 } },
      source: 'ui',
    })
    const logo = next.items.logo as { transform: { opacity: number; x: number } }
    assert.equal(logo.transform.opacity, 0.5)
    assert.equal(logo.transform.x, 100)
  })

  test('add_tween + update_tween + remove_tween round-trip', async ({ assert }) => {
    const a = await applyCommand(cloneComp(), {
      kind: 'add_tween',
      payload: {
        target: 'logo',
        property: 'transform.opacity',
        from: 0,
        to: 1,
        start: 0,
        duration: 1,
        id: 'fade',
      },
      source: 'ui',
    })
    assert.equal(a.tweens.length, 1)

    const b = await applyCommand(a, {
      kind: 'update_tween',
      payload: { id: 'fade', props: { duration: 2 } },
      source: 'ui',
    })
    assert.equal(b.tweens[0].duration, 2)

    const c = await applyCommand(b, {
      kind: 'remove_tween',
      payload: { id: 'fade' },
      source: 'ui',
    })
    assert.equal(c.tweens.length, 0)
  })

  test('tool rejection surfaces as ApplyCommandError with MCP code', async ({ assert }) => {
    await assert.rejects(
      () =>
        applyCommand(cloneComp(), {
          kind: 'update_item',
          payload: { id: 'does-not-exist', props: { opacity: 0.5 } },
          source: 'ui',
        }),
      ApplyCommandError
    )
  })

  test('tween overlap rejected by ensureNoOverlap propagates', async ({ assert }) => {
    const a = await applyCommand(cloneComp(), {
      kind: 'add_tween',
      payload: {
        target: 'logo',
        property: 'transform.opacity',
        from: 0,
        to: 1,
        start: 0,
        duration: 1,
        id: 't1',
      },
      source: 'ui',
    })
    try {
      await applyCommand(a, {
        kind: 'add_tween',
        payload: {
          target: 'logo',
          property: 'transform.opacity',
          from: 0,
          to: 1,
          start: 0.5,
          duration: 1,
          id: 't2',
        },
        source: 'ui',
      })
      assert.fail('expected overlap error')
    } catch (err) {
      assert.instanceOf(err, ApplyCommandError)
      assert.equal((err as ApplyCommandError).code, 'E_TWEEN_OVERLAP')
    }
  })

  test('byte-equal output for byte-equal input (determinism anchor)', async ({ assert }) => {
    const cmd: Command = {
      kind: 'add_shape',
      payload: {
        layerId: 'fg',
        kind: 'rect',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fillColor: '#fff',
        id: 'r1',
      },
      source: 'ui',
    }
    const a = await applyCommand(cloneComp(), cmd)
    const b = await applyCommand(cloneComp(), cmd)
    assert.equal(JSON.stringify(a), JSON.stringify(b))
  })
})

// ──────────────── CommandBus ────────────────

test.group('CommandBus · in-process', (group) => {
  let dir: string

  group.each.setup(async () => {
    await projectStore.unload()
    dir = await makeProject()
    await projectStore.load(dir)
    commandBus.reset()
  })

  group.each.teardown(async () => {
    await projectStore.unload()
    await rm(dir, { recursive: true, force: true })
  })

  test('apply() Zod-rejects unknown command kinds', async ({ assert }) => {
    await assert.rejects(
      () => commandBus.apply({ kind: 'definitely_not_a_command', payload: {} }),
      CommandValidationError
    )
  })

  test('apply() Zod-rejects malformed payloads', async ({ assert }) => {
    await assert.rejects(
      () =>
        commandBus.apply({
          kind: 'add_layer',
          // missing z (required)
          payload: { id: 'oops' },
        }),
      CommandValidationError
    )
  })

  test('apply() updates project store composition', async ({ assert }) => {
    const result = await commandBus.apply({
      kind: 'set_composition_property',
      payload: { property: 'duration', value: 5 },
      source: 'ui',
    } satisfies Command)
    assert.equal(result.composition.composition.duration, 5)
    const stored = projectStore.composition as { composition: { duration: number } }
    assert.equal(stored.composition.duration, 5)
  })

  test('apply() snapshots prior composition for undo (stack size grows)', async ({ assert }) => {
    assert.equal(commandBus.undoStackSize, 0)
    await commandBus.apply({
      kind: 'set_composition_property',
      payload: { property: 'duration', value: 4 },
      source: 'ui',
    } satisfies Command)
    assert.equal(commandBus.undoStackSize, 1)
    await commandBus.apply({
      kind: 'set_composition_property',
      payload: { property: 'duration', value: 5 },
      source: 'ui',
    } satisfies Command)
    assert.equal(commandBus.undoStackSize, 2)
  })

  test('undo() restores the previous composition', async ({ assert }) => {
    await commandBus.apply({
      kind: 'set_composition_property',
      payload: { property: 'duration', value: 4 },
      source: 'ui',
    } satisfies Command)
    const restored = commandBus.undo()
    assert.exists(restored)
    assert.equal(restored!.composition.duration, 3) // original
    const stored = projectStore.composition as { composition: { duration: number } }
    assert.equal(stored.composition.duration, 3)
  })

  test('undo() returns null on empty stack', async ({ assert }) => {
    assert.isNull(commandBus.undo())
  })

  test('undo stack is bounded to depth', async ({ assert }) => {
    const bus = new CommandBus({ undoDepth: 3 })
    for (let i = 0; i < 5; i++) {
      await bus.apply({
        kind: 'set_composition_property',
        payload: { property: 'duration', value: 4 + i * 0.1 },
        source: 'ui',
      } satisfies Command)
    }
    assert.equal(bus.undoStackSize, 3)
  })

  test('on() subscribers receive change events', async ({ assert }) => {
    const seen: Array<{ kind: string; source: string }> = []
    const off = commandBus.on((e) => seen.push({ kind: e.command.kind, source: e.source }))

    await commandBus.apply({
      kind: 'set_composition_property',
      payload: { property: 'duration', value: 6 },
      source: 'mcp',
    } satisfies Command)

    off()
    await commandBus.apply({
      kind: 'set_composition_property',
      payload: { property: 'duration', value: 7 },
      source: 'ui',
    } satisfies Command)

    assert.equal(seen.length, 1)
    assert.equal(seen[0].kind, 'set_composition_property')
    assert.equal(seen[0].source, 'mcp')
  })

  test('subscriber throw does not abort the bus', async ({ assert }) => {
    commandBus.on(() => {
      throw new Error('subscriber boom')
    })
    const result = await commandBus.apply({
      kind: 'set_composition_property',
      payload: { property: 'duration', value: 8 },
      source: 'ui',
    } satisfies Command)
    assert.equal(result.composition.composition.duration, 8)
  })

  test('tool rejection becomes CommandRejectedError', async ({ assert }) => {
    await assert.rejects(
      () =>
        commandBus.apply({
          kind: 'remove_item',
          payload: { id: 'never-existed' },
          source: 'ui',
        } satisfies Command),
      CommandRejectedError
    )
  })

  test('UI and MCP sources produce byte-identical compositions (D4)', async ({ assert }) => {
    const cmd = {
      kind: 'add_shape',
      payload: {
        layerId: 'fg',
        kind: 'rect',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fillColor: '#fff',
        id: 'r1',
      },
    } as const

    const fromUi = await commandBus.apply({ ...cmd, source: 'ui' })
    await projectStore.unload()
    // Restore the on-disk composition so the second apply starts from the
    // same baseline as the first. unload() flushes the UI-applied state.
    await writeFile(join(dir, 'composition.json'), JSON.stringify(BASE_COMP, null, 2), 'utf8')
    await projectStore.load(dir)
    commandBus.reset()
    const fromMcp = await commandBus.apply({ ...cmd, source: 'mcp' })

    // Strip source from comparison — only the composition shape matters.
    assert.equal(
      JSON.stringify(fromUi.composition),
      JSON.stringify(fromMcp.composition)
    )
  })
})

// ──────────────── HTTP · POST /api/command ────────────────

test.group('POST /api/command', (group) => {
  let dir: string

  group.each.setup(async () => {
    await projectStore.unload()
    dir = await makeProject()
    await projectStore.load(dir)
    commandBus.reset()
  })

  group.each.teardown(async () => {
    await projectStore.unload()
    await rm(dir, { recursive: true, force: true })
  })

  test('200 when command applies', async ({ client }) => {
    const res = await client.post('/api/command').json({
      kind: 'set_composition_property',
      payload: { property: 'duration', value: 4.25 },
      source: 'ui',
    })
    res.assertStatus(200)
    res.assertBodyContains({
      composition: { composition: { duration: 4.25 } },
      undoStackSize: 1,
    })
  })

  test('400 on malformed command shape', async ({ client }) => {
    const res = await client.post('/api/command').json({ kind: 'add_layer', payload: {} })
    res.assertStatus(400)
    res.assertBodyContains({ error: { code: 'E_INVALID_COMMAND' } })
  })

  test('409 on tool rejection (E_NOT_FOUND)', async ({ client }) => {
    const res = await client.post('/api/command').json({
      kind: 'remove_item',
      payload: { id: 'ghost' },
    })
    res.assertStatus(409)
    res.assertBodyContains({ error: { code: 'E_NOT_FOUND' } })
  })

  test('404 when no project is loaded', async ({ client }) => {
    await projectStore.unload()
    const res = await client.post('/api/command').json({
      kind: 'set_composition_property',
      payload: { property: 'duration', value: 5 },
      source: 'ui',
    })
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'E_NO_PROJECT' } })
  })

  test('PostValidationError is impossible for healthy tool runs (smoke)', async ({ client }) => {
    // A successful chain of three small mutations should never trip the post-
    // validation guard. This is a smoke test that the validator pass and the
    // tool-emitted state agree for ordinary edits.
    const r1 = await client.post('/api/command').json({
      kind: 'add_layer',
      payload: { id: 'bg', z: 0 },
    })
    r1.assertStatus(200)
    const r2 = await client.post('/api/command').json({
      kind: 'add_shape',
      payload: {
        layerId: 'bg',
        kind: 'rect',
        x: 0,
        y: 0,
        width: 1280,
        height: 720,
        fillColor: '#000',
        id: 'bgrect',
      },
    })
    r2.assertStatus(200)
    const r3 = await client.post('/api/command').json({
      kind: 'add_tween',
      payload: {
        target: 'bgrect',
        property: 'transform.opacity',
        from: 0,
        to: 1,
        start: 0,
        duration: 0.5,
        id: 'fadein',
      },
    })
    r3.assertStatus(200)
  })
})

// ──────────────── Suppress unused-import lint ────────────────
void PostValidationError
