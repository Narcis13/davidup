/*
|--------------------------------------------------------------------------
| Asset library E4 — the record drawer's read and edit
|--------------------------------------------------------------------------
|
| GET /api/library/record is the MCP get_asset, POST /api/library/record the
| MCP tag_asset, both on the shelves the Library panel lists. An edit is on
| the catalog before the answer, so the panel's search finds it at once.
*/

import { test } from '@japa/runner'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readShelf } from 'davidup/assetlib'

import commandBus from '#services/command_bus'
import libraryIndex from '#services/library_index'
import projectStore from '#services/project_store'

// A 1x1 red PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
)
// A 1x1 blue PNG.
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

interface Detail {
  record: {
    id: string
    name: string
    desc?: string
    tags: string[]
    licence: string
    credit: string
    sha: string
  }
  shelf: string
  shelves: string[]
  made: { from: { id: string }[]; into: { id: string; tool?: string }[] }
}

test.group('library record · the drawer (asset library E4)', (group) => {
  let dir: string

  group.each.setup(async () => {
    await libraryIndex.detach()
    await projectStore.unload()
    dir = await mkdtemp(join(tmpdir(), 'davidup-record-'))
    await writeFile(join(dir, 'composition.json'), JSON.stringify(BASE_COMP, null, 2), 'utf8')
  })

  group.each.teardown(async () => {
    await projectStore.unload()
    await libraryIndex.detach()
    await rm(dir, { recursive: true, force: true })
  })

  async function openWithDot(client: { post: (url: string) => any }): Promise<void> {
    await client.post('/api/project').json({ directory: dir })
    const res = await client
      .post('/api/assets')
      .file('file', PNG, { filename: 'dot.png', contentType: 'image/png' })
      .field('licence', 'CC0')
    res.assertStatus(201)
  }

  test('GET reads the record, its shelves and what was made from it', async ({
    client,
    assert,
  }) => {
    await openWithDot(client)
    readShelf(join(dir, 'assets')).put(
      {
        id: 'dot-sheet',
        kind: 'image',
        name: 'Dot sheet',
        tags: [],
        licence: 'own',
        credit: '',
        source: '',
        made: { tool: 'hdf sprite', from: ['dot'], args: {}, at: '2026-09-29' },
      },
      BLUE
    )

    const res = await client.get('/api/library/record').qs({ id: 'dot' })
    res.assertStatus(200)
    const body = res.body() as Detail
    assert.equal(body.record.id, 'dot')
    assert.equal(body.record.licence, 'CC0')
    assert.equal(body.shelf, 'project')
    assert.deepEqual(body.shelves, ['project'])
    assert.deepEqual(
      body.made.into.map((m) => [m.id, m.tool]),
      [['dot-sheet', 'hdf sprite']]
    )

    const sheetRes = await client.get('/api/library/record').qs({ id: 'dot-sheet' })
    const sheet = sheetRes.body() as Detail
    assert.deepEqual(
      sheet.made.from.map((m) => m.id),
      ['dot']
    )
  })

  test('GET is 404 for an id no shelf holds, 400 without one', async ({ client }) => {
    await client.post('/api/project').json({ directory: dir })
    const missing = await client.get('/api/library/record').qs({ id: 'nothing-here' })
    missing.assertStatus(404)
    missing.assertBodyContains({ error: { code: 'E_ASSET_MISSING' } })
    const bare = await client.get('/api/library/record')
    bare.assertStatus(400)
  })

  test('POST edits what search reads, and the search finds the new tag at once', async ({
    client,
    assert,
  }) => {
    await openWithDot(client)
    const beforeRes = await client.get('/api/library').qs({ kind: 'asset', q: 'lunar' })
    const before = beforeRes.body() as {
      items: { id: string }[]
    }
    assert.notInclude(
      before.items.map((i) => i.id),
      'dot'
    )
    const undo = commandBus.undoStackSize

    const res = await client.post('/api/library/record').json({
      id: 'dot',
      shelf: 'project',
      add: ['lunar', 'night'],
      desc: 'A red dot on nothing',
      credit: 'Me',
      licence: 'own',
    })
    res.assertStatus(200)
    const body = res.body() as { edit: { added: string[] }; detail: Detail }
    assert.deepEqual(body.edit.added, ['lunar', 'night'])
    assert.includeMembers(body.detail.record.tags, ['lunar', 'night'])
    assert.equal(body.detail.record.desc, 'A red dot on nothing')
    assert.equal(body.detail.record.licence, 'own')

    const afterRes = await client.get('/api/library').qs({ kind: 'asset', q: 'lunar' })
    const after = afterRes.body() as {
      items: { id: string; tags?: string[] }[]
      facets: { tags: Record<string, number> }
    }
    const hit = after.items.find((i) => i.id === 'dot')
    assert.exists(hit)
    assert.includeMembers(hit!.tags ?? [], ['lunar'])
    assert.equal(after.facets.tags.lunar, 1)

    // The shelf changed, not the composition: no undo step.
    assert.equal(commandBus.undoStackSize, undo)
    const catalogue = await readFile(join(dir, 'assets', 'catalogue.json'), 'utf8')
    assert.include(catalogue, 'lunar')

    // Removing a tag and clearing the desc.
    const removed = await client
      .post('/api/library/record')
      .json({ id: 'dot', remove: ['night'], desc: '' })
    removed.assertStatus(200)
    const rec = (removed.body() as { detail: Detail }).detail.record
    assert.notInclude(rec.tags, 'night')
    assert.notExists(rec.desc)
  })

  test('POST refuses a licence outside the list and a field it does not edit, writing nothing', async ({
    client,
    assert,
  }) => {
    await openWithDot(client)
    const catalogue = join(dir, 'assets', 'catalogue.json')
    const before = await readFile(catalogue, 'utf8')

    const bad = await client
      .post('/api/library/record')
      .json({ id: 'dot', licence: 'MIT', add: ['x'] })
    bad.assertStatus(400)
    const kind = await client.post('/api/library/record').json({ id: 'dot', kind: 'cutout' })
    kind.assertStatus(400)
    assert.include((kind.body() as { error: { message: string } }).error.message, 'kind')
    const nothing = await client.post('/api/library/record').json({ id: 'dot' })
    nothing.assertStatus(400)
    const missing = await client
      .post('/api/library/record')
      .json({ id: 'nothing-here', add: ['x'] })
    missing.assertStatus(404)

    assert.equal(await readFile(catalogue, 'utf8'), before)
  })
})
