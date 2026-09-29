// Functional tests for the library drag-drop flow — step 14.
//
// Exercises the full path the editor takes when a user drops a library
// card on a track / stage:
//
//   1. ProjectStore loads a project that has a `library/` subtree.
//   2. LibraryIndex auto-registers templates + scenes into the engine
//      registry (the step 8 piece of the plan).
//   3. The composable's command builder produces an `apply_template`
//      command.
//   4. CommandBus.apply runs it through the engine and returns a new
//      composition that includes the expanded items + tweens.
//
// This is the precise sequence the live UI runs on every drop, minus the
// HTML5 DnD plumbing (Chrome MCP verifies that end of the pipeline live).
//
// Asset library E2: an asset library record card drops as `use_asset`
// (POST /api/library/use) — registered with its pinned `asset:` src and
// placed with the tool its kind takes, as one undo step. Those tests upload
// real files (POST /api/assets) and drop the records the panel lists.

import { test } from '@japa/runner'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import projectStore from '#services/project_store'
import libraryIndex from '#services/library_index'
import commandBus from '#services/command_bus'
import {
  buildCommandsForNewTrackDrop,
  buildCommandsForTrackDrop,
  useAssetForStageDrop,
  useAssetForTrackDrop,
  type LibraryDragPayload,
} from '../../inertia/composables/useLibraryDrag.js'

const BASE_COMP = {
  version: '0.1',
  composition: {
    width: 1280,
    height: 720,
    fps: 60,
    duration: 6,
    background: '#0a0e27',
  },
  assets: [],
  layers: [{ id: 'fg', z: 10, opacity: 1, blendMode: 'normal', items: [] as string[] }],
  items: {} as Record<string, unknown>,
  tweens: [],
}

async function makeProjectWithLibrary(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-libdrop-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(BASE_COMP, null, 2), 'utf8')
  const libDir = join(dir, 'library')
  await mkdir(join(libDir, 'templates'), { recursive: true })
  await mkdir(join(libDir, 'scenes'), { recursive: true })
  await writeFile(
    join(libDir, 'index.json'),
    JSON.stringify({
      version: '0.1',
      templates: [],
      behaviors: [],
      scenes: [],
      assets: [],
      fonts: [],
    }),
    'utf8'
  )
  await writeFile(
    join(libDir, 'templates', 'title-card.template.json'),
    JSON.stringify({
      id: 'titleCard',
      name: 'Title card',
      // Shape-only template so the test doesn't depend on a font asset being
      // registered (the engine's validator rejects text items that reference
      // an unknown font family).
      params: [
        { name: 'title', type: 'string', required: true },
        { name: 'color', type: 'color', default: '#ff6b35' },
      ],
      items: {
        title: {
          type: 'shape',
          kind: 'rect',
          width: 640,
          height: 160,
          cornerRadius: 12,
          fillColor: '${params.color}',
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
  return dir
}

function titleCardPayload(): LibraryDragPayload {
  return {
    kind: 'template',
    id: 'titleCard',
    name: 'Title card',
    defaults: {
      // Brand-defaults pre-bind: required `title` gets the item's name; the
      // rest pass through their per-descriptor defaults.
      title: 'Title card',
      color: '#ff6b35',
    },
  }
}

test.group('Library drop → composition mutation (step 14)', (group) => {
  group.each.setup(async () => {
    await libraryIndex.detach()
    await libraryIndex.detachGlobal()
    await projectStore.unload()
  })

  test('dropping a template on the new-track zone applies it via the bus', async ({
    assert,
  }) => {
    const dir = await makeProjectWithLibrary()
    try {
      await projectStore.load(dir)
      // LibraryIndex registers templates as part of attach() inside load().
      // Sanity-check the registry actually sees titleCard.
      const { hasTemplate } = await import('davidup/compose')
      assert.isTrue(hasTemplate('titleCard'), 'library template registered')

      const commands = buildCommandsForNewTrackDrop(titleCardPayload(), {
        layerId: 'fg',
        start: 0,
      })
      assert.lengthOf(commands, 1)

      const result = await commandBus.apply(commands[0]!)
      // Expanded template prefixes its local item id with the instance id.
      // We don't pin the exact id (it includes a timestamp) so we look for
      // any item whose key ends in `__title`.
      const items = (result.composition as { items: Record<string, unknown> }).items
      const titleKeys = Object.keys(items).filter((k) => k.endsWith('__title'))
      assert.isAtLeast(
        titleKeys.length,
        1,
        'composition should include the template-expanded title item'
      )
      const layer = (result.composition as {
        layers: Array<{ id: string; items: string[] }>
      }).layers.find((l) => l.id === 'fg')
      assert.isAtLeast(layer!.items.length, 1)
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('dropping a built-in behavior on an existing track adds tweens', async ({
    assert,
  }) => {
    const compWithItem = {
      ...BASE_COMP,
      layers: [{ id: 'fg', z: 10, opacity: 1, blendMode: 'normal', items: ['logo'] }],
      items: {
        logo: {
          type: 'shape',
          kind: 'rect',
          width: 200,
          height: 200,
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
    }
    const dir = await mkdtemp(join(tmpdir(), 'davidup-libdrop-beh-'))
    try {
      await writeFile(
        join(dir, 'composition.json'),
        JSON.stringify(compWithItem, null, 2),
        'utf8'
      )
      await projectStore.load(dir)

      // The library catalog hasn't been attached here, but built-in
      // behaviors (like `fadeIn`) don't need registration — they live in
      // src/compose/behaviors.ts and the engine looks them up by name.
      const payload: LibraryDragPayload = {
        kind: 'behavior',
        id: 'fadeIn',
        name: 'Fade in',
        defaults: { duration: 0.5, easing: 'easeOutQuad' },
      }
      const commands = buildCommandsForTrackDrop(payload, {
        targetItemId: 'logo',
        defaultLayerId: 'fg',
        start: 0.4,
      })
      assert.lengthOf(commands, 1)

      const before = (projectStore.composition as { tweens: unknown[] }).tweens.length
      const result = await commandBus.apply(commands[0]!)
      const after = (result.composition as { tweens: unknown[] }).tweens.length
      assert.isAtLeast(after, before + 1, 'behavior should add at least one tween')

      // The added tween should target our row's item.
      const tweens = (result.composition as {
        tweens: Array<{ target: string; id: string }>
      }).tweens
      const ours = tweens.find((t) => t.target === 'logo')
      assert.exists(ours, 'a tween targeting `logo` should exist')
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ─── asset library E2: a record card drops as use_asset ──────────────────────

const FIXTURES = resolve(import.meta.dirname, '../../../../tests/drivers/fixtures')
// A 1x1 red PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
)

interface DropComp {
  assets: Array<{ id: string; type: string; src: string; licence?: string }>
  layers: Array<{ id: string; items: string[] }>
  items: Record<string, Record<string, unknown>>
  audio?: Array<{ id: string; asset: string; start: number }>
}

/** The payload LibraryCard puts on a drag of the record the panel lists as `id`. */
async function recordPayload(
  client: { get: (url: string) => { qs: (q: Record<string, string>) => Promise<{ body: () => unknown }> } },
  id: string
): Promise<LibraryDragPayload> {
  await libraryIndex.flush()
  const res = await client.get('/api/library').qs({ kind: 'asset' })
  const item = (res.body() as { items: Array<Record<string, unknown>> }).items.find((i) => i.id === id)
  if (!item) throw new Error(`the panel does not list ${id}`)
  return {
    kind: 'asset',
    id,
    name: String(item.name ?? id),
    defaults: {},
    mediaType: item.assetType as LibraryDragPayload['mediaType'],
    shelf: item.shelf as string,
  }
}

test.group('Library record drop → use_asset (asset library E2)', (group) => {
  let dir: string
  let shelves: string
  const before = { assets: process.env.DAVIDUP_ASSETS, house: process.env.DAVIDUP_HOUSE }

  group.each.setup(async () => {
    await libraryIndex.detach()
    await projectStore.unload()
    shelves = await mkdtemp(join(tmpdir(), 'davidup-libdrop-shelves-'))
    process.env.DAVIDUP_ASSETS = join(shelves, 'user')
    process.env.DAVIDUP_HOUSE = join(shelves, 'house')
    dir = await mkdtemp(join(tmpdir(), 'davidup-libdrop-rec-'))
    await writeFile(join(dir, 'composition.json'), JSON.stringify(BASE_COMP, null, 2), 'utf8')
  })

  group.each.teardown(async () => {
    await projectStore.unload()
    await libraryIndex.detach()
    for (const [key, v] of [['DAVIDUP_ASSETS', before.assets], ['DAVIDUP_HOUSE', before.house]] as const) {
      if (v === undefined) delete process.env[key]
      else process.env[key] = v
    }
    await rm(dir, { recursive: true, force: true })
    await rm(shelves, { recursive: true, force: true })
  })

  test('an audio card dropped on a track adds an audio track', async ({ client, assert }) => {
    await client.post('/api/project').json({ directory: dir })
    commandBus.reset()
    const up = await client
      .post('/api/assets')
      .file('file', await readFile(join(FIXTURES, 'audio', 'tone-mono.wav')), {
        filename: 'tone.wav',
        contentType: 'audio/wav',
      })
    up.assertStatus(201)
    const sha = (up.body() as { asset: { sha: string } }).asset.sha

    const request = useAssetForTrackDrop(await recordPayload(client, 'tone'), { start: 1.5 })
    assert.deepEqual(request, { id: 'tone', as: 'audio', place: { start: 1.5 } })
    const res = await client.post('/api/library/use').json(request!)
    res.assertStatus(200)
    const body = res.body() as { result: { assetId: string; audioTrackId: string }; composition: DropComp; undoStackSize: number }
    assert.equal(body.result.assetId, 'tone')
    const comp = projectStore.composition as unknown as DropComp
    assert.deepInclude(comp.assets.find((a) => a.id === 'tone'), {
      type: 'audio',
      src: `asset:tone@${sha.slice(0, 12)}`,
      licence: 'own',
    })
    assert.deepInclude(comp.audio?.find((t) => t.id === body.result.audioTrackId), { asset: 'tone', start: 1.5 })
    assert.equal(body.undoStackSize, 1, 'register + place are one undo step')
  })

  test('a video card dropped on the stage adds a video item', async ({ client, assert }) => {
    await client.post('/api/project').json({ directory: dir })
    commandBus.reset()
    const up = await client
      .post('/api/assets')
      .file('file', await readFile(join(FIXTURES, 'video', 'small.mp4')), {
        filename: 'small.mp4',
        contentType: 'video/mp4',
      })
    up.assertStatus(201)

    const request = useAssetForStageDrop(await recordPayload(client, 'small'), {
      layerId: 'fg',
      x: 400,
      y: 300,
      start: 0.5,
    })
    const res = await client.post('/api/library/use').json(request!)
    res.assertStatus(200)
    const itemId = (res.body() as { result: { itemId: string } }).result.itemId
    const comp = projectStore.composition as unknown as DropComp
    assert.deepInclude(comp.items[itemId], { type: 'video', asset: 'small', start: 0.5 })
    assert.include(comp.layers.find((l) => l.id === 'fg')!.items, itemId)
    assert.equal(comp.assets.find((a) => a.id === 'small')?.type, 'video')
  })

  test('an image card dropped on the stage is a sprite sized from the record; one undo takes it all back', async ({
    client,
    assert,
  }) => {
    await client.post('/api/project').json({ directory: dir })
    commandBus.reset()
    ;(await client.post('/api/assets').file('file', PNG, { filename: 'dot.png', contentType: 'image/png' })).assertStatus(201)

    const request = useAssetForStageDrop(await recordPayload(client, 'dot'), {
      layerId: 'fg',
      x: 100,
      y: 80,
      start: 0,
    })
    const res = await client.post('/api/library/use').json(request!)
    res.assertStatus(200)
    const itemId = (res.body() as { result: { itemId: string } }).result.itemId
    const comp = projectStore.composition as unknown as DropComp
    assert.deepInclude(comp.items[itemId], { type: 'sprite', asset: 'dot', width: 1, height: 1 })
    assert.deepInclude(comp.items[itemId].transform as object, { x: 100, y: 80, anchorX: 0.5, anchorY: 0.5 })

    // Dropped again: the registration is reused, a second sprite placed.
    const again = await client.post('/api/library/use').json(request!)
    again.assertStatus(200)
    assert.equal((again.body() as { result: { registered: string } }).result.registered, 'already')

    commandBus.undo()
    commandBus.undo()
    const after = projectStore.composition as unknown as DropComp
    assert.notProperty(after.items, itemId)
    assert.isUndefined(after.assets.find((a) => a.id === 'dot'), 'the registration undoes with the drop')
  })

  test('the asset picker registers a record without placing it', async ({ client, assert }) => {
    await client.post('/api/project').json({ directory: dir })
    ;(await client.post('/api/assets').file('file', PNG, { filename: 'dot.png', contentType: 'image/png' })).assertStatus(201)
    const res = await client.post('/api/library/use').json({ id: 'dot', place: false })
    res.assertStatus(200)
    assert.deepInclude((res.body() as { result: Record<string, unknown> }).result, { assetId: 'dot', registered: 'new' })
    const comp = projectStore.composition as unknown as DropComp
    assert.lengthOf(Object.keys(comp.items), 0)
    assert.exists(comp.assets.find((a) => a.id === 'dot'))
  })

  test('an index.json card is not a record: its drop stays the composition-asset commands', ({ assert }) => {
    const payload: LibraryDragPayload = { kind: 'asset', id: 'ball', name: 'Ball', defaults: {}, mediaType: 'audio' }
    assert.isNull(useAssetForTrackDrop(payload, { start: 0 }))
    assert.isNull(useAssetForStageDrop({ ...payload, mediaType: 'image' }, { layerId: 'fg', x: 0, y: 0, start: 0 }))
  })

  test('an unknown record is 404 E_ASSET_MISSING; no project is 404 E_NO_PROJECT', async ({ client }) => {
    const none = await client.post('/api/library/use').json({ id: 'dot' })
    none.assertStatus(404)
    none.assertBodyContains({ error: { code: 'E_NO_PROJECT' } })

    await client.post('/api/project').json({ directory: dir })
    const missing = await client.post('/api/library/use').json({ id: 'nothing-here' })
    missing.assertStatus(404)
    missing.assertBodyContains({ error: { code: 'E_ASSET_MISSING' } })
  })
})
