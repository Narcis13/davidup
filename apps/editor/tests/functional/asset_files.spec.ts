// Asset library D1: the editor serves asset-library blobs at /asset-files/*
// (what the browser loader fetches for an `asset:<id>[@sha12]` src) and leaves
// `asset:` srcs symbolic when it rewrites a composition for the browser.

import { test } from '@japa/runner'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import projectStore from '#services/project_store'
import { rewriteAssetsForBrowser } from '#controllers/editor_controller'

// Different lengths, so content-length tells which shelf answered.
const RED = Buffer.from('red-bytes-standing-in-for-a-png')
const BLUE = Buffer.from('blue-bytes, a little longer, standing in for a png')
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

/** One shelf: `catalogue.json` + `blobs/<sha>.png`, as assetlib writes it. */
async function shelf(root: string, entries: Record<string, Buffer>): Promise<void> {
  await mkdir(join(root, 'blobs'), { recursive: true })
  const catalogue: Record<string, unknown> = {}
  for (const [id, bytes] of Object.entries(entries)) {
    await writeFile(join(root, 'blobs', `${sha(bytes)}.png`), bytes)
    catalogue[id] = {
      kind: 'image', name: id, tags: [], licence: 'own', credit: '', source: '',
      sha: sha(bytes), ext: 'png', bytes: bytes.length,
    }
  }
  await writeFile(join(root, 'catalogue.json'), JSON.stringify(catalogue))
}

const COMP = {
  version: '0.1',
  composition: { width: 64, height: 32, fps: 12, duration: 1, background: '#000000' },
  assets: [
    { id: 'dot', type: 'image', src: 'asset:dot' },
    { id: 'pool', type: 'image', src: 'global:assets/x.png' },
  ],
  layers: [{ id: 'fg', z: 0, opacity: 1, blendMode: 'normal', items: [] }],
  items: {},
  tweens: [],
}

let base = ''
let project = ''
const envBefore = { assets: process.env.DAVIDUP_ASSETS, house: process.env.DAVIDUP_HOUSE, project: process.env.DAVIDUP_PROJECT }

test.group('GET /asset-files/*', (group) => {
  group.each.setup(async () => {
    await projectStore.unload()
    base = await mkdtemp(join(tmpdir(), 'davidup-asset-files-'))
    project = join(base, 'project')
    await shelf(join(project, 'assets'), { dot: RED })
    await shelf(join(base, 'user'), { dot: BLUE, swatch: BLUE })
    await shelf(join(base, 'house'), { paper: RED })
    await writeFile(join(project, 'composition.json'), JSON.stringify(COMP))
    process.env.DAVIDUP_ASSETS = join(base, 'user')
    process.env.DAVIDUP_HOUSE = join(base, 'house')
    delete process.env.DAVIDUP_PROJECT
    return async () => {
      await projectStore.unload()
      for (const [k, v] of [['DAVIDUP_ASSETS', envBefore.assets], ['DAVIDUP_HOUSE', envBefore.house], ['DAVIDUP_PROJECT', envBefore.project]] as const) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      await rm(base, { recursive: true, force: true })
    }
  })

  test('resolves an id on the open project shelf, which shadows the user pool', async ({ client, assert }) => {
    await projectStore.load(project)
    const res = await client.get('/asset-files/dot')
    res.assertStatus(200)
    assert.equal(res.header('content-type'), 'image/png')
    assert.equal(res.header('cache-control'), 'no-cache')
    assert.equal(res.header('content-length'), String(RED.length))
  })

  test('with no project loaded, the user pool answers', async ({ client, assert }) => {
    const res = await client.get('/asset-files/dot')
    res.assertStatus(200)
    assert.equal(res.header('content-length'), String(BLUE.length))
  })

  test('a pinned ref is immutable; a stale pin is 409 E_ASSET_STALE', async ({ client, assert }) => {
    await projectStore.load(project)
    const ok = await client.get(`/asset-files/dot@${sha(RED).slice(0, 12)}`)
    ok.assertStatus(200)
    assert.match(ok.header('cache-control') ?? '', /immutable/)
    const stale = await client.get('/asset-files/dot@0123456789ab')
    stale.assertStatus(409)
    assert.equal(stale.body().error.code, 'E_ASSET_STALE')
  })

  test('a missing record is 404 E_ASSET_MISSING naming the shelves', async ({ client, assert }) => {
    await projectStore.load(project)
    const res = await client.get('/asset-files/teapot')
    res.assertStatus(404)
    assert.equal(res.body().error.code, 'E_ASSET_MISSING')
    assert.include(res.body().error.message, `house (${join(base, 'house')})`)
  })

  test('serves a blob by shelf and sha, and nothing outside the shelves', async ({ client, assert }) => {
    const res = await client.get(`/asset-files/house/${sha(RED)}.png`)
    res.assertStatus(200)
    assert.equal(res.header('content-length'), String(RED.length))
    ;(await client.get(`/asset-files/attic/${sha(RED)}.png`)).assertStatus(404)
    ;(await client.get('/asset-files/house/catalogue.json')).assertStatus(400)
    ;(await client.get('/asset-files/house/..%2Fcatalogue.json')).assertStatus(400)
    ;(await client.get('/asset-files/a/b/c')).assertStatus(400)
  })
})

test.group('rewriteAssetsForBrowser · asset:', () => {
  test('passes asset: srcs through untouched for the browser loader', ({ assert }) => {
    const out = rewriteAssetsForBrowser(COMP) as { assets: Array<{ src: string }> }
    assert.equal(out.assets[0].src, 'asset:dot')
    assert.equal(out.assets[1].src, '/library-files/assets/x.png')
  })
})
