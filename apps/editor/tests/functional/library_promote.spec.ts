/*
|--------------------------------------------------------------------------
| v1.1 S29 — promoting project-library assets and fonts to the global pool
| Asset library E3 — promoting a project shelf record is a move to the user shelf
|--------------------------------------------------------------------------
*/

import { test } from '@japa/runner'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import commandBus from '#services/command_bus'
import libraryIndex from '#services/library_index'
import projectStore from '#services/project_store'
import { promoteLibraryItem, PromoteError } from '#services/promote_library_item'

async function readJson(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path, 'utf8'))
}

test.group('promoteLibraryItem · assets and fonts', (group) => {
  let projectLib: string
  let globalLib: string

  group.each.setup(async () => {
    await projectStore.unload()
    const project = await mkdtemp(join(tmpdir(), 'davidup-promote-project-'))
    globalLib = await mkdtemp(join(tmpdir(), 'davidup-promote-global-'))
    projectLib = join(project, 'library')
    await mkdir(join(projectLib, 'assets'), { recursive: true })
    await mkdir(join(projectLib, 'fonts'), { recursive: true })
    await writeFile(join(projectLib, 'assets', 'logo.png'), 'PNGBYTES')
    await writeFile(join(projectLib, 'fonts', 'inter.woff2'), 'FONTBYTES')
    await writeFile(
      join(projectLib, 'index.json'),
      JSON.stringify({
        assets: [
          { id: 'logo-png', type: 'image', url: 'assets/logo.png' },
          { id: 'remote', type: 'image', url: 'https://example.com/a.png' },
        ],
        fonts: [{ id: 'inter', family: 'Inter', src: 'fonts/inter.woff2' }],
      })
    )
    await libraryIndex.attachGlobal(globalLib)
    await libraryIndex.attachProject(projectLib)

    return async () => {
      await libraryIndex.detach()
      await libraryIndex.detachGlobal()
      await rm(project, { recursive: true, force: true })
      await rm(globalLib, { recursive: true, force: true })
    }
  })

  test('an asset moves its entry and binary, src rewritten to global:', async ({ assert }) => {
    const result = await promoteLibraryItem({ kind: 'asset', id: 'logo-png' })
    assert.equal(result.toRelative, 'assets/logo.png')

    assert.equal(await readFile(join(globalLib, 'assets', 'logo.png'), 'utf8'), 'PNGBYTES')
    assert.isFalse(existsSync(join(projectLib, 'assets', 'logo.png')))

    const globalIdx = await readJson(join(globalLib, 'index.json'))
    assert.deepEqual(globalIdx.assets, [
      { id: 'logo-png', type: 'image', url: 'global:assets/logo.png' },
    ])
    const projectIdx = await readJson(join(projectLib, 'index.json'))
    assert.deepEqual(
      projectIdx.assets.map((a: { id: string }) => a.id),
      ['remote']
    )
    assert.lengthOf(projectIdx.fonts, 1)

    const promoted = libraryIndex.search({ kind: 'asset' }).find((i) => i.id === 'logo-png')
    assert.equal(promoted?.scope, 'global')
  })

  test('a font promotes with its `src` field', async ({ assert }) => {
    await promoteLibraryItem({ kind: 'font', id: 'inter' })
    const globalIdx = await readJson(join(globalLib, 'index.json'))
    assert.deepEqual(globalIdx.fonts, [
      { id: 'inter', family: 'Inter', src: 'global:fonts/inter.woff2' },
    ])
    assert.equal(await readFile(join(globalLib, 'fonts', 'inter.woff2'), 'utf8'), 'FONTBYTES')
  })

  test('a remote asset moves only its entry', async ({ assert }) => {
    const result = await promoteLibraryItem({ kind: 'asset', id: 'remote' })
    assert.equal(result.toRelative, 'index.json')
    const globalIdx = await readJson(join(globalLib, 'index.json'))
    assert.deepEqual(globalIdx.assets, [
      { id: 'remote', type: 'image', url: 'https://example.com/a.png' },
    ])
  })

  test('an existing global entry needs force', async ({ assert }) => {
    await writeFile(
      join(globalLib, 'index.json'),
      JSON.stringify({ assets: [{ id: 'logo-png', url: 'global:assets/old.png' }] })
    )
    await libraryIndex.reloadNow()
    try {
      await promoteLibraryItem({ kind: 'asset', id: 'logo-png' })
      assert.fail('expected E_TARGET_EXISTS')
    } catch (err) {
      assert.instanceOf(err, PromoteError)
      assert.equal((err as PromoteError).code, 'E_TARGET_EXISTS')
    }
    // Nothing moved.
    assert.isTrue(existsSync(join(projectLib, 'assets', 'logo.png')))

    await promoteLibraryItem({ kind: 'asset', id: 'logo-png', force: true })
    const globalIdx = await readJson(join(globalLib, 'index.json'))
    assert.deepEqual(globalIdx.assets, [
      { id: 'logo-png', type: 'image', url: 'global:assets/logo.png' },
    ])
  })
})

// A 1x1 red PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
)
// A 1x1 blue PNG, for other bytes under the same id.
const BLUE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADAgH/eL9GtQAAAABJRU5ErkJggg==',
  'base64'
)

const BASE_COMP = {
  version: '0.1',
  composition: { width: 320, height: 180, fps: 30, duration: 2, background: '#000000' },
  assets: [] as unknown[],
  layers: [{ id: 'fg', z: 10, opacity: 1, blendMode: 'normal', items: [] as string[] }],
  items: {},
  tweens: [],
}

interface Comp {
  assets: Array<{ id: string; type: string; src: string }>
}

type Catalogue = Record<string, { sha: string; ext: string; [k: string]: unknown }>

test.group('promote · asset shelf records (asset library E3)', (group) => {
  let dir: string
  let shelves: string
  let userShelf: string
  const before = { assets: process.env.DAVIDUP_ASSETS, house: process.env.DAVIDUP_HOUSE }

  group.each.setup(async () => {
    await libraryIndex.detach()
    await projectStore.unload()
    shelves = await mkdtemp(join(tmpdir(), 'davidup-promote-shelves-'))
    userShelf = join(shelves, 'user')
    process.env.DAVIDUP_ASSETS = userShelf
    process.env.DAVIDUP_HOUSE = join(shelves, 'house')
    dir = await mkdtemp(join(tmpdir(), 'davidup-promote-rec-'))
    await writeFile(join(dir, 'composition.json'), JSON.stringify(BASE_COMP, null, 2), 'utf8')
  })

  group.each.teardown(async () => {
    await projectStore.unload()
    await libraryIndex.detach()
    for (const [key, v] of [
      ['DAVIDUP_ASSETS', before.assets],
      ['DAVIDUP_HOUSE', before.house],
    ] as const) {
      if (v === undefined) delete process.env[key]
      else process.env[key] = v
    }
    await rm(dir, { recursive: true, force: true })
    await rm(shelves, { recursive: true, force: true })
  })

  async function upload(
    client: { post: (url: string) => any },
    bytes: Buffer,
    filename: string,
    target?: 'global'
  ): Promise<string> {
    let req = client.post('/api/assets').file('file', bytes, { filename, contentType: 'image/png' })
    if (target) req = req.field('target', target)
    const res = await req
    res.assertStatus(201)
    return (res.body() as { asset: { sha: string } }).asset.sha
  }

  test('a project record moves to the user shelf; its src resolves there to the same bytes', async ({
    client,
    assert,
  }) => {
    await client.post('/api/project').json({ directory: dir })
    const sha = await upload(client, PNG, 'dot.png')
    const pinned = `asset:dot@${sha.slice(0, 12)}`
    const used = await client.post('/api/library/use').json({ id: 'dot', place: false })
    used.assertStatus(200)
    assert.equal((projectStore.composition as unknown as Comp).assets[0]?.src, pinned)
    const undo = commandBus.undoStackSize
    await libraryIndex.flush()

    const res = await client.post('/api/library/promote').json({ kind: 'asset', id: 'dot' })
    res.assertStatus(200)
    const body = res.body() as Record<string, unknown>
    assert.deepInclude(body, { kind: 'asset', id: 'dot', shelf: 'user', src: pinned, repinned: [] })
    assert.equal(body.toRelative, `blobs/${sha}.png`)
    assert.notProperty(body, 'composition')

    // The blob, thumb-to-be and entry left the project shelf for the user's.
    const projectCat = JSON.parse(
      await readFile(join(dir, 'assets', 'catalogue.json'), 'utf8')
    ) as Catalogue
    assert.notProperty(projectCat, 'dot')
    assert.isFalse(existsSync(join(dir, 'assets', 'blobs', `${sha}.png`)))
    const userCat = JSON.parse(
      await readFile(join(userShelf, 'catalogue.json'), 'utf8')
    ) as Catalogue
    assert.equal(userCat.dot?.sha, sha)
    assert.deepEqual(await readFile(join(userShelf, 'blobs', `${sha}.png`)), PNG)

    // The composition is untouched (no visible change, no undo step), and its
    // pinned src now resolves on the user shelf to the same bytes.
    assert.equal((projectStore.composition as unknown as Comp).assets[0]?.src, pinned)
    assert.equal(commandBus.undoStackSize, undo)
    const blob = await client.get(`/asset-files/dot@${sha.slice(0, 12)}`)
    blob.assertStatus(200)
    assert.equal(blob.header('content-length'), String(PNG.length))

    // The panel lists it on the user shelf, no longer promotable.
    const listed = await client.get('/api/library').qs({ kind: 'asset' })
    const item = (listed.body() as { items: Array<Record<string, unknown>> }).items.find(
      (i) => i.id === 'dot'
    )
    assert.deepInclude(item, { shelf: 'user', scope: 'global', url: pinned })
  })

  test('the user shelf holding the id with other bytes refuses, and nothing moves', async ({
    client,
    assert,
  }) => {
    await client.post('/api/project').json({ directory: dir })
    await upload(client, BLUE, 'dot.png', 'global')
    // The upload never shadows, so the project's own `dot` is put under the id directly.
    const { openLibrary, standardShelves } = await import('davidup/assetlib')
    const lib = openLibrary({ shelves: standardShelves({ project: dir }) })
    await lib.put(
      'project',
      { id: 'dot', kind: 'image', name: 'dot', licence: 'own', credit: '', source: '', tags: [] },
      PNG
    )
    await libraryIndex.reloadNow()

    const res = await client
      .post('/api/library/promote')
      .json({ kind: 'asset', id: 'dot', force: true })
    res.assertStatus(409)
    const err = (res.body() as { error: { code: string; details: Record<string, unknown> } }).error
    assert.equal(err.code, 'E_TARGET_EXISTS')
    assert.deepInclude(err.details, { shelf: 'user', overwritable: false })
    const projectCat = JSON.parse(
      await readFile(join(dir, 'assets', 'catalogue.json'), 'utf8')
    ) as Catalogue
    assert.property(projectCat, 'dot')
  })

  test('a legacy sha1 record is rehashed on the way, and the composition re-pinned as one undo step', async ({
    client,
    assert,
  }) => {
    await client.post('/api/project').json({ directory: dir })
    const sha256 = await upload(client, PNG, 'dot.png')
    // Make the project record a pre-H1 one: its blob named and pinned by sha1.
    const sha1 = createHash('sha1').update(PNG).digest('hex')
    const catFile = join(dir, 'assets', 'catalogue.json')
    const cat = JSON.parse(await readFile(catFile, 'utf8')) as Catalogue
    cat.dot!.sha = sha1
    await writeFile(catFile, JSON.stringify(cat), 'utf8')
    await rename(
      join(dir, 'assets', 'blobs', `${sha256}.png`),
      join(dir, 'assets', 'blobs', `${sha1}.png`)
    )
    await libraryIndex.reloadNow()
    commandBus.reset()
    const used = await client.post('/api/library/use').json({ id: 'dot', place: false })
    used.assertStatus(200)
    assert.equal(
      (projectStore.composition as unknown as Comp).assets[0]?.src,
      `asset:dot@${sha1.slice(0, 12)}`
    )
    assert.equal(commandBus.undoStackSize, 1)

    const res = await client.post('/api/library/promote').json({ kind: 'asset', id: 'dot' })
    res.assertStatus(200)
    const body = res.body() as {
      src: string
      repinned: string[]
      composition: Comp
      undoStackSize: number
    }
    const repinned = `asset:dot@${sha256.slice(0, 12)}`
    assert.equal(body.src, repinned)
    assert.deepEqual(body.repinned, ['dot'])
    assert.equal(body.composition.assets[0]?.src, repinned)
    assert.equal((projectStore.composition as unknown as Comp).assets[0]?.src, repinned)
    assert.equal(body.undoStackSize, 2)
    const userCat = JSON.parse(
      await readFile(join(userShelf, 'catalogue.json'), 'utf8')
    ) as Catalogue
    assert.equal(userCat.dot?.sha, sha256)
  })
})
