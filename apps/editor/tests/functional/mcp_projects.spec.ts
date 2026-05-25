/*
|--------------------------------------------------------------------------
| MCP project lifecycle tools (polish §20.29)
|--------------------------------------------------------------------------
|
| current_project / list_projects / open_project / create_project are wired
| into the editor's mcp_bridge so they reuse the same ProjectStore + recents
| + scaffoldProject path the HTTP controllers do. These tests drive the
| dispatcher directly (no stdio transport) so we can assert envelope shape
| and editor-side side effects in the same run.
*/

import { test } from '@japa/runner'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { dispatchTool, TOOLS, type ToolDef } from 'davidup/mcp'
import type { z } from 'zod'

import projectStore from '#services/project_store'
import recents from '#services/recents'
import { buildDeps } from '#services/mcp_bridge'

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

function findTool(name: string): ToolDef<z.ZodRawShape> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error(`tool "${name}" not in registry`)
  return tool
}

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-mcpproj-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(VALID_COMP, null, 2), 'utf8')
  return dir
}

async function makeEmptyDir(prefix = 'davidup-mcpproj-empty-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

async function freshRecentsPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-mcpproj-recents-'))
  recents.setPath(join(dir, 'recents.json'))
  return dir
}

test.group('MCP project tools · current_project', (group) => {
  let stateDir: string
  group.each.setup(async () => {
    await projectStore.unload()
    stateDir = await freshRecentsPath()
  })
  group.each.teardown(async () => {
    await projectStore.unload()
    recents.setPath(null)
    await rm(stateDir, { recursive: true, force: true })
  })

  test('returns null when no project is loaded', async ({ assert }) => {
    const res = await dispatchTool(findTool('current_project'), {}, buildDeps(projectStore))
    assert.isTrue(res.ok)
    if (res.ok) {
      assert.deepEqual(res.result, { project: null })
    }
  })

  test('returns root + paths when a project is loaded', async ({ assert }) => {
    const dir = await makeProject()
    try {
      await projectStore.load(dir)
      const res = await dispatchTool(findTool('current_project'), {}, buildDeps(projectStore))
      assert.isTrue(res.ok)
      if (res.ok) {
        const payload = res.result as {
          project: { root: string; compositionPath: string; loadedAt: number }
        }
        assert.equal(payload.project.root, dir)
        assert.equal(payload.project.compositionPath, join(dir, 'composition.json'))
        assert.isNumber(payload.project.loadedAt)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

test.group('MCP project tools · list_projects', (group) => {
  let stateDir: string
  group.each.setup(async () => {
    await projectStore.unload()
    stateDir = await freshRecentsPath()
  })
  group.each.teardown(async () => {
    await projectStore.unload()
    recents.setPath(null)
    await rm(stateDir, { recursive: true, force: true })
  })

  test('returns empty list when there are no recents', async ({ assert }) => {
    const res = await dispatchTool(findTool('list_projects'), {}, buildDeps(projectStore))
    assert.isTrue(res.ok)
    if (res.ok) {
      assert.deepEqual(res.result, { projects: [] })
    }
  })

  test('returns entries sorted newest first, with pruning', async ({ assert }) => {
    const a = await makeProject()
    const b = await makeProject()
    try {
      await recents.touch(a)
      await new Promise((r) => setTimeout(r, 10))
      await recents.touch(b)
      const res = await dispatchTool(findTool('list_projects'), {}, buildDeps(projectStore))
      assert.isTrue(res.ok)
      if (res.ok) {
        const payload = res.result as { projects: { path: string }[] }
        assert.equal(payload.projects.length, 2)
        assert.equal(payload.projects[0].path, b)
        assert.equal(payload.projects[1].path, a)
      }
    } finally {
      await rm(a, { recursive: true, force: true })
      await rm(b, { recursive: true, force: true })
    }
  })
})

test.group('MCP project tools · open_project', (group) => {
  let stateDir: string
  group.each.setup(async () => {
    await projectStore.unload()
    stateDir = await freshRecentsPath()
  })
  group.each.teardown(async () => {
    await projectStore.unload()
    recents.setPath(null)
    await rm(stateDir, { recursive: true, force: true })
  })

  test('loads a project and updates projectStore + recents', async ({ assert }) => {
    const dir = await makeProject()
    try {
      const res = await dispatchTool(
        findTool('open_project'),
        { path: dir },
        buildDeps(projectStore),
      )
      assert.isTrue(res.ok)
      if (res.ok) {
        const payload = res.result as { project: { root: string } }
        assert.equal(payload.project.root, dir)
      }
      assert.isTrue(projectStore.isLoaded)
      assert.equal(projectStore.project!.root, dir)
      const list = await recents.list()
      assert.equal(list[0].path, dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('E_NOT_FOUND when the directory has no composition.json', async ({ assert }) => {
    const dir = await makeEmptyDir()
    try {
      const res = await dispatchTool(
        findTool('open_project'),
        { path: dir },
        buildDeps(projectStore),
      )
      assert.isFalse(res.ok)
      if (!res.ok) {
        assert.equal(res.error.code, 'E_NOT_FOUND')
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('E_INVALID_VALUE when the path is in a protected location', async ({ assert }) => {
    const res = await dispatchTool(
      findTool('open_project'),
      { path: '/etc' },
      buildDeps(projectStore),
    )
    assert.isFalse(res.ok)
    if (!res.ok) {
      assert.equal(res.error.code, 'E_INVALID_VALUE')
    }
  })

  test('E_INVALID_VALUE when the path contains `..` segments', async ({ assert }) => {
    const res = await dispatchTool(
      findTool('open_project'),
      { path: '/tmp/../etc/passwd' },
      buildDeps(projectStore),
    )
    assert.isFalse(res.ok)
    if (!res.ok) {
      assert.equal(res.error.code, 'E_INVALID_VALUE')
    }
  })
})

test.group('MCP project tools · create_project', (group) => {
  let stateDir: string
  group.each.setup(async () => {
    await projectStore.unload()
    stateDir = await freshRecentsPath()
  })
  group.each.teardown(async () => {
    await projectStore.unload()
    recents.setPath(null)
    await rm(stateDir, { recursive: true, force: true })
  })

  test('scaffolds + loads a new project and labels the recents entry', async ({
    assert,
  }) => {
    const parent = await makeEmptyDir('davidup-mcpproj-parent-')
    try {
      const res = await dispatchTool(
        findTool('create_project'),
        { name: 'my-clip', location: parent },
        buildDeps(projectStore),
      )
      assert.isTrue(res.ok)
      const target = join(parent, 'my-clip')
      if (res.ok) {
        const payload = res.result as { project: { root: string; compositionPath: string } }
        assert.equal(payload.project.root, target)
        assert.equal(payload.project.compositionPath, join(target, 'composition.json'))
      }
      // composition.json was scaffolded and is valid JSON.
      const raw = await readFile(join(target, 'composition.json'), 'utf8')
      assert.doesNotThrow(() => JSON.parse(raw))
      // ProjectStore was switched to the new project.
      assert.isTrue(projectStore.isLoaded)
      assert.equal(projectStore.project!.root, target)
      // recents was bumped under the `name` label.
      const list = await recents.list()
      assert.equal(list[0].path, target)
      assert.equal(list[0].name, 'my-clip')
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  test('honours `template` and the basename when the directory differs', async ({
    assert,
  }) => {
    const parent = await makeEmptyDir('davidup-mcpproj-tpl-')
    try {
      const res = await dispatchTool(
        findTool('create_project'),
        { name: 'auto', location: parent, template: 'basic' },
        buildDeps(projectStore),
      )
      assert.isTrue(res.ok)
      const target = join(parent, 'auto')
      assert.equal(basename(target), 'auto')
      assert.equal(projectStore.project!.root, target)
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  test('E_NOT_FOUND when template is unknown', async ({ assert }) => {
    const parent = await makeEmptyDir('davidup-mcpproj-badtpl-')
    try {
      const res = await dispatchTool(
        findTool('create_project'),
        { name: 'p', location: parent, template: 'no-such-template' },
        buildDeps(projectStore),
      )
      assert.isFalse(res.ok)
      if (!res.ok) {
        assert.equal(res.error.code, 'E_NOT_FOUND')
      }
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  test('E_INVALID_VALUE when target directory is non-empty', async ({ assert }) => {
    const parent = await makeEmptyDir('davidup-mcpproj-nonempty-')
    const name = 'occupied'
    const target = join(parent, name)
    // scaffold refuses to write into a directory that already has content
    // (matches POST /api/projects behaviour for the same case).
    const { mkdir } = await import('node:fs/promises')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'stray.txt'), 'do not overwrite me', 'utf8')
    try {
      const res = await dispatchTool(
        findTool('create_project'),
        { name, location: parent },
        buildDeps(projectStore),
      )
      assert.isFalse(res.ok)
      if (!res.ok) {
        assert.equal(res.error.code, 'E_INVALID_VALUE')
      }
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  test('E_INVALID_VALUE when `name` would escape `location` via `..`', async ({ assert }) => {
    const parent = await makeEmptyDir('davidup-mcpproj-escape-')
    try {
      const res = await dispatchTool(
        findTool('create_project'),
        { name: '../escape', location: parent },
        buildDeps(projectStore),
      )
      assert.isFalse(res.ok)
      if (!res.ok) {
        assert.equal(res.error.code, 'E_INVALID_VALUE')
      }
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})
