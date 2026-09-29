import { test } from '@japa/runner'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
    await libraryIndex.detachGlobal()
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

  test('attach() registers library behaviors with the engine registry (step 20.3)', async ({
    assert,
  }) => {
    const { hasBehavior, getBehaviorDescriptor, unregisterBehavior } = await import(
      'davidup/compose'
    )
    const dir = await makeProject({ withLibrary: true })
    const lib = join(dir, 'library')
    await mkdir(join(lib, 'behaviors'), { recursive: true })
    await writeFile(
      join(lib, 'behaviors', 'spec20-bounce.behavior.json'),
      JSON.stringify({
        id: 'spec20Bounce',
        name: 'Bounce',
        description: 'Library-only bouncy behavior (descriptor only).',
        params: [
          { name: 'height', type: 'number', required: false, default: 80 },
          { name: 'duration', type: 'number', required: false, default: 0.8 },
        ],
      }),
      'utf8'
    )

    const idx = new LibraryIndex({ debounceMs: 20 })
    try {
      assert.isFalse(hasBehavior('spec20Bounce'), 'starts unregistered')
      await idx.attach(lib)
      assert.isTrue(hasBehavior('spec20Bounce'), 'library behavior registered globally')
      const desc = getBehaviorDescriptor('spec20Bounce')
      assert.exists(desc)
      assert.equal(desc!.description, 'Library-only bouncy behavior (descriptor only).')
      assert.equal(desc!.params.length, 2)
      assert.equal(desc!.params[0]!.name, 'height')
      assert.equal(desc!.params[0]!.type, 'number')
      assert.equal(desc!.params[0]!.default, 80)
    } finally {
      unregisterBehavior('spec20Bounce')
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('a library behavior with a `tweens` body is executable (v1.1 S19)', async ({
    assert,
  }) => {
    const { expandBehavior, unregisterBehavior } = await import('davidup/compose')
    const dir = await makeProject({ withLibrary: true })
    const lib = join(dir, 'library')
    await mkdir(join(lib, 'behaviors'), { recursive: true })
    await writeFile(
      join(lib, 'behaviors', 'swoop.behavior.json'),
      JSON.stringify({
        id: 'librarySwoop',
        description: 'Slide in while fading up.',
        params: [{ name: 'distance', type: 'number', required: false, default: 120 }],
        tweens: [
          {
            property: 'transform.y',
            from: '${params.distance}',
            to: 0,
            easing: 'easeOutCubic',
            suffix: 'slide',
          },
          {
            property: 'transform.opacity',
            from: 0,
            to: 1,
            duration: '${$.duration * 0.5}',
            suffix: 'opacity',
          },
        ],
      }),
      'utf8'
    )

    const idx = new LibraryIndex({ debounceMs: 20 })
    try {
      await idx.attach(lib)
      const tweens = expandBehavior({
        behavior: 'librarySwoop',
        target: 'card',
        start: 2,
        duration: 1,
      })
      assert.deepEqual(
        tweens.map((t) => [t.id, t.property, t.from, t.start, t.duration]),
        [
          ['card_librarySwoop_2__slide', 'transform.y', 120, 2, 1],
          ['card_librarySwoop_2__opacity', 'transform.opacity', 0, 2, 0.5],
        ]
      )
    } finally {
      unregisterBehavior('librarySwoop')
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('dropping a shadowing library behavior restores the built-in (bug 2.1)', async ({
    assert,
  }) => {
    const { expandBehavior, getBehaviorDescriptor, unregisterBehavior } = await import(
      'davidup/compose'
    )
    const dir = await makeProject({ withLibrary: true })
    const lib = join(dir, 'library')
    await mkdir(join(lib, 'behaviors'), { recursive: true })
    const file = join(lib, 'behaviors', 'fadeIn.behavior.json')
    await writeFile(
      file,
      JSON.stringify({ id: 'fadeIn', description: 'Shadowing card.' }),
      'utf8'
    )

    const idx = new LibraryIndex({ debounceMs: 20 })
    try {
      await idx.attach(lib)
      assert.equal(getBehaviorDescriptor('fadeIn')!.description, 'Shadowing card.')

      // The watcher's reload diff unregisters the shadow when the file goes.
      await rm(file, { force: true })
      let restored = false
      for (let i = 0; i < 40; i += 1) {
        await delay(50)
        if (getBehaviorDescriptor('fadeIn')!.description !== 'Shadowing card.') {
          restored = true
          break
        }
      }
      assert.isTrue(restored, 'built-in descriptor should come back within 2s')
      const tweens = expandBehavior({
        behavior: 'fadeIn',
        target: 'logo',
        start: 0,
        duration: 1,
      })
      assert.lengthOf(tweens, 1)
      assert.equal(tweens[0]!.property, 'transform.opacity')
    } finally {
      unregisterBehavior('fadeIn')
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('attach() registers library templates with the engine registry (step 14)', async ({
    assert,
  }) => {
    const { hasTemplate, hasScene } = await import('davidup/compose')
    const dir = await makeProject({ withLibrary: true })
    const lib = join(dir, 'library')
    await mkdir(join(lib, 'templates'), { recursive: true })
    await mkdir(join(lib, 'scenes'), { recursive: true })
    await writeFile(
      join(lib, 'templates', 'spec14-card.template.json'),
      JSON.stringify({
        id: 'spec14Card',
        description: 'Card for step-14 spec',
        params: [
          { name: 'title', type: 'string', required: true },
          { name: 'color', type: 'color', default: '#ffffff' },
        ],
        items: {
          title: {
            type: 'text',
            text: '${params.title}',
            font: 'DavidupDisplay',
            fontSize: 64,
            color: '${params.color}',
            align: 'center',
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
      }),
      'utf8'
    )
    await writeFile(
      join(lib, 'scenes', 'spec14-scene.scene.json'),
      JSON.stringify({
        id: 'spec14Scene',
        duration: 2,
        params: [],
        items: { bg: { type: 'shape' } },
        tweens: [],
      }),
      'utf8'
    )

    const idx = new LibraryIndex({ debounceMs: 20 })
    try {
      await idx.attach(lib)
      assert.isTrue(hasTemplate('spec14Card'), 'library template registered globally')
      assert.isTrue(hasScene('spec14Scene'), 'library scene registered globally')
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

  test('watcher delete unregisters template/scene/behavior from engine REGISTRY (step 20.4)', async ({
    assert,
  }) => {
    const { hasTemplate, hasScene, hasBehavior } = await import('davidup/compose')
    const dir = await makeProject({ withLibrary: true })
    const lib = join(dir, 'library')
    await mkdir(join(lib, 'templates'), { recursive: true })
    await mkdir(join(lib, 'behaviors'), { recursive: true })
    await mkdir(join(lib, 'scenes'), { recursive: true })

    const tplFile = join(lib, 'templates', 'spec20-doomed.template.json')
    const behFile = join(lib, 'behaviors', 'spec20-doomed.behavior.json')
    const scnFile = join(lib, 'scenes', 'spec20-doomed.scene.json')
    await writeFile(
      tplFile,
      JSON.stringify({
        id: 'spec20DoomedTpl',
        description: 'Will be deleted',
        params: [],
        items: { bg: { type: 'shape' } },
        tweens: [],
      }),
      'utf8'
    )
    await writeFile(
      behFile,
      JSON.stringify({
        id: 'spec20DoomedBeh',
        description: 'Will be deleted',
      }),
      'utf8'
    )
    await writeFile(
      scnFile,
      JSON.stringify({
        id: 'spec20DoomedScn',
        duration: 1,
        params: [],
        items: { bg: { type: 'shape' } },
        tweens: [],
      }),
      'utf8'
    )

    const idx = new LibraryIndex({ debounceMs: 20 })
    try {
      await idx.attach(lib)
      assert.isTrue(hasTemplate('spec20DoomedTpl'), 'template registered on attach')
      assert.isTrue(hasBehavior('spec20DoomedBeh'), 'behavior registered on attach')
      assert.isTrue(hasScene('spec20DoomedScn'), 'scene registered on attach')

      await unlink(tplFile)
      await unlink(behFile)
      await unlink(scnFile)

      const deadline = Date.now() + 1500
      let gone = false
      while (Date.now() < deadline) {
        await delay(50)
        if (
          !hasTemplate('spec20DoomedTpl') &&
          !hasBehavior('spec20DoomedBeh') &&
          !hasScene('spec20DoomedScn')
        ) {
          gone = true
          break
        }
      }
      assert.isTrue(gone, 'engine REGISTRY must drop ids after watcher delete diff')

      const catalog = idx.getCatalog()
      const stillIndexed = catalog.items.some(
        (i) =>
          (i.kind === 'template' && i.id === 'spec20DoomedTpl') ||
          (i.kind === 'behavior' && i.id === 'spec20DoomedBeh') ||
          (i.kind === 'scene' && i.id === 'spec20DoomedScn')
      )
      assert.isFalse(stillIndexed, 'catalog must also reflect the deletion')
    } finally {
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('detach() drops every engine REGISTRY entry it owns (step 20.4)', async ({ assert }) => {
    const { hasTemplate, hasScene, hasBehavior } = await import('davidup/compose')
    const dir = await makeProject({ withLibrary: true })
    const lib = join(dir, 'library')
    await writeFile(
      join(lib, 'detach-me.template.json'),
      JSON.stringify({
        id: 'spec20DetachTpl',
        params: [],
        items: { bg: { type: 'shape' } },
        tweens: [],
      }),
      'utf8'
    )
    await writeFile(
      join(lib, 'detach-me.behavior.json'),
      JSON.stringify({ id: 'spec20DetachBeh', description: 'd' }),
      'utf8'
    )
    await writeFile(
      join(lib, 'detach-me.scene.json'),
      JSON.stringify({
        id: 'spec20DetachScn',
        duration: 1,
        params: [],
        items: {},
        tweens: [],
      }),
      'utf8'
    )

    const idx = new LibraryIndex({ debounceMs: 20 })
    try {
      await idx.attach(lib)
      assert.isTrue(hasTemplate('spec20DetachTpl'))
      assert.isTrue(hasBehavior('spec20DetachBeh'))
      assert.isTrue(hasScene('spec20DetachScn'))

      await idx.detach()

      assert.isFalse(hasTemplate('spec20DetachTpl'), 'template gone after detach')
      assert.isFalse(hasBehavior('spec20DetachBeh'), 'behavior gone after detach')
      assert.isFalse(hasScene('spec20DetachScn'), 'scene gone after detach')
    } finally {
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

test.group('LibraryIndex · HTTP', (group) => {
  group.each.setup(async () => {
    await libraryIndex.detach()
    await libraryIndex.detachGlobal()
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

// ─── The asset library in the panel (asset library plan E1) ───────────────

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

interface ShelfRecord {
  kind: string
  ext: string
  tags?: string[]
  licence?: string
  name?: string
  desc?: string
  credit?: string
  bytes?: Buffer
  extra?: Record<string, unknown>
}

/** One shelf as assetlib writes it: `catalogue.json` + `blobs/<sha>.<ext>`. */
async function writeShelf(root: string, records: Record<string, ShelfRecord>): Promise<void> {
  await mkdir(join(root, 'blobs'), { recursive: true })
  const catalogue: Record<string, unknown> = {}
  for (const [id, r] of Object.entries(records)) {
    const bytes = r.bytes ?? Buffer.from(`${id}-bytes`)
    await writeFile(join(root, 'blobs', `${sha256(bytes)}.${r.ext}`), bytes)
    catalogue[id] = {
      kind: r.kind,
      name: r.name ?? id,
      ...(r.desc ? { desc: r.desc } : {}),
      tags: r.tags ?? [],
      licence: r.licence ?? 'own',
      credit: r.credit ?? '',
      source: '',
      sha: sha256(bytes),
      ext: r.ext,
      bytes: bytes.length,
      ...(r.extra ?? {}),
    }
  }
  await writeFile(join(root, 'catalogue.json'), JSON.stringify(catalogue))
}

const shelfEnvBefore = { assets: process.env.DAVIDUP_ASSETS, house: process.env.DAVIDUP_HOUSE }
let shelfBase = ''

test.group('LibraryIndex · asset library (E1)', (group) => {
  group.each.setup(async () => {
    await libraryIndex.detach()
    await libraryIndex.detachGlobal()
    await projectStore.unload()
    shelfBase = await mkdtemp(join(tmpdir(), 'davidup-e1-shelves-'))
    process.env.DAVIDUP_ASSETS = join(shelfBase, 'user')
    process.env.DAVIDUP_HOUSE = join(shelfBase, 'house')
    await writeShelf(join(shelfBase, 'house'), {
      'paper-warm': { kind: 'stock', ext: 'png', tags: ['paper', 'warm'], desc: 'Warm cream paper' },
      'kraft': { kind: 'image', ext: 'png', tags: ['paper', 'brown'], licence: 'CC0', credit: 'A. Maker' },
      'teapot': { kind: 'image', ext: 'png', tags: ['met', 'object'], licence: 'CC0' },
      'fox': { kind: 'puppet', ext: 'json', tags: ['fox', 'animal'] },
      'pop': { kind: 'audio', ext: 'wav', tags: ['sfx'], extra: { sec: 0.4 } },
      'hand-face': { kind: 'font', ext: 'ttf', tags: ['handwritten'], licence: 'OFL', extra: { family: 'Hand Face' } },
    })
  })
  group.each.teardown(async () => {
    await libraryIndex.detach()
    await projectStore.unload()
    await rm(shelfBase, { recursive: true, force: true })
    for (const [key, v] of [['DAVIDUP_ASSETS', shelfEnvBefore.assets], ['DAVIDUP_HOUSE', shelfEnvBefore.house]] as const) {
      if (v === undefined) delete process.env[key]
      else process.env[key] = v
    }
  })

  test('the shelves list as asset and font items: kind, type, shelf, licence, pinned src', async ({ assert }) => {
    const dir = await makeProject({ withLibrary: true })
    const idx = new LibraryIndex({ debounceMs: 20 })
    try {
      const dot = Buffer.from('project-dot')
      await writeShelf(join(dir, 'assets'), {
        dot: { kind: 'cutout', ext: 'png', tags: ['dot'] },
        // Shadows the house's teapot.
        teapot: { kind: 'image', ext: 'png', bytes: dot },
      })
      await idx.attach(join(dir, 'library'))
      await idx.setAssetProject(dir)
      const items = idx.getCatalog().items
      const shelved = items.filter((i) => i.shelf !== undefined)
      assert.deepEqual(
        shelved.map((i) => [i.kind, i.id, i.shelf, i.assetKind, i.assetType, i.scope]),
        [
          ['asset', 'dot', 'project', 'cutout', 'image', 'project'],
          ['asset', 'kraft', 'house', 'image', 'image', 'global'],
          ['asset', 'paper-warm', 'house', 'stock', 'image', 'global'],
          ['asset', 'pop', 'house', 'audio', 'audio', 'global'],
          ['asset', 'teapot', 'project', 'image', 'image', 'project'],
          ['font', 'hand-face', 'house', 'font', 'font', 'global'],
        ]
      )
      // hdf's alone: a puppet is not a card.
      assert.notInclude(items.map((i) => i.id), 'fox')
      const teapot = shelved.find((i) => i.id === 'teapot')!
      assert.equal(teapot.url, `asset:teapot@${sha256(dot).slice(0, 12)}`)
      assert.deepEqual(teapot.shadowed, ['house'])
      const kraft = shelved.find((i) => i.id === 'kraft')!
      assert.equal(kraft.licence, 'CC0')
      assert.equal(kraft.credit, 'A. Maker')
      assert.deepEqual(kraft.tags, ['paper', 'brown'])
      assert.equal(shelved.find((i) => i.id === 'pop')!.duration, 0.4)
      assert.equal(shelved.find((i) => i.id === 'paper-warm')!.description, 'Warm cream paper')
      // index.json items stay, typed from their entries.
      assert.equal(items.find((i) => i.id === 'logo-png')?.shelf, undefined)
      assert.equal(items.find((i) => i.id === 'inter')?.assetType, 'font')
      assert.deepEqual(
        idx.getCatalog().shelves.map((s) => s.name),
        ['project', 'user', 'house']
      )
    } finally {
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('an index.json entry that only points at a listed record is listed once, as the record', async ({ assert }) => {
    const dir = await makeProject({ withLibrary: true })
    const idx = new LibraryIndex({ debounceMs: 20 })
    try {
      const index = JSON.parse(await readFile(join(dir, 'library', 'index.json'), 'utf8'))
      index.fonts.push({ id: 'hand-face', family: 'Hand Face', src: 'asset:hand-face' })
      index.assets.push({ id: 'nowhere', src: 'asset:no-such-record' })
      await writeFile(join(dir, 'library', 'index.json'), JSON.stringify(index))
      await idx.attach(join(dir, 'library'))
      const faces = idx.getCatalog().items.filter((i) => i.id === 'hand-face')
      assert.lengthOf(faces, 1)
      assert.equal(faces[0].shelf, 'house')
      // A pointer at nothing listed is kept, so its breakage shows.
      assert.include(idx.getCatalog().items.map((i) => i.id), 'nowhere')
    } finally {
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('nothing attached lists no shelves', async ({ assert }) => {
    const idx = new LibraryIndex({ debounceMs: 20 })
    await idx.detach()
    assert.lengthOf(idx.getCatalog().items, 0)
    assert.lengthOf(idx.getCatalog().shelves, 0)
  })

  test('a shelf written after attach is listed within 1s, one that did not exist included', async ({ assert }) => {
    const dir = await makeProject({ withLibrary: true })
    const idx = new LibraryIndex()
    try {
      await idx.attach(join(dir, 'library'))
      assert.notInclude(idx.getCatalog().items.map((i) => i.id), 'mine')
      // The user shelf's directory does not exist yet.
      await writeShelf(join(shelfBase, 'user'), { mine: { kind: 'image', ext: 'png' } })
      const deadline = Date.now() + 1000
      let found = false
      while (Date.now() < deadline) {
        await delay(50)
        if (idx.getCatalog().items.some((i) => i.id === 'mine' && i.shelf === 'user')) {
          found = true
          break
        }
      }
      assert.isTrue(found, 'the user shelf record should be listed within 1s')
    } finally {
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('a catalogue that cannot be read is reported; the other shelves still list', async ({ assert }) => {
    const dir = await makeProject({ withLibrary: true })
    const idx = new LibraryIndex({ debounceMs: 20 })
    try {
      await mkdir(join(shelfBase, 'user'), { recursive: true })
      await writeFile(join(shelfBase, 'user', 'catalogue.json'), '{not json')
      await idx.attach(join(dir, 'library'))
      const catalog = idx.getCatalog()
      assert.include(catalog.items.map((i) => i.id), 'kraft')
      const err = catalog.errors.find((e) => e.file.endsWith(join('user', 'catalogue.json')))
      assert.exists(err)
      assert.equal(err!.scope, 'global')
      assert.deepEqual(catalog.shelves.map((s) => s.name), ['house'])
    } finally {
      await idx.detach()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('GET /api/library ranks the shelves with assetlib and returns facets for "paper"', async ({ client, assert }) => {
    const dir = await makeProject({ withLibrary: true })
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()
      const res = await client.get('/api/library').qs({ kind: 'asset', q: 'paper' })
      res.assertStatus(200)
      const body = res.body()
      assert.deepEqual(
        body.items.map((i: { id: string }) => i.id),
        ['paper-warm', 'kraft']
      )
      assert.deepEqual(body.items[0].why, ['id: paper'])
      assert.equal(body.facetsOf, 'hits')
      assert.deepEqual(body.facets.kind, { stock: 1, image: 1 })
      assert.deepEqual(body.facets.shelf, { house: 2 })
      assert.deepEqual(body.facets.licence, { own: 1, CC0: 1 })
      assert.deepEqual(body.facets.tags, { paper: 2, warm: 1, brown: 1 })
      assert.deepEqual(body.shelves.map((s: { name: string }) => s.name), ['project', 'user', 'house'])
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('GET /api/library narrows by facet: assetKind, tag, licence, shelf', async ({ client, assert }) => {
    const dir = await makeProject({ withLibrary: true })
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()
      const ids = async (qs: Record<string, string>) =>
        (await client.get('/api/library').qs({ kind: 'asset', ...qs })).body().items.map((i: { id: string }) => i.id)
      assert.deepEqual(await ids({ assetKind: 'stock' }), ['paper-warm'])
      assert.deepEqual(await ids({ tag: 'paper,warm' }), ['paper-warm'])
      assert.deepEqual(await ids({ licence: 'CC0' }), ['kraft', 'teapot'])
      // A facet filter leaves index.json items out.
      assert.deepEqual(await ids({ shelf: 'house' }), ['kraft', 'paper-warm', 'pop', 'teapot'])
      assert.include(await ids({}), 'logo-png')
      const scoped = await client.get('/api/library').qs({ kind: 'asset', q: 'paper', scope: 'project' })
      assert.deepEqual(scoped.body().items, [])
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('a search with no hits returns the facets of what is listed', async ({ client, assert }) => {
    const dir = await makeProject({ withLibrary: true })
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()
      const body = (await client.get('/api/library').qs({ kind: 'asset', q: 'zebra' })).body()
      assert.deepEqual(body.items, [])
      assert.equal(body.facetsOf, 'all')
      // The puppet is not counted: the panel never lists it.
      assert.deepEqual(body.facets.kind, { image: 2, stock: 1, audio: 1 })
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('templates carry no facets', async ({ client, assert }) => {
    const res = await client.get('/api/library').qs({ kind: 'template' })
    assert.isNull(res.body().facets)
  })

  test('an uploaded video is typed video (the badge), an uploaded image image', async ({ client, assert }) => {
    const dir = await makeProject({ withLibrary: true })
    try {
      await client.post('/api/project').json({ directory: dir })
      const video = await readFile(resolve(import.meta.dirname, '../../../../tests/drivers/fixtures/video/small.mp4'))
      const up = await client
        .post('/api/assets')
        .file('file', video, { filename: 'clip.mp4', contentType: 'video/mp4' })
      up.assertStatus(201)
      await libraryIndex.reloadNow()
      const items = (await client.get('/api/library').qs({ kind: 'asset' })).body().items as {
        id: string
        assetType?: string
        raw?: { kind?: string; type?: string }
      }[]
      const clip = items.find((i) => i.id === sha256(video))
      assert.exists(clip)
      // The pipeline writes `kind`, not `type`; the item's type reads either.
      assert.equal(clip!.raw?.kind, 'video')
      assert.isUndefined(clip!.raw?.type)
      assert.equal(clip!.assetType, 'video')
      assert.equal(items.find((i) => i.id === 'logo-png')?.assetType, undefined)
      assert.equal(items.find((i) => i.id === 'kraft')?.assetType, 'image')
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
