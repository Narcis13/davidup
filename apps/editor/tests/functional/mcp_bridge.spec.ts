/*
|--------------------------------------------------------------------------
| MCP bridge tests (step 07)
|--------------------------------------------------------------------------
|
| These tests assert the two halves of the bridge:
|
|   1. Mutating MCP tool calls go through commandBus.apply() with
|      `source: 'mcp'`, end up in the editor's projectStore, and produce
|      byte-identical state to the equivalent UI command.
|
|   2. Read-only MCP tool calls (validate / get_composition / list_tweens)
|      run against a fresh CompositionStore hydrated from the current
|      projectStore composition, so they see the latest committed state.
|
| The router and depsFactory are exercised directly via dispatchTool — that
| is the same code path createEditorMcpServer wires into the stdio transport,
| so we don't need to spawn a real MCP client to verify the contract.
*/

import { test } from '@japa/runner'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { dispatchTool, TOOLS, type ToolDef } from 'davidup/mcp'
import type { z } from 'zod'

import projectStore from '#services/project_store'
import commandBus, { CommandBus } from '#services/command_bus'
import {
  buildDeps,
  buildRouter,
  createEditorMcpServer,
} from '#services/mcp_bridge'

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
  const dir = await mkdtemp(join(tmpdir(), 'davidup-mcpbridge-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(comp, null, 2), 'utf8')
  return dir
}

function findTool(name: string): ToolDef<z.ZodRawShape> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error(`tool "${name}" not in registry`)
  return tool
}

test.group('MCP bridge · router (mutating)', (group) => {
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

  test('add_shape via MCP routes through commandBus and updates projectStore', async ({
    assert,
  }) => {
    const tool = findTool('add_shape')
    const router = buildRouter(commandBus, projectStore)
    const deps = buildDeps(projectStore)
    const result = await dispatchTool(
      tool,
      {
        layerId: 'fg',
        kind: 'rect',
        x: 100,
        y: 100,
        width: 50,
        height: 50,
        fillColor: '#fff',
        id: 'bridged',
      },
      deps,
      router
    )
    assert.isTrue(result.ok)
    const stored = projectStore.composition as {
      items: Record<string, unknown>
      layers: Array<{ id: string; items: string[] }>
    }
    assert.exists(stored.items.bridged)
    assert.include(stored.layers[0].items, 'bridged')
    assert.equal(commandBus.undoStackSize, 1)
  })

  test('mutating MCP tool tags the command with source "mcp"', async ({ assert }) => {
    const tool = findTool('set_composition_property')
    const router = buildRouter(commandBus, projectStore)
    const seen: Array<{ kind: string; source: string }> = []
    const off = commandBus.on((e) =>
      seen.push({ kind: e.command.kind, source: e.source })
    )

    const res = await dispatchTool(
      tool,
      { property: 'duration', value: 5 },
      buildDeps(projectStore),
      router
    )
    off()
    assert.isTrue(res.ok)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].kind, 'set_composition_property')
    assert.equal(seen[0].source, 'mcp')
  })

  test('UI + MCP edit sequences produce byte-identical composition (D4)', async ({
    assert,
  }) => {
    // Drive a sequence as UI...
    await commandBus.apply({
      kind: 'add_layer',
      payload: { id: 'bg', z: 0 },
      source: 'ui',
    })
    await commandBus.apply({
      kind: 'add_shape',
      payload: {
        layerId: 'bg',
        kind: 'rect',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fillColor: '#abc',
        id: 'r1',
      },
      source: 'ui',
    })
    const uiSnapshot = JSON.stringify(projectStore.composition)

    // Reset disk + state; replay the same logical edits through MCP.
    await projectStore.unload()
    await writeFile(join(dir, 'composition.json'), JSON.stringify(BASE_COMP, null, 2), 'utf8')
    await projectStore.load(dir)
    commandBus.reset()

    const router = buildRouter(commandBus, projectStore)

    const r1 = await dispatchTool(
      findTool('add_layer'),
      { id: 'bg', z: 0 },
      buildDeps(projectStore),
      router
    )
    assert.isTrue(r1.ok)
    const r2 = await dispatchTool(
      findTool('add_shape'),
      {
        layerId: 'bg',
        kind: 'rect',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fillColor: '#abc',
        id: 'r1',
      },
      buildDeps(projectStore),
      router
    )
    assert.isTrue(r2.ok)

    const mcpSnapshot = JSON.stringify(projectStore.composition)
    assert.equal(mcpSnapshot, uiSnapshot)
  })

  test('tool rejection surfaces as DispatchResult error from the bus', async ({
    assert,
  }) => {
    const router = buildRouter(commandBus, projectStore)
    const result = await dispatchTool(
      findTool('remove_item'),
      { id: 'ghost' },
      buildDeps(projectStore),
      router
    )
    assert.isFalse(result.ok)
    if (!result.ok) {
      assert.equal(result.error.code, 'E_NOT_FOUND')
    }
  })

  test('routes refuse to fire when no project is loaded', async ({ assert }) => {
    await projectStore.unload()
    const router = buildRouter(commandBus, projectStore)
    const result = await dispatchTool(
      findTool('set_composition_property'),
      { property: 'duration', value: 5 },
      buildDeps(projectStore),
      router
    )
    assert.isFalse(result.ok)
    if (!result.ok) {
      // Bridge surfaces "no project" using the engine's E_NO_COMPOSITION code
      // so MCP clients see the same vocabulary they'd get directly.
      assert.equal(result.error.code, 'E_NO_COMPOSITION')
    }
  })

  test('router preserves the MCP tool result payload (itemId)', async ({ assert }) => {
    const router = buildRouter(commandBus, projectStore)
    const result = await dispatchTool(
      findTool('add_shape'),
      {
        layerId: 'fg',
        kind: 'circle',
        x: 50,
        y: 50,
        width: 20,
        height: 20,
        fillColor: '#000',
      },
      buildDeps(projectStore),
      router
    )
    assert.isTrue(result.ok)
    if (result.ok) {
      assert.property(result.result, 'itemId')
    }
  })
})

test.group('MCP bridge · read-only tools see latest commits', (group) => {
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

  test('get_composition returns the editor\'s current composition', async ({
    assert,
  }) => {
    // Mutate via the bus first.
    await commandBus.apply({
      kind: 'set_composition_property',
      payload: { property: 'duration', value: 9 },
      source: 'ui',
    })

    const router = buildRouter(commandBus, projectStore)
    const result = await dispatchTool(
      findTool('get_composition'),
      {},
      buildDeps(projectStore),
      router
    )
    assert.isTrue(result.ok)
    if (result.ok) {
      const payload = result.result as { json: { composition: { duration: number } } }
      assert.equal(payload.json.composition.duration, 9)
    }
  })

  test('validate reports valid for the loaded composition', async ({ assert }) => {
    const router = buildRouter(commandBus, projectStore)
    const result = await dispatchTool(
      findTool('validate'),
      {},
      buildDeps(projectStore),
      router
    )
    assert.isTrue(result.ok)
    if (result.ok) {
      const payload = result.result as { valid: boolean }
      assert.isTrue(payload.valid)
    }
  })

  test('fresh deps per call reflect intervening commits', async ({ assert }) => {
    const router = buildRouter(commandBus, projectStore)

    const first = await dispatchTool(
      findTool('get_composition'),
      {},
      buildDeps(projectStore),
      router
    )
    assert.isTrue(first.ok)

    // Mutate between the two reads.
    await commandBus.apply({
      kind: 'set_composition_property',
      payload: { property: 'duration', value: 12 },
      source: 'mcp',
    })

    const second = await dispatchTool(
      findTool('get_composition'),
      {},
      // buildDeps is the same factory the router uses — call it fresh.
      buildDeps(projectStore),
      router
    )
    assert.isTrue(second.ok)
    if (second.ok) {
      const payload = second.result as { json: { composition: { duration: number } } }
      assert.equal(payload.json.composition.duration, 12)
    }
  })
})

test.group('MCP bridge · createEditorMcpServer factory', () => {
  test('returns a server with the engine MCP store and identity', ({ assert }) => {
    const bus = new CommandBus()
    const server = createEditorMcpServer({ commandBus: bus, projectStore })
    assert.exists(server.mcp)
    assert.exists(server.store)
    // Don't .start() — that would attach stdio for real.
  })
})

// Polish §20.31 — `render_to_video` returns a jobId immediately by default;
// `get_render` / `list_renders` snapshot the queue. We exercise the bridge's
// `renderControls.start` path directly (no ffmpeg) by stubbing job.run via the
// existing registry — RenderJob is constructed and added to `renderJobs`, then
// we read snapshots back. The actual ffmpeg path is covered by renders.spec.ts.
test.group('MCP bridge · async render (§20.31)', (group) => {
  let dir: string

  group.each.setup(async () => {
    await projectStore.unload()
    // Local require to avoid pulling render_worker into the suite-wide deps.
    const renderJobs = (await import('../../app/workers/render_worker.js')).default
    renderJobs.clear()
    dir = await makeProject()
    await projectStore.load(dir)
    commandBus.reset()
  })

  group.each.teardown(async () => {
    const renderJobs = (await import('../../app/workers/render_worker.js')).default
    // Abort any in-flight jobs so background ffmpeg invocations don't outlive
    // the test (the bridge fires-and-forgets job.run()).
    renderJobs.abortInFlight('test teardown')
    renderJobs.clear()
    await projectStore.unload()
    await rm(dir, { recursive: true, force: true })
  })

  test('render_to_video without `wait` returns jobId + eventsUrl + status', async ({
    assert,
  }) => {
    const router = buildRouter(commandBus, projectStore)
    const result = await dispatchTool(
      findTool('render_to_video'),
      { outputPath: 'mcp-test.mp4' },
      buildDeps(projectStore),
      router
    )
    assert.isTrue(result.ok)
    if (result.ok) {
      const payload = result.result as {
        jobId: string
        status: string
        outputPath: string
        relativeOutputPath: string
        totalFrames: number
        eventsUrl: string
      }
      assert.isString(payload.jobId)
      assert.notEqual(payload.jobId, '')
      assert.isTrue(
        ['pending', 'running', 'done', 'error'].includes(payload.status),
        `unexpected status: ${payload.status}`
      )
      assert.equal(payload.relativeOutputPath, join('renders', 'mcp-test.mp4'))
      assert.isAbove(payload.totalFrames, 0)
      assert.equal(payload.eventsUrl, `/api/renders/${payload.jobId}/events`)
    }
  })

  test('get_render returns a snapshot for a known jobId', async ({ assert }) => {
    const router = buildRouter(commandBus, projectStore)
    const start = await dispatchTool(
      findTool('render_to_video'),
      { outputPath: 'mcp-snapshot.mp4' },
      buildDeps(projectStore),
      router
    )
    assert.isTrue(start.ok)
    if (!start.ok) return
    const { jobId } = start.result as { jobId: string }

    const got = await dispatchTool(
      findTool('get_render'),
      { jobId },
      buildDeps(projectStore),
      router
    )
    assert.isTrue(got.ok)
    if (got.ok) {
      const snap = got.result as { jobId: string; totalFrames: number; status: string }
      assert.equal(snap.jobId, jobId)
      assert.isAbove(snap.totalFrames, 0)
    }
  })

  test('get_render errors E_NOT_FOUND for unknown ids', async ({ assert }) => {
    const router = buildRouter(commandBus, projectStore)
    const got = await dispatchTool(
      findTool('get_render'),
      { jobId: 'ghost-job' },
      buildDeps(projectStore),
      router
    )
    assert.isFalse(got.ok)
    if (!got.ok) assert.equal(got.error.code, 'E_NOT_FOUND')
  })

  test('list_renders returns enqueued jobs newest-first', async ({ assert }) => {
    const router = buildRouter(commandBus, projectStore)
    const a = await dispatchTool(
      findTool('render_to_video'),
      { outputPath: 'a.mp4' },
      buildDeps(projectStore),
      router
    )
    const b = await dispatchTool(
      findTool('render_to_video'),
      { outputPath: 'b.mp4' },
      buildDeps(projectStore),
      router
    )
    assert.isTrue(a.ok)
    assert.isTrue(b.ok)
    const list = await dispatchTool(
      findTool('list_renders'),
      {},
      buildDeps(projectStore),
      router
    )
    assert.isTrue(list.ok)
    if (list.ok) {
      const { jobs } = list.result as { jobs: Array<{ jobId: string }> }
      assert.isAtLeast(jobs.length, 2)
      // Newest first
      if (a.ok && b.ok) {
        const { jobId: idA } = a.result as { jobId: string }
        const { jobId: idB } = b.result as { jobId: string }
        const idxA = jobs.findIndex((j) => j.jobId === idA)
        const idxB = jobs.findIndex((j) => j.jobId === idB)
        assert.isAtLeast(idxA, 0)
        assert.isAtLeast(idxB, 0)
        assert.isBelow(idxB, idxA)
      }
    }
  })

  test('outputPath escaping the project root is rejected with E_INVALID_VALUE', async ({
    assert,
  }) => {
    const router = buildRouter(commandBus, projectStore)
    const result = await dispatchTool(
      findTool('render_to_video'),
      { outputPath: '/tmp/escape-attempt.mp4' },
      buildDeps(projectStore),
      router
    )
    assert.isFalse(result.ok)
    if (!result.ok) assert.equal(result.error.code, 'E_INVALID_VALUE')
  })

  test('render_to_video without a project loaded errors E_NO_COMPOSITION', async ({
    assert,
  }) => {
    await projectStore.unload()
    const router = buildRouter(commandBus, projectStore)
    const result = await dispatchTool(
      findTool('render_to_video'),
      { outputPath: 'no-project.mp4' },
      buildDeps(projectStore),
      router
    )
    assert.isFalse(result.ok)
    if (!result.ok) {
      // ensureValidForRender fires first (against an unloaded store), which
      // surfaces as E_VALIDATION_FAILED in the standalone path; in the editor
      // path the renderControls.start guard surfaces E_NO_COMPOSITION. The
      // bridge uses fresh deps, so a never-loaded store yields the validation
      // path. Either code is acceptable — we only want to ensure the call is
      // rejected, never silently enqueued.
      assert.isTrue(
        ['E_NO_COMPOSITION', 'E_VALIDATION_FAILED'].includes(result.error.code),
        `unexpected code: ${result.error.code}`
      )
    }
  })
})
