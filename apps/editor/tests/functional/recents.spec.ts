import { test } from '@japa/runner'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { RecentsStore } from '#services/recents'
import recentsSingleton from '#services/recents'
import projectStore from '#services/project_store'

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

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-recents-'))
  const path = join(dir, 'recents.json')
  return { dir, path, store: new RecentsStore({ path }) }
}

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-recents-proj-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(VALID_COMP, null, 2), 'utf8')
  return dir
}

async function makeBareDir() {
  return mkdtemp(join(tmpdir(), 'davidup-recents-bare-'))
}

test.group('RecentsStore · service', () => {
  test('list() returns empty when recents.json does not exist', async ({ assert }) => {
    const { dir, store } = await makeStore()
    try {
      assert.deepEqual(await store.list(), [])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('touch() persists an entry with name + timestamps', async ({ assert }) => {
    const { dir, path, store } = await makeStore()
    const projDir = await makeProject()
    try {
      const before = Date.now()
      const after = await store.touch(projDir)
      assert.equal(after.length, 1)
      assert.equal(after[0].path, projDir)
      assert.equal(after[0].name, basename(projDir))
      assert.isAtLeast(after[0].lastOpenedAt, before)

      const onDisk = JSON.parse(await readFile(path, 'utf8'))
      assert.equal(onDisk.projects.length, 1)
      assert.equal(onDisk.projects[0].path, projDir)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(projDir, { recursive: true, force: true })
    }
  })

  test('touch() upserts: re-touching the same path keeps one entry and bumps the timestamp', async ({
    assert,
  }) => {
    const { dir, store } = await makeStore()
    const projDir = await makeProject()
    try {
      const first = await store.touch(projDir)
      const t1 = first[0].lastOpenedAt
      await new Promise((r) => setTimeout(r, 10))
      const second = await store.touch(projDir)
      assert.equal(second.length, 1)
      assert.isAbove(second[0].lastOpenedAt, t1)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(projDir, { recursive: true, force: true })
    }
  })

  test('list() returns entries sorted by lastOpenedAt desc', async ({ assert }) => {
    const { dir, store } = await makeStore()
    const a = await makeProject()
    const b = await makeProject()
    const c = await makeProject()
    try {
      await store.touch(a)
      await new Promise((r) => setTimeout(r, 5))
      await store.touch(b)
      await new Promise((r) => setTimeout(r, 5))
      await store.touch(c)
      const list = await store.list()
      assert.deepEqual(
        list.map((e) => e.path),
        [c, b, a],
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(a, { recursive: true, force: true })
      await rm(b, { recursive: true, force: true })
      await rm(c, { recursive: true, force: true })
    }
  })

  test('list() prunes entries whose path no longer exists', async ({ assert }) => {
    const { dir, store } = await makeStore()
    const alive = await makeProject()
    const dead = await makeProject()
    try {
      await store.touch(alive)
      await store.touch(dead)
      await rm(dead, { recursive: true, force: true })

      const list = await store.list()
      assert.equal(list.length, 1)
      assert.equal(list[0].path, alive)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(alive, { recursive: true, force: true })
    }
  })

  test('touch() prunes missing entries on write', async ({ assert }) => {
    const { dir, path, store } = await makeStore()
    const alive = await makeProject()
    const dead = await makeProject()
    const other = await makeProject()
    try {
      await store.touch(dead)
      await store.touch(alive)
      await rm(dead, { recursive: true, force: true })
      await store.touch(other)

      const onDisk = JSON.parse(await readFile(path, 'utf8'))
      const paths = onDisk.projects.map((p: { path: string }) => p.path)
      assert.notInclude(paths, dead)
      assert.includeMembers(paths, [alive, other])
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(alive, { recursive: true, force: true })
      await rm(other, { recursive: true, force: true })
    }
  })

  test('touch() records composition.json mtime as lastModifiedAt', async ({ assert }) => {
    const { dir, store } = await makeStore()
    const projDir = await makeProject()
    try {
      const mtime = (await stat(join(projDir, 'composition.json'))).mtimeMs
      const list = await store.touch(projDir)
      assert.equal(list[0].lastModifiedAt, mtime)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(projDir, { recursive: true, force: true })
    }
  })

  test('touch() falls back to now for lastModifiedAt when composition.json is absent', async ({
    assert,
  }) => {
    const { dir, store } = await makeStore()
    const projDir = await makeBareDir()
    try {
      const before = Date.now()
      const list = await store.touch(projDir)
      assert.isAtLeast(list[0].lastModifiedAt, before)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(projDir, { recursive: true, force: true })
    }
  })

  test('touch() honours an explicit name override', async ({ assert }) => {
    const { dir, store } = await makeStore()
    const projDir = await makeProject()
    try {
      const list = await store.touch(projDir, 'My Project')
      assert.equal(list[0].name, 'My Project')
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(projDir, { recursive: true, force: true })
    }
  })

  test('survives a malformed recents.json by returning empty', async ({ assert }) => {
    const { dir, path, store } = await makeStore()
    try {
      await writeFile(path, '{not json', 'utf8')
      assert.deepEqual(await store.list(), [])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('drops malformed entries from a partially-valid recents.json', async ({ assert }) => {
    const { dir, path, store } = await makeStore()
    const alive = await makeProject()
    try {
      await writeFile(
        path,
        JSON.stringify({
          projects: [
            { path: alive, name: 'ok', lastOpenedAt: 1, lastModifiedAt: 1 },
            { name: 'no path' },
            'not an object',
            { path: 42 },
          ],
        }),
        'utf8',
      )
      const list = await store.list()
      assert.equal(list.length, 1)
      assert.equal(list[0].path, alive)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(alive, { recursive: true, force: true })
    }
  })
})

test.group('Recents · projectStore.load() integration', (group) => {
  let stateDir: string

  group.each.setup(async () => {
    await projectStore.unload()
    stateDir = await mkdtemp(join(tmpdir(), 'davidup-recents-load-'))
    recentsSingleton.setPath(join(stateDir, 'recents.json'))
  })

  group.each.teardown(async () => {
    await projectStore.unload()
    recentsSingleton.setPath(null)
    await rm(stateDir, { recursive: true, force: true })
  })

  test('projectStore.load() bumps lastOpenedAt for the loaded project', async ({ assert }) => {
    const projDir = await makeProject()
    try {
      const before = Date.now()
      await projectStore.load(projDir)
      const list = await recentsSingleton.list()
      assert.equal(list.length, 1)
      assert.equal(list[0].path, projDir)
      assert.isAtLeast(list[0].lastOpenedAt, before)
    } finally {
      await rm(projDir, { recursive: true, force: true })
    }
  })

  test('two consecutive loads keep one entry per project and surface the newest first', async ({
    assert,
  }) => {
    const a = await makeProject()
    const b = await makeProject()
    try {
      await projectStore.load(a)
      await projectStore.load(b)
      const list = await recentsSingleton.list()
      assert.equal(list.length, 2)
      assert.equal(list[0].path, b)
      assert.equal(list[1].path, a)
    } finally {
      await rm(a, { recursive: true, force: true })
      await rm(b, { recursive: true, force: true })
    }
  })

  test('load() does not write a recents entry on a failed load', async ({ assert }) => {
    const missing = join(tmpdir(), `davidup-recents-missing-${Date.now()}`)
    await assert.rejects(() => projectStore.load(missing), /Project directory not found/)
    const list = await recentsSingleton.list()
    assert.equal(list.length, 0)
  })
})
