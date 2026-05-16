import { test } from '@japa/runner'
import { mkdtemp, mkdir, writeFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import libraryIndex, { LibraryIndex } from '#services/library_index'
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

async function makeProject(opts: { withLibrary?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-library-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(VALID_COMP, null, 2), 'utf8')
  if (opts.withLibrary) {
    await mkdir(join(dir, 'library'), { recursive: true })
    await writeFile(
      join(dir, 'library', 'index.json'),
      JSON.stringify({
        version: '0.1',
        templates: [],
        behaviors: [],
        scenes: [],
        assets: [
          {
            id: 'logo-png',
            name: 'Logo',
            url: 'assets/logo.png',
            description: 'Brand logo',
          },
        ],
        fonts: [
          {
            id: 'inter',
            family: 'Inter',
            url: 'fonts/inter.woff2',
          },
        ],
      }),
      'utf8'
    )
  }
  return dir
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

test.group('LibraryIndex · service', (group) => {
  group.each.setup(async () => {
    await libraryIndex.detach()
    await projectStore.unload()
  })

  test('attach() reads index.json assets + fonts', async ({ assert }) => {
    const dir = await makeProject({ withLibrary: true })
    const idx = new LibraryIndex({ debounceMs: 20 })
    try {
      await idx.attach(join(dir, 'library'))
      const catalog = idx.getCatalog()
      assert.equal(catalog.root, join(dir, 'library'))
      const ids = catalog.items.map((i) => `${i.kind}:${i.id}`).sort()
      assert.includeMembers(ids, ['asset:logo-png', 'font:inter'])
      assert.equal(catalog.errors.length, 0)
    } finally {
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('attach() reads *.{template,behavior,scene}.json files', async ({ assert }) => {
    const dir = await makeProject({ withLibrary: true })
    const lib = join(dir, 'library')
    await mkdir(join(lib, 'templates'), { recursive: true })
    await mkdir(join(lib, 'behaviors'), { recursive: true })
    await mkdir(join(lib, 'scenes'), { recursive: true })
    await writeFile(
      join(lib, 'templates', 'badge.template.json'),
      JSON.stringify({
        id: 'badge',
        description: 'Pill badge',
        params: [{ name: 'label', type: 'string', required: true }],
        items: { bg: { type: 'shape' } },
      }),
      'utf8'
    )
    await writeFile(
      join(lib, 'behaviors', 'fade-in.behavior.json'),
      JSON.stringify({
        id: 'fade-in',
        name: 'Fade in',
        description: 'Linear fade from 0 to 1',
      }),
      'utf8'
    )
    await writeFile(
      join(lib, 'scenes', 'title.scene.json'),
      JSON.stringify({
        id: 'title',
        duration: 4,
        params: [],
        items: { bg: { type: 'shape' }, label: { type: 'text' } },
        tweens: [],
      }),
      'utf8'
    )

    const idx = new LibraryIndex({ debounceMs: 20 })
    try {
      await idx.attach(lib)
      const items = idx.getCatalog().items
      const tpl = items.find((i) => i.kind === 'template' && i.id === 'badge')
      const beh = items.find((i) => i.kind === 'behavior' && i.id === 'fade-in')
      const scn = items.find((i) => i.kind === 'scene' && i.id === 'title')
      assert.exists(tpl)
      assert.equal(tpl!.source, 'templates/badge.template.json')
      assert.deepInclude(tpl!.params, { name: 'label', type: 'string', required: true })
      assert.equal(tpl!.emits?.[0], 'bg')
      assert.exists(beh)
      assert.equal(beh!.description, 'Linear fade from 0 to 1')
      assert.exists(scn)
      assert.equal(scn!.duration, 4)
      assert.includeMembers(scn!.emits ?? [], ['bg', 'label'])
    } finally {
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('search() filters by kind and substring', async ({ assert }) => {
    const dir = await makeProject({ withLibrary: true })
    const lib = join(dir, 'library')
    await writeFile(
      join(lib, 'pill.template.json'),
      JSON.stringify({ id: 'pill', description: 'A pill', items: {} }),
      'utf8'
    )
    await writeFile(
      join(lib, 'bounce.behavior.json'),
      JSON.stringify({ id: 'bounce', description: 'Bouncy' }),
      'utf8'
    )

    const idx = new LibraryIndex({ debounceMs: 20 })
    try {
      await idx.attach(lib)
      assert.equal(idx.search({ kind: 'template' }).length, 1)
      assert.equal(idx.search({ kind: 'behavior' }).length, 1)
      assert.equal(idx.search({ q: 'pill' })[0]?.id, 'pill')
      assert.equal(idx.search({ q: 'bouncy' })[0]?.id, 'bounce')
      assert.equal(idx.search({ q: 'logo', kind: 'asset' })[0]?.id, 'logo-png')
      assert.equal(idx.search({ q: 'nothing-matches' }).length, 0)
    } finally {
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('catalog updates within 1s after a file edit', async ({ assert }) => {
    const dir = await makeProject({ withLibrary: true })
    const lib = join(dir, 'library')
    const idx = new LibraryIndex({ debounceMs: 30 })
    try {
      await idx.attach(lib)
      assert.equal(idx.getCatalog().items.filter((i) => i.kind === 'template').length, 0)

      // Write a new template file; expect catalog to reflect it within 1s.
      await writeFile(
        join(lib, 'card.template.json'),
        JSON.stringify({ id: 'card', items: { bg: { type: 'shape' } } }),
        'utf8'
      )

      const deadline = Date.now() + 1000
      let found = false
      while (Date.now() < deadline) {
        await delay(50)
        if (idx.getCatalog().items.some((i) => i.kind === 'template' && i.id === 'card')) {
          found = true
          break
        }
      }
      assert.isTrue(found, 'catalog should include the new template within 1s')
    } finally {
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('catalog updates when index.json is rewritten', async ({ assert }) => {
    const dir = await makeProject({ withLibrary: true })
    const lib = join(dir, 'library')
    const idx = new LibraryIndex({ debounceMs: 30 })
    try {
      await idx.attach(lib)
      assert.isUndefined(idx.getCatalog().items.find((i) => i.id === 'new-asset'))

      await writeFile(
        join(lib, 'index.json'),
        JSON.stringify({
          assets: [{ id: 'new-asset', url: 'a.png' }],
          fonts: [],
        }),
        'utf8'
      )

      const deadline = Date.now() + 1000
      let found = false
      while (Date.now() < deadline) {
        await delay(50)
        if (idx.getCatalog().items.some((i) => i.id === 'new-asset')) {
          found = true
          break
        }
      }
      assert.isTrue(found, 'catalog should reflect rewritten index.json within 1s')
    } finally {
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('catalog updates when a definition file is deleted', async ({ assert }) => {
    const dir = await makeProject({ withLibrary: true })
    const lib = join(dir, 'library')
    const file = join(lib, 'doomed.template.json')
    await writeFile(file, JSON.stringify({ id: 'doomed', items: {} }), 'utf8')

    const idx = new LibraryIndex({ debounceMs: 30 })
    try {
      await idx.attach(lib)
      assert.exists(idx.getCatalog().items.find((i) => i.id === 'doomed'))

      await unlink(file)

      const deadline = Date.now() + 1000
      let gone = false
      while (Date.now() < deadline) {
        await delay(50)
        if (!idx.getCatalog().items.some((i) => i.id === 'doomed')) {
          gone = true
          break
        }
      }
      assert.isTrue(gone, 'catalog should drop the deleted template within 1s')
    } finally {
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('malformed JSON is recorded as an error, not thrown', async ({ assert }) => {
    const dir = await makeProject({ withLibrary: true })
    const lib = join(dir, 'library')
    await writeFile(join(lib, 'broken.template.json'), '{not json', 'utf8')

    const idx = new LibraryIndex({ debounceMs: 20 })
    try {
      await idx.attach(lib)
      const cat = idx.getCatalog()
      assert.isAtLeast(cat.errors.length, 1)
      assert.equal(cat.errors[0].file, 'broken.template.json')
    } finally {
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('attach() to a missing directory yields an empty catalog without throwing', async ({
    assert,
  }) => {
    const idx = new LibraryIndex({ debounceMs: 20 })
    const missing = join(tmpdir(), `davidup-no-lib-${Date.now()}`)
    try {
      const catalog = await idx.attach(missing)
      assert.isNull(catalog.root)
      assert.equal(catalog.items.length, 0)
      assert.isFalse(idx.isAttached)
    } finally {
      await idx.detach()
    }
  })
})

test.group('LibraryIndex · HTTP', (group) => {
  group.each.setup(async () => {
    await libraryIndex.detach()
    await projectStore.unload()
  })

  test('GET /api/library on an empty/unattached state returns 200 with no items', async ({
    client,
    assert,
  }) => {
    const res = await client.get('/api/library')
    res.assertStatus(200)
    const body = res.body()
    assert.equal(body.attached, false)
    assert.equal(body.items.length, 0)
    assert.equal(body.total, 0)
  })

  test('GET /api/library after a project load returns its catalog', async ({ client, assert }) => {
    const dir = await makeProject({ withLibrary: true })
    const lib = join(dir, 'library')
    await writeFile(
      join(lib, 'badge.template.json'),
      JSON.stringify({ id: 'badge', description: 'Pill', items: { bg: {} } }),
      'utf8'
    )
    try {
      const loadRes = await client.post('/api/project').json({ directory: dir })
      loadRes.assertStatus(200)

      await libraryIndex.flush()

      const res = await client.get('/api/library')
      res.assertStatus(200)
      const body = res.body()
      assert.equal(body.attached, true)
      assert.equal(body.projectRoot, dir)
      const ids = body.items.map((i: { id: string }) => i.id)
      assert.include(ids, 'badge')
      assert.include(ids, 'logo-png')
      assert.include(ids, 'inter')
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('GET /api/library?kind=template filters by kind', async ({ client, assert }) => {
    const dir = await makeProject({ withLibrary: true })
    const lib = join(dir, 'library')
    await writeFile(
      join(lib, 'badge.template.json'),
      JSON.stringify({ id: 'badge', items: { bg: {} } }),
      'utf8'
    )
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()

      const res = await client.get('/api/library').qs({ kind: 'template' })
      res.assertStatus(200)
      const body = res.body()
      assert.equal(body.query.kind, 'template')
      assert.isAtLeast(body.items.length, 1)
      assert.isTrue(body.items.every((i: { kind: string }) => i.kind === 'template'))
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('GET /api/library?q= filters by substring', async ({ client, assert }) => {
    const dir = await makeProject({ withLibrary: true })
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()

      const res = await client.get('/api/library').qs({ q: 'logo' })
      res.assertStatus(200)
      const body = res.body()
      assert.isAtLeast(body.items.length, 1)
      assert.equal(body.items[0].id, 'logo-png')
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('GET /api/library rejects unknown kind with 400', async ({ client }) => {
    const res = await client.get('/api/library').qs({ kind: 'banana' })
    res.assertStatus(400)
    res.assertBodyContains({ error: { code: 'E_BAD_REQUEST' } })
  })

  test('GET /api/library reflects a live file edit within 1s', async ({ client, assert }) => {
    const dir = await makeProject({ withLibrary: true })
    const lib = join(dir, 'library')
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()

      await writeFile(
        join(lib, 'live.template.json'),
        JSON.stringify({ id: 'live-tpl', items: { bg: {} } }),
        'utf8'
      )

      const deadline = Date.now() + 1500
      let found = false
      while (Date.now() < deadline) {
        await delay(75)
        const res = await client.get('/api/library').qs({ q: 'live-tpl' })
        const body = res.body()
        if (body.items.length > 0) {
          found = true
          break
        }
      }
      assert.isTrue(found, '/api/library should pick up the new template within 1s')
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
