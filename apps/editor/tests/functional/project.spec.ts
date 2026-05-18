import { test } from '@japa/runner'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import projectStore, { ProjectStore } from '#services/project_store'

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

async function makeProject(opts: {
  composition?: unknown
  rawComposition?: string
  withLibrary?: boolean
  withAssets?: boolean
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-project-'))
  const raw = opts.rawComposition ?? JSON.stringify(opts.composition ?? VALID_COMP, null, 2)
  await writeFile(join(dir, 'composition.json'), raw, 'utf8')
  if (opts.withLibrary) {
    await mkdir(join(dir, 'library'), { recursive: true })
    await writeFile(join(dir, 'library', 'index.json'), JSON.stringify({ items: [] }), 'utf8')
  }
  if (opts.withAssets) {
    await mkdir(join(dir, 'assets'), { recursive: true })
  }
  return dir
}

test.group('Project loader · service', (group) => {
  group.each.setup(async () => {
    await projectStore.unload()
  })

  test('load() populates in-memory composition and detects optional library/assets', async ({
    assert,
  }) => {
    const dir = await makeProject({ withLibrary: true, withAssets: true })
    try {
      const loaded = await projectStore.load(dir)
      assert.equal(loaded.root, dir)
      assert.equal(loaded.compositionPath, join(dir, 'composition.json'))
      assert.equal(loaded.libraryIndexPath, join(dir, 'library', 'index.json'))
      assert.equal(loaded.assetsDir, join(dir, 'assets'))
      assert.deepEqual(projectStore.composition, VALID_COMP)
      assert.isTrue(projectStore.isLoaded)
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('load() leaves library/assets null when absent', async ({ assert }) => {
    const dir = await makeProject()
    try {
      const loaded = await projectStore.load(dir)
      assert.isNull(loaded.libraryIndexPath)
      assert.isNull(loaded.assetsDir)
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('load() rejects a missing directory', async ({ assert }) => {
    const missing = join(tmpdir(), `davidup-nope-${Date.now()}`)
    await assert.rejects(() => projectStore.load(missing), /Project directory not found/)
    assert.isFalse(projectStore.isLoaded)
  })

  test('load() rejects a directory without composition.json', async ({ assert }) => {
    const dir = await mkdtemp(join(tmpdir(), 'davidup-empty-'))
    try {
      await assert.rejects(() => projectStore.load(dir), /Missing composition.json/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('load() rejects malformed JSON', async ({ assert }) => {
    const dir = await makeProject({ rawComposition: '{ not valid json' })
    try {
      await assert.rejects(() => projectStore.load(dir), /not valid JSON/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('load() rejects a composition that fails schema validation', async ({ assert }) => {
    const bad = { ...VALID_COMP, version: undefined }
    const dir = await makeProject({ composition: bad })
    try {
      await assert.rejects(() => projectStore.load(dir), /failed validation/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('update() schedules a debounced write that persists to disk', async ({ assert }) => {
    const dir = await mkdtemp(join(tmpdir(), 'davidup-debounce-'))
    const compPath = join(dir, 'composition.json')
    await writeFile(compPath, JSON.stringify(VALID_COMP, null, 2), 'utf8')

    // Isolated store with a short debounce so this test stays fast.
    const store = new ProjectStore({ debounceMs: 25 })
    try {
      await store.load(dir)
      const mutated = {
        ...VALID_COMP,
        composition: { ...VALID_COMP.composition, duration: 4.5 },
      }
      store.update(mutated)

      // Right after update(), disk still has the original (write is debounced).
      const beforeFlush = JSON.parse(await readFile(compPath, 'utf8'))
      assert.equal(beforeFlush.composition.duration, 3)

      await store.flush()

      const afterFlush = JSON.parse(await readFile(compPath, 'utf8'))
      assert.equal(afterFlush.composition.duration, 4.5)
    } finally {
      await store.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('update() coalesces rapid edits into one disk write', async ({ assert }) => {
    const dir = await mkdtemp(join(tmpdir(), 'davidup-coalesce-'))
    const compPath = join(dir, 'composition.json')
    await writeFile(compPath, JSON.stringify(VALID_COMP, null, 2), 'utf8')

    const store = new ProjectStore({ debounceMs: 30 })
    try {
      await store.load(dir)
      for (let i = 0; i < 5; i += 1) {
        store.update({
          ...VALID_COMP,
          composition: { ...VALID_COMP.composition, duration: 3 + i },
        })
      }
      await store.flush()

      const persisted = JSON.parse(await readFile(compPath, 'utf8'))
      assert.equal(persisted.composition.duration, 7) // 3 + 4 (last update)
    } finally {
      await store.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('update() throws when no project is loaded', async ({ assert }) => {
    const store = new ProjectStore()
    assert.throws(() => store.update(VALID_COMP), /No project loaded/)
  })

  test('load() captures a defaults snapshot that survives update()', async ({ assert }) => {
    // Polish_plan 20.25: the Inspector's override dot must compare against
    // the post-precompile expansion, not a session-start clone. The store
    // freezes that snapshot at load time and keeps it stable across edits.
    const dir = await mkdtemp(join(tmpdir(), 'davidup-defaults-'))
    const compPath = join(dir, 'composition.json')
    await writeFile(compPath, JSON.stringify(VALID_COMP, null, 2), 'utf8')
    const store = new ProjectStore({ debounceMs: 10 })
    try {
      const loaded = await store.load(dir)
      // The snapshot equals the precompiled composition at load time …
      assert.deepEqual(loaded.defaults, VALID_COMP)

      // … and stays equal after a mutation routes through update().
      const mutated = {
        ...VALID_COMP,
        items: {
          ...VALID_COMP.items,
          logo: {
            ...VALID_COMP.items.logo,
            transform: { ...VALID_COMP.items.logo.transform, opacity: 0.25 },
          },
        },
      }
      store.update(mutated)
      const after = store.project!
      assert.equal(
        (after.composition as { items: { logo: { transform: { opacity: number } } } }).items.logo
          .transform.opacity,
        0.25,
        'composition should reflect the edit',
      )
      assert.equal(
        (after.defaults as { items: { logo: { transform: { opacity: number } } } }).items.logo
          .transform.opacity,
        1,
        'defaults snapshot must remain at the precompile-time value',
      )
    } finally {
      await store.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('load() defaults captures template-expanded values, not authoring form', async ({
    assert,
  }) => {
    // The whole point of using the precompile output as "defaults": when the
    // source carries authoring-form constructs (here a `type: "scene"`
    // instance), the snapshot reflects what the user actually sees on
    // stage — wrapper group, prefixed sub-items, params substituted —
    // not the raw JSON.
    const authoring = {
      version: '0.4',
      composition: {
        width: 640,
        height: 360,
        fps: 30,
        duration: 4,
        background: '#000000',
      },
      assets: [],
      scenes: {
        card: {
          id: 'card',
          size: { width: 640, height: 360 },
          duration: 4,
          params: [],
          items: {
            bg: {
              type: 'shape',
              kind: 'rect',
              width: 640,
              height: 360,
              fillColor: '#112233',
              transform: {
                x: 0,
                y: 0,
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
                anchorX: 0,
                anchorY: 0,
                opacity: 1,
              },
            },
          },
          tweens: [],
        },
      },
      layers: [{ id: 'stage', z: 0, opacity: 1, blendMode: 'normal', items: ['intro'] }],
      items: {
        intro: {
          type: 'scene',
          scene: 'card',
          transform: {
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            anchorX: 0,
            anchorY: 0,
            opacity: 1,
          },
        },
      },
      tweens: [],
    }
    const dir = await makeProject({ composition: authoring })
    try {
      const loaded = await projectStore.load(dir)
      const defaults = loaded.defaults as {
        items: Record<string, { type: string; fillColor?: string }>
      }
      // The scene instance has been lowered to a wrapper group + prefixed
      // child. Both forms exist in the resolved comp.
      assert.equal(defaults.items.intro?.type, 'group')
      assert.equal(defaults.items.intro__bg?.type, 'shape')
      assert.equal(defaults.items.intro__bg?.fillColor, '#112233')
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('load() lowers authoring-form scene instances before validating', async ({ assert }) => {
    const authoring = {
      version: '0.4',
      composition: {
        width: 640,
        height: 360,
        fps: 30,
        duration: 4,
        background: '#000000',
      },
      assets: [],
      scenes: {
        card: {
          id: 'card',
          size: { width: 640, height: 360 },
          duration: 4,
          params: [],
          items: {
            bg: {
              type: 'shape',
              kind: 'rect',
              width: 640,
              height: 360,
              fillColor: '#112233',
              transform: {
                x: 0,
                y: 0,
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
                anchorX: 0,
                anchorY: 0,
                opacity: 1,
              },
            },
          },
          tweens: [],
        },
      },
      layers: [{ id: 'stage', z: 0, opacity: 1, blendMode: 'normal', items: ['intro'] }],
      items: {
        intro: {
          type: 'scene',
          scene: 'card',
          transform: {
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            anchorX: 0,
            anchorY: 0,
            opacity: 1,
          },
        },
      },
      tweens: [],
    }
    const dir = await makeProject({ composition: authoring })
    try {
      await projectStore.load(dir)
      const loaded = projectStore.composition as { items: Record<string, { type: string }> }
      // After precompile, `type: "scene"` has been lowered to a wrapper group;
      // the validator only accepts sprite|text|shape|group, so a green load
      // implies the lowering happened.
      assert.equal(loaded.items.intro?.type, 'group')
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

test.group('Project loader · HTTP', (group) => {
  group.each.setup(async () => {
    await projectStore.unload()
  })

  test('GET /api/project returns 404 when no project is loaded', async ({ client }) => {
    const response = await client.get('/api/project')
    response.assertStatus(404)
    response.assertBodyContains({ error: { code: 'E_NO_PROJECT' } })
  })

  test('POST /api/project then GET returns the loaded composition', async ({ client, assert }) => {
    const dir = await makeProject({ withLibrary: true, withAssets: true })
    try {
      const loadRes = await client.post('/api/project').json({ directory: dir })
      loadRes.assertStatus(200)
      loadRes.assertBodyContains({
        root: dir,
        composition: { version: '0.1' },
      })
      const body = loadRes.body()
      assert.equal(body.libraryIndexPath, join(dir, 'library', 'index.json'))
      assert.equal(body.assetsDir, join(dir, 'assets'))

      const getRes = await client.get('/api/project')
      getRes.assertStatus(200)
      getRes.assertBodyContains({ root: dir, composition: VALID_COMP })
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('POST /api/project with missing directory body returns 400', async ({ client }) => {
    const res = await client.post('/api/project').json({})
    res.assertStatus(400)
    res.assertBodyContains({ error: { code: 'E_BAD_REQUEST' } })
  })

  test('POST /api/project with non-existent directory returns 404', async ({ client }) => {
    const missing = join(tmpdir(), `davidup-missing-${Date.now()}`)
    const res = await client.post('/api/project').json({ directory: missing })
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'E_PROJECT_NOT_FOUND' } })
  })

  test('POST /api/project with invalid composition returns 422', async ({ client }) => {
    const dir = await makeProject({ composition: { ...VALID_COMP, version: undefined } })
    try {
      const res = await client.post('/api/project').json({ directory: dir })
      res.assertStatus(422)
      res.assertBodyContains({ error: { code: 'E_COMPOSITION_INVALID' } })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
