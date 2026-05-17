import { test } from '@japa/runner'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import projectStore from '#services/project_store'
import recents from '#services/recents'

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

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-crud-proj-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(VALID_COMP, null, 2), 'utf8')
  return dir
}

async function makeEmptyDir(prefix = 'davidup-crud-empty-') {
  return mkdtemp(join(tmpdir(), prefix))
}

async function freshRecentsPath() {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-crud-recents-'))
  const path = join(dir, 'recents.json')
  recents.setPath(path)
  return { dir, path }
}

test.group('Projects CRUD · GET /api/projects/recent', (group) => {
  let stateDir: string

  group.each.setup(async () => {
    await projectStore.unload()
    stateDir = (await freshRecentsPath()).dir
  })

  group.each.teardown(async () => {
    await projectStore.unload()
    recents.setPath(null)
    await rm(stateDir, { recursive: true, force: true })
  })

  test('returns 200 + empty list when recents.json does not exist', async ({ client }) => {
    const res = await client.get('/api/projects/recent')
    res.assertStatus(200)
    res.assertBodyContains({ projects: [] })
  })

  test('returns entries sorted newest first', async ({ client, assert }) => {
    const a = await makeProject()
    const b = await makeProject()
    try {
      await recents.touch(a)
      await new Promise((r) => setTimeout(r, 10))
      await recents.touch(b)
      const res = await client.get('/api/projects/recent')
      res.assertStatus(200)
      const body = res.body() as { projects: { path: string }[] }
      assert.equal(body.projects.length, 2)
      assert.equal(body.projects[0].path, b)
      assert.equal(body.projects[1].path, a)
    } finally {
      await rm(a, { recursive: true, force: true })
      await rm(b, { recursive: true, force: true })
    }
  })

  test('prunes entries whose directory no longer exists', async ({ client, assert }) => {
    const alive = await makeProject()
    const dead = await makeProject()
    try {
      await recents.touch(alive)
      await recents.touch(dead)
      await rm(dead, { recursive: true, force: true })

      const res = await client.get('/api/projects/recent')
      res.assertStatus(200)
      const body = res.body() as { projects: { path: string }[] }
      assert.equal(body.projects.length, 1)
      assert.equal(body.projects[0].path, alive)
    } finally {
      await rm(alive, { recursive: true, force: true })
    }
  })
})

test.group('Projects CRUD · POST /api/projects', (group) => {
  let stateDir: string

  group.each.setup(async () => {
    await projectStore.unload()
    stateDir = (await freshRecentsPath()).dir
  })

  group.each.teardown(async () => {
    await projectStore.unload()
    recents.setPath(null)
    await rm(stateDir, { recursive: true, force: true })
  })

  test('scaffolds a new project and loads it (201)', async ({ client, assert }) => {
    const parent = await makeEmptyDir('davidup-crud-store-')
    const target = join(parent, 'my-clip')
    try {
      const res = await client.post('/api/projects').json({ directory: target })
      res.assertStatus(201)
      const body = res.body() as {
        root: string
        compositionPath: string
        composition: { version: string }
      }
      assert.equal(body.root, target)
      assert.equal(body.compositionPath, join(target, 'composition.json'))
      assert.equal(body.composition.version, '0.1')

      // Project is now the current in-memory composition.
      assert.isTrue(projectStore.isLoaded)
      assert.equal(projectStore.project!.root, target)

      // The scaffolded composition.json exists and validates.
      const raw = await readFile(join(target, 'composition.json'), 'utf8')
      assert.doesNotThrow(() => JSON.parse(raw))

      // Recents was bumped on load.
      const recentList = await recents.list()
      assert.equal(recentList[0].path, target)
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  test('400 when body.directory is missing', async ({ client }) => {
    const res = await client.post('/api/projects').json({})
    res.assertStatus(400)
    res.assertBodyContains({ error: { code: 'E_BAD_REQUEST' } })
  })

  test('409 when target directory is non-empty', async ({ client }) => {
    const target = await makeEmptyDir('davidup-crud-nonempty-')
    await writeFile(join(target, 'stray.txt'), 'do not overwrite me', 'utf8')
    try {
      const res = await client.post('/api/projects').json({ directory: target })
      res.assertStatus(409)
      res.assertBodyContains({ error: { code: 'E_TARGET_NOT_EMPTY' } })
    } finally {
      await rm(target, { recursive: true, force: true })
    }
  })

  test('404 when template is unknown', async ({ client }) => {
    const parent = await makeEmptyDir('davidup-crud-badtpl-')
    const target = join(parent, 'p')
    try {
      const res = await client
        .post('/api/projects')
        .json({ directory: target, template: 'no-such-template' })
      res.assertStatus(404)
      res.assertBodyContains({ error: { code: 'E_TEMPLATE_NOT_FOUND' } })
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  test('honours optional `name` for the recents entry label', async ({ client, assert }) => {
    const parent = await makeEmptyDir('davidup-crud-name-')
    const target = join(parent, 'clip')
    try {
      const res = await client
        .post('/api/projects')
        .json({ directory: target, name: 'Pitch Reel' })
      res.assertStatus(201)
      const list = await recents.list()
      assert.equal(list[0].path, target)
      assert.equal(list[0].name, 'Pitch Reel')
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  test('omitting `name` falls back to directory basename', async ({ client, assert }) => {
    const parent = await makeEmptyDir('davidup-crud-noname-')
    const target = join(parent, 'auto-named')
    try {
      const res = await client.post('/api/projects').json({ directory: target })
      res.assertStatus(201)
      const list = await recents.list()
      assert.equal(list[0].name, basename(target))
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})

test.group('Projects CRUD · DELETE /api/projects/recent/:idx', (group) => {
  let stateDir: string

  group.each.setup(async () => {
    await projectStore.unload()
    stateDir = (await freshRecentsPath()).dir
  })

  group.each.teardown(async () => {
    await projectStore.unload()
    recents.setPath(null)
    await rm(stateDir, { recursive: true, force: true })
  })

  test('forgets the entry at the given index and returns the new list', async ({
    client,
    assert,
  }) => {
    const a = await makeProject()
    const b = await makeProject()
    const c = await makeProject()
    try {
      await recents.touch(a)
      await new Promise((r) => setTimeout(r, 5))
      await recents.touch(b)
      await new Promise((r) => setTimeout(r, 5))
      await recents.touch(c)
      // Sorted newest first: [c, b, a]. Drop index 1 (b).
      const res = await client.delete('/api/projects/recent/1')
      res.assertStatus(200)
      const body = res.body() as { projects: { path: string }[] }
      assert.deepEqual(
        body.projects.map((p) => p.path),
        [c, a],
      )

      // Project directory was NOT deleted from disk.
      const stillThere = await readFile(join(b, 'composition.json'), 'utf8')
      assert.isString(stillThere)
    } finally {
      await rm(a, { recursive: true, force: true })
      await rm(b, { recursive: true, force: true })
      await rm(c, { recursive: true, force: true })
    }
  })

  test('404 when index is out of range', async ({ client }) => {
    const a = await makeProject()
    try {
      await recents.touch(a)
      const res = await client.delete('/api/projects/recent/5')
      res.assertStatus(404)
      res.assertBodyContains({ error: { code: 'E_RECENT_NOT_FOUND' } })
    } finally {
      await rm(a, { recursive: true, force: true })
    }
  })

  test('400 when index is not a non-negative integer', async ({ client }) => {
    for (const bad of ['abc', '-1', '1.5']) {
      const res = await client.delete(`/api/projects/recent/${bad}`)
      res.assertStatus(400)
      res.assertBodyContains({ error: { code: 'E_BAD_REQUEST' } })
    }
  })
})
