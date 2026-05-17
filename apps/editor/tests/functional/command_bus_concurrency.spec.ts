/*
|--------------------------------------------------------------------------
| CommandBus · concurrency property test (step 20.1, closes F2 / D11)
|--------------------------------------------------------------------------
|
| Without the serialization mutex in `command_bus.ts`, two `apply()` calls
| fired in the same microtask both read the same baseline composition,
| run their tool, and then race to call `projectStore.update()`. The
| second call's write silently clobbers the first — which is exactly the
| concurrent UI+MCP corruption D11 in the audit.
|
| This test asserts the post-fix invariant: for any sequence of commands,
| firing them concurrently via `Promise.all` produces the byte-identical
| composition that sequential `await commandBus.apply(...)` produces.
| The PRD's D4 byte-equality guarantee depends on it.
|
| 1000 random sequences × 2 application modes per sequence. The PRNG is
| seeded so a failing iteration can be re-run by jumping straight to its
| seed offset.
*/

import { test } from '@japa/runner'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import projectStore from '#services/project_store'
import commandBus from '#services/command_bus'
import type { Command, CommandSource } from '#types/commands'

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

// Deterministic LCG so failing iterations are reproducible — std random
// would obscure which seed broke the property.
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

// Each command in the sequence gets a unique id (`L${i}`, `S${i}`, ...) so
// concurrent applies never collide on auto-generated ids; that lets us
// isolate the race we actually care about (read/modify/write of composition)
// from incidental id collisions.
function makeCommand(rand: () => number, idx: number): Command {
  const source: CommandSource = rand() < 0.5 ? 'ui' : 'mcp'
  const variant = Math.floor(rand() * 4)
  switch (variant) {
    case 0:
      return {
        kind: 'set_composition_property',
        payload: {
          property: 'duration',
          value: Math.round((1 + rand() * 9) * 100) / 100,
        },
        source,
      }
    case 1:
      return {
        kind: 'add_layer',
        payload: { id: `L${idx}`, z: Math.floor(rand() * 100) },
        source,
      }
    case 2:
      return {
        kind: 'add_shape',
        payload: {
          layerId: 'fg',
          kind: 'rect',
          x: Math.floor(rand() * 1000),
          y: Math.floor(rand() * 500),
          width: 10 + Math.floor(rand() * 100),
          height: 10 + Math.floor(rand() * 100),
          fillColor: '#ffffff',
          id: `S${idx}`,
        },
        source,
      }
    default:
      return {
        kind: 'set_composition_property',
        payload: { property: 'background', value: '#101010' },
        source,
      }
  }
}

async function resetToBaseline() {
  projectStore.update(cloneBase())
  commandBus.reset()
}

test.group('CommandBus · concurrency (mutex)', (group) => {
  let dir: string

  group.setup(async () => {
    await projectStore.unload()
    dir = await mkdtemp(join(tmpdir(), 'davidup-cmd-conc-'))
    await writeFile(join(dir, 'composition.json'), JSON.stringify(BASE_COMP, null, 2), 'utf8')
    await projectStore.load(dir)
  })

  group.teardown(async () => {
    await projectStore.unload()
    await rm(dir, { recursive: true, force: true })
  })

  test('1000 random UI+MCP sequences: concurrent == sequential, byte-identical', async ({
    assert,
  }) => {
    const ITERATIONS = 1000
    const COMMANDS_PER_ITER = 5

    for (let i = 0; i < ITERATIONS; i++) {
      const rand = makeRng(0xc0ffee + i)
      const commands: Command[] = []
      for (let j = 0; j < COMMANDS_PER_ITER; j++) {
        commands.push(makeCommand(rand, j))
      }

      // Sequential reference: every apply awaits the previous one fully.
      await resetToBaseline()
      for (const cmd of commands) {
        await commandBus.apply(cmd)
      }
      const sequential = JSON.stringify(projectStore.composition)

      // Concurrent: fire them all in the same microtask, then await the
      // batch. Without the mutex the second-onwards apply would re-read the
      // same baseline as the first and the chain's writes would overwrite
      // each other in arrival order, producing a divergent composition.
      await resetToBaseline()
      await Promise.all(commands.map((cmd) => commandBus.apply(cmd)))
      const concurrent = JSON.stringify(projectStore.composition)

      if (sequential !== concurrent) {
        assert.fail(
          `Divergence at iteration ${i} (seed ${0xc0ffee + i}):\n` +
            `commands: ${JSON.stringify(commands)}\n` +
            `sequential: ${sequential}\n` +
            `concurrent: ${concurrent}`
        )
      }
    }
  }).timeout(60_000)

  test('concurrent failing + succeeding commands do not poison the queue', async ({ assert }) => {
    await resetToBaseline()

    // Mix a guaranteed-to-fail apply (no such item) with two successful
    // applies. The queue must continue past the rejection — if the chain
    // were left rejected, the subsequent commands would never run.
    const settled = await Promise.allSettled([
      commandBus.apply({
        kind: 'set_composition_property',
        payload: { property: 'duration', value: 4 },
        source: 'ui',
      } satisfies Command),
      commandBus.apply({
        kind: 'remove_item',
        payload: { id: 'ghost-id' },
        source: 'mcp',
      } satisfies Command),
      commandBus.apply({
        kind: 'add_layer',
        payload: { id: 'after-fail', z: 1 },
        source: 'ui',
      } satisfies Command),
    ])

    assert.equal(settled[0].status, 'fulfilled')
    assert.equal(settled[1].status, 'rejected')
    assert.equal(settled[2].status, 'fulfilled')

    const final = projectStore.composition as {
      composition: { duration: number }
      layers: Array<{ id: string }>
    }
    assert.equal(final.composition.duration, 4)
    assert.exists(final.layers.find((l) => l.id === 'after-fail'))
  })
})
