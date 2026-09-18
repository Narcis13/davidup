/*
|--------------------------------------------------------------------------
| v1.1 S29 — editable Source drawer (replace_composition), MCP routing of
| the same tool, and cross-platform reveal/play commands.
|--------------------------------------------------------------------------
*/

import { test } from '@japa/runner'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { dispatchTool, TOOLS, type ToolDef } from 'davidup/mcp'
import type { z } from 'zod'

import projectStore from '#services/project_store'
import commandBus from '#services/command_bus'
import { buildDeps, buildRouter } from '#services/mcp_bridge'
import { shellCommandFor } from '#services/shell_open'

const BASE_COMP = {
  version: '0.1',
  composition: { width: 1280, height: 720, fps: 60, duration: 3, background: '#0a0e27' },
  assets: [],
  layers: [{ id: 'fg', z: 10, opacity: 1, blendMode: 'normal', items: ['logo'], name: 'Front' }],
  items: {
    logo: {
      type: 'shape',
      kind: 'rect',
      width: 320,
      height: 320,
      fillColor: '#ff6b35',
      transform: { x: 640, y: 360, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1 },
    },
  },
  tweens: [],
}

function edited(): Record<string, unknown> {
  const doc = JSON.parse(JSON.stringify(BASE_COMP))
  doc.composition.background = '#112233'
  doc.items.logo.fillColor = '#00ff00'
  doc.tweens = [
    { id: 'slide', target: 'logo', property: 'transform.x', from: 100, to: 900, start: 0, duration: 1 },
  ]
  return doc
}

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-source-edit-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(BASE_COMP, null, 2), 'utf8')
  return dir
}

function findTool(name: string): ToolDef<z.ZodRawShape> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error(`tool "${name}" not in registry`)
  return tool
}

test.group('replace_composition · Source drawer save path', (group) => {
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

  test('POST /api/command swaps the whole document as one undo step', async ({
    client,
    assert,
  }) => {
    const res = await client
      .post('/api/command')
      .json({ kind: 'replace_composition', payload: { json: edited() } })
    res.assertStatus(200)
    const next = res.body().composition
    assert.deepEqual(next, edited())
    assert.equal(res.body().undoStackSize, 1)
    assert.deepEqual(projectStore.composition, edited())

    const undo = await client.post('/api/command/undo')
    undo.assertStatus(200)
    assert.deepEqual(undo.body().composition, BASE_COMP)
  })

  test('an invalid document is rejected with the validator issues and changes nothing', async ({
    client,
    assert,
  }) => {
    const bad = edited()
    ;(bad.tweens as Array<Record<string, unknown>>)[0]!.target = 'ghost'
    const res = await client
      .post('/api/command')
      .json({ kind: 'replace_composition', payload: { json: bad } })
    res.assertStatus(409)
    assert.equal(res.body().error.code, 'E_VALIDATION_FAILED')
    assert.isAbove(res.body().error.issues.length, 0)
    assert.equal(commandBus.undoStackSize, 0)
    assert.deepEqual(projectStore.composition, BASE_COMP)
  })

  test('layer names survive later commands (hydration keeps `name`)', async ({ assert }) => {
    await commandBus.apply({
      kind: 'update_item',
      payload: { id: 'logo', props: { x: 10 } },
      source: 'ui',
    })
    const comp = projectStore.composition as { layers: Array<{ name?: string }> }
    assert.equal(comp.layers[0]!.name, 'Front')
  })

  test('MCP replace_composition routes through the bus with source mcp', async ({ assert }) => {
    const seen: string[] = []
    const off = commandBus.on((e) => seen.push(`${e.command.kind}:${e.source}`))
    const result = await dispatchTool(
      findTool('replace_composition'),
      { json: edited() },
      buildDeps(projectStore),
      buildRouter(commandBus, projectStore)
    )
    off()
    assert.isTrue(result.ok)
    assert.deepEqual(seen, ['replace_composition:mcp'])
    assert.deepEqual(projectStore.composition, edited())
  })
})

test.group('shellCommandFor · reveal / play per platform', () => {
  const file = '/p/renders/out.mp4'

  test('macOS uses open -R / QuickTime', ({ assert }) => {
    assert.deepEqual(shellCommandFor('darwin', 'reveal', file), {
      command: 'open',
      args: ['-R', file],
    })
    assert.deepEqual(shellCommandFor('darwin', 'play', file), {
      command: 'open',
      args: ['-a', 'QuickTime Player', file],
    })
  })

  test('Windows uses explorer /select, and the default app', ({ assert }) => {
    assert.deepEqual(shellCommandFor('win32', 'reveal', file), {
      command: 'explorer',
      args: [`/select,${file}`],
    })
    assert.deepEqual(shellCommandFor('win32', 'play', file), {
      command: 'explorer',
      args: [file],
    })
  })

  test('Linux opens the containing folder / the file with xdg-open', ({ assert }) => {
    assert.deepEqual(shellCommandFor('linux', 'reveal', file), {
      command: 'xdg-open',
      args: ['/p/renders'],
    })
    assert.deepEqual(shellCommandFor('linux', 'play', file), {
      command: 'xdg-open',
      args: [file],
    })
  })
})
