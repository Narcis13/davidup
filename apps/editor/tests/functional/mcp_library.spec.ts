/*
|--------------------------------------------------------------------------
| MCP `list_library` tool (polish §20.30)
|--------------------------------------------------------------------------
|
| list_library returns the same merged catalog as GET /api/library, including
| `thumbnailUrl`, `scope`, and `overridden`. These tests drive the dispatcher
| directly (no stdio transport) so the assertions can compare the MCP payload
| against the live libraryIndex state.
*/

import { test } from '@japa/runner'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CompositionStore,
  dispatchTool,
  TOOLS,
  type MCPLibraryCatalog,
  type ToolDef,
} from 'davidup/mcp'
import type { z } from 'zod'

import libraryIndex from '#services/library_index'
import projectStore from '#services/project_store'
import { buildDeps } from '#services/mcp_bridge'

function findTool(name: string): ToolDef<z.ZodRawShape> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error(`tool "${name}" not in registry`)
  return tool
}

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

async function makeProjectWithLibrary(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-mcplib-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(VALID_COMP, null, 2), 'utf8')
  const lib = join(dir, 'library')
  await mkdir(lib, { recursive: true })
  await writeFile(
    join(lib, 'index.json'),
    JSON.stringify({
      version: '0.1',
      assets: [
        { id: 'logo-png', name: 'Logo', url: 'assets/logo.png', description: 'Brand logo' },
      ],
      fonts: [{ id: 'inter', family: 'Inter', url: 'fonts/inter.woff2' }],
    }),
    'utf8'
  )
  await writeFile(
    join(lib, 'badge.template.json'),
    JSON.stringify({
      id: 'badge',
      description: 'Pill badge',
      params: [{ name: 'label', type: 'string', required: true }],
      items: { bg: { type: 'shape' } },
    }),
    'utf8'
  )
  await writeFile(
    join(lib, 'fade-in.behavior.json'),
    JSON.stringify({ id: 'fade-in', description: 'Linear fade from 0 to 1' }),
    'utf8'
  )
  return dir
}

test.group('MCP list_library', (group) => {
  group.each.setup(async () => {
    await libraryIndex.detach()
    await libraryIndex.detachGlobal()
    await projectStore.unload()
  })
  group.each.teardown(async () => {
    await libraryIndex.detach()
    await libraryIndex.detachGlobal()
    await projectStore.unload()
  })

  test('returns the empty merged catalog when no library is attached', async ({ assert }) => {
    const res = await dispatchTool(findTool('list_library'), {}, buildDeps(projectStore))
    assert.isTrue(res.ok)
    if (res.ok) {
      const payload = res.result as MCPLibraryCatalog
      assert.equal(payload.attached, false)
      assert.equal(payload.globalAttached, false)
      assert.isNull(payload.projectRoot)
      assert.equal(payload.count, 0)
      assert.equal(payload.total, 0)
      assert.equal(payload.items.length, 0)
      assert.deepEqual(payload.query, { q: null, kind: null, scope: null })
    }
  })

  test('returns the merged catalog after a project is loaded, with thumbnailUrl + scope per item', async ({
    assert,
  }) => {
    const dir = await makeProjectWithLibrary()
    try {
      await projectStore.load(dir)
      await libraryIndex.flush()

      const res = await dispatchTool(findTool('list_library'), {}, buildDeps(projectStore))
      assert.isTrue(res.ok)
      if (!res.ok) return

      const payload = res.result as MCPLibraryCatalog
      assert.equal(payload.attached, true)
      assert.equal(payload.projectRoot, dir)
      assert.isAtLeast(payload.items.length, 4)
      // Every item carries a thumbnailUrl pointing at the same endpoint the UI uses.
      for (const item of payload.items) {
        assert.equal(
          item.thumbnailUrl,
          `/api/library/thumbnail?kind=${encodeURIComponent(
            item.kind
          )}&id=${encodeURIComponent(item.id)}`
        )
        assert.equal(item.scope, 'project')
      }
      const badge = payload.items.find((i) => i.kind === 'template' && i.id === 'badge')
      assert.exists(badge)
      assert.equal(badge!.description, 'Pill badge')
      assert.deepInclude(badge!.params ?? [], {
        name: 'label',
        type: 'string',
        required: true,
      })
      const logo = payload.items.find((i) => i.kind === 'asset' && i.id === 'logo-png')
      assert.exists(logo)
      assert.equal(logo!.url, 'assets/logo.png')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('supports q / kind / scope filters', async ({ assert }) => {
    const dir = await makeProjectWithLibrary()
    try {
      await projectStore.load(dir)
      await libraryIndex.flush()

      const byKind = await dispatchTool(
        findTool('list_library'),
        { kind: 'template' },
        buildDeps(projectStore)
      )
      assert.isTrue(byKind.ok)
      if (byKind.ok) {
        const payload = byKind.result as MCPLibraryCatalog
        assert.isTrue(payload.items.every((i) => i.kind === 'template'))
        assert.isAtLeast(payload.items.length, 1)
        assert.equal(payload.query.kind, 'template')
      }

      const byQ = await dispatchTool(
        findTool('list_library'),
        { q: 'logo' },
        buildDeps(projectStore)
      )
      assert.isTrue(byQ.ok)
      if (byQ.ok) {
        const payload = byQ.result as MCPLibraryCatalog
        assert.isAtLeast(payload.items.length, 1)
        assert.equal(payload.items[0].id, 'logo-png')
        assert.equal(payload.query.q, 'logo')
      }

      const byScope = await dispatchTool(
        findTool('list_library'),
        { scope: 'project' },
        buildDeps(projectStore)
      )
      assert.isTrue(byScope.ok)
      if (byScope.ok) {
        const payload = byScope.result as MCPLibraryCatalog
        assert.isTrue(payload.items.every((i) => i.scope === 'project'))
        assert.equal(payload.query.scope, 'project')
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('rejects unknown kind / scope at the schema layer', async ({ assert }) => {
    const res = await dispatchTool(
      findTool('list_library'),
      { kind: 'banana' as unknown as 'template' },
      buildDeps(projectStore)
    )
    assert.isFalse(res.ok)
    if (!res.ok) {
      assert.equal(res.error.code, 'E_INVALID_VALUE')
    }
  })

  test('surfaces E_UNKNOWN when libraryControls are not injected (standalone engine)', async ({
    assert,
  }) => {
    const res = await dispatchTool(
      findTool('list_library'),
      {},
      { store: new CompositionStore() }
    )
    assert.isFalse(res.ok)
    if (!res.ok) {
      assert.equal(res.error.code, 'E_UNKNOWN')
    }
  })
})
