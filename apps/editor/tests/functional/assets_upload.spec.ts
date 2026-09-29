// Functional tests for the asset upload pipeline — step 18, on the asset
// library since E2 (docs/asset-library-plan.md).
//
// Covers POST /api/assets:
//   - a file lands on the open project's shelf (`<project>/assets/`): blob
//     `blobs/<sha256>.<ext>`, an entry in `catalogue.json`, the record in the
//     response with its shelf and pinned `asset:<id>@<sha12>` src.
//   - the id is the file's name as an id, `-2` when a shelf holds it already;
//     the same bytes again return the record the shelf holds.
//   - provenance: licence `own` by default with a warning; the form fields
//     licence / credit / source / tags / name / desc land on the record; a
//     licence outside the list refuses before anything is written.
//   - audio, video and font uploads are probed (duration, size, family).
//   - `target=global` puts on the user's pool (`$DAVIDUP_ASSETS`).
//   - the Library panel lists the record within 2s.

import { test } from '@japa/runner'
import type { Group } from '@japa/runner/core'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import projectStore from '#services/project_store'
import libraryIndex from '#services/library_index'
import globalLibraryRoot from '#services/global_library_root'

// Minimal 1x1 RGB PNG (white pixel). Stable across runs → stable hash.
const PNG_1X1_WHITE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg=='
// A 1x1 red PNG: other bytes.
const PNG_1X1_RED_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

const FIXTURES = resolve(import.meta.dirname, '../../../../tests/drivers/fixtures')
const WAV = join(FIXTURES, 'audio', 'tone-mono.wav')
const MP4 = join(FIXTURES, 'video', 'small.mp4')
const TTF = resolve(import.meta.dirname, '../../../../examples/fonts/BebasNeue-Regular.ttf')

const OWN_WARNING = /Licence set to own/

function pngBytes(): Buffer {
  return Buffer.from(PNG_1X1_WHITE_BASE64, 'base64')
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

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
  const dir = await mkdtemp(join(tmpdir(), 'davidup-assets-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(VALID_COMP, null, 2), 'utf8')
  return dir
}

async function catalogue(shelfRoot: string): Promise<Record<string, Record<string, unknown>>> {
  return JSON.parse(await readFile(join(shelfRoot, 'catalogue.json'), 'utf8'))
}

async function delay(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

interface Uploaded {
  asset: Record<string, unknown> & { id: string; sha: string }
  status: string
  warnings: string[]
}

/** Point the user and house shelves at empty temp dirs for one group; restore after. */
function isolatedShelves(group: Group) {
  const state = { user: '', house: '', root: '' }
  const before = { assets: process.env.DAVIDUP_ASSETS, house: process.env.DAVIDUP_HOUSE }
  group.each.setup(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'davidup-upload-shelves-'))
    state.user = join(state.root, 'user')
    state.house = join(state.root, 'house')
    process.env.DAVIDUP_ASSETS = state.user
    process.env.DAVIDUP_HOUSE = state.house
    await libraryIndex.detach()
    await projectStore.unload()
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
    await rm(state.root, { recursive: true, force: true })
  })
  return state
}

test.group('Asset upload · POST /api/assets puts on the project shelf', (group) => {
  isolatedShelves(group)

  test('a PNG becomes a record: blob, catalogue entry, pinned src, licence own', async ({
    client,
    assert,
  }) => {
    const dir = await makeProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      const bytes = pngBytes()
      const hex = sha256(bytes)

      const res = await client
        .post('/api/assets')
        .file('file', bytes, { filename: 'Logo.png', contentType: 'image/png' })
      res.assertStatus(201)
      const body = res.body() as Uploaded
      assert.equal(body.status, 'new')
      assert.deepInclude(body.asset, {
        id: 'logo',
        kind: 'image',
        name: 'Logo',
        shelf: 'project',
        sha: hex,
        ext: 'png',
        bytes: bytes.length,
        licence: 'own',
        src: `asset:logo@${hex.slice(0, 12)}`,
        w: 1,
        h: 1,
      })
      assert.match(body.warnings[0] ?? '', OWN_WARNING)

      const blob = join(dir, 'assets', 'blobs', `${hex}.png`)
      assert.isTrue(existsSync(blob), 'the blob is on the project shelf')
      assert.equal(sha256(await readFile(blob)), hex)
      const cat = await catalogue(join(dir, 'assets'))
      assert.deepEqual(Object.keys(cat), ['logo'])
      assert.deepInclude(cat.logo, { kind: 'image', sha: hex, licence: 'own', by: 'add_asset' })
      // The editor's old index.json is not written any more.
      assert.isFalse(existsSync(join(dir, 'library', 'index.json')))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('the Library panel lists the record within 2s', async ({ client, assert }) => {
    const dir = await makeProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()
      const up = await client
        .post('/api/assets')
        .file('file', pngBytes(), { filename: 'drop.png', contentType: 'image/png' })
      up.assertStatus(201)

      const deadline = Date.now() + 2000
      let found: Record<string, unknown> | undefined
      while (Date.now() < deadline && !found) {
        await libraryIndex.flush()
        const res = await client.get('/api/library').qs({ kind: 'asset' })
        found = (res.body() as { items: Array<Record<string, unknown>> }).items.find(
          (i) => i.id === 'drop'
        )
        if (!found) await delay(75)
      }
      assert.exists(found, 'the record should list in /api/library within 2s')
      assert.deepInclude(found!, { shelf: 'project', assetType: 'image', licence: 'own' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('the same bytes again return the record the shelf holds', async ({ client, assert }) => {
    const dir = await makeProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      const first = await client
        .post('/api/assets')
        .file('file', pngBytes(), { filename: 'a.png', contentType: 'image/png' })
      first.assertStatus(201)
      const second = await client
        .post('/api/assets')
        .file('file', pngBytes(), { filename: 'a-renamed.png', contentType: 'image/png' })
      second.assertStatus(201)

      const body = second.body() as Uploaded
      assert.equal(body.status, 'unchanged bytes')
      assert.equal(body.asset.id, 'a')
      assert.deepEqual(body.warnings, [])
      assert.deepEqual(Object.keys(await catalogue(join(dir, 'assets'))), ['a'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('other bytes under a name a shelf holds get the next free id', async ({
    client,
    assert,
  }) => {
    const dir = await makeProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      await client
        .post('/api/assets')
        .file('file', pngBytes(), { filename: 'logo.png', contentType: 'image/png' })
      const res = await client
        .post('/api/assets')
        .file('file', Buffer.from(PNG_1X1_RED_BASE64, 'base64'), {
          filename: 'logo.png',
          contentType: 'image/png',
        })
      res.assertStatus(201)
      assert.equal((res.body() as Uploaded).asset.id, 'logo-2')
      assert.deepEqual(Object.keys(await catalogue(join(dir, 'assets'))).sort(), ['logo', 'logo-2'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('the form fields are the record: licence, credit, source, tags, name, desc', async ({
    client,
    assert,
  }) => {
    const dir = await makeProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      const res = await client
        .post('/api/assets')
        .field('licence', 'CC-BY')
        .field('credit', 'Photo: A. Person')
        .field('source', 'https://example.org/paper')
        .field('tags', 'paper, warm,paper')
        .field('name', 'Warm paper')
        .field('desc', 'A sheet of warm paper')
        .file('file', pngBytes(), { filename: 'IMG_0001.png', contentType: 'image/png' })
      res.assertStatus(201)
      const body = res.body() as Uploaded
      assert.deepInclude(body.asset, {
        id: 'img-0001',
        name: 'Warm paper',
        licence: 'CC-BY',
        credit: 'Photo: A. Person',
        source: 'https://example.org/paper',
        desc: 'A sheet of warm paper',
      })
      assert.deepEqual(body.asset.tags, ['paper', 'warm'])
      assert.isFalse(
        body.warnings.some((w) => OWN_WARNING.test(w)),
        'no own warning when a licence is given'
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('a licence outside the list refuses with 400 before anything is written', async ({
    client,
    assert,
  }) => {
    const dir = await makeProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      const res = await client
        .post('/api/assets')
        .field('licence', 'MIT')
        .file('file', pngBytes(), { filename: 'x.png', contentType: 'image/png' })
      res.assertStatus(400)
      res.assertBodyContains({ error: { code: 'E_INVALID_VALUE' } })
      assert.isFalse(existsSync(join(dir, 'assets', 'catalogue.json')))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('audio, video and a font are probed', async ({ client, assert }) => {
    const dir = await makeProject()
    try {
      await client.post('/api/project').json({ directory: dir })

      const wav = await client
        .post('/api/assets')
        .file('file', await readFile(WAV), { filename: 'tone.wav', contentType: 'audio/wav' })
      wav.assertStatus(201)
      const audio = (wav.body() as Uploaded).asset
      assert.deepInclude(audio, { id: 'tone', kind: 'audio', ext: 'wav' })
      assert.isAbove(audio.sec as number, 0, 'the duration is probed')

      const mp4 = await client
        .post('/api/assets')
        .file('file', await readFile(MP4), { filename: 'small.mp4', contentType: 'video/mp4' })
      mp4.assertStatus(201)
      assert.deepInclude((mp4.body() as Uploaded).asset, {
        id: 'small',
        kind: 'video',
        w: 320,
        h: 240,
      })

      const ttf = await client.post('/api/assets').file('file', await readFile(TTF), {
        filename: 'BebasNeue-Regular.ttf',
        contentType: 'font/ttf',
      })
      ttf.assertStatus(201)
      assert.deepInclude((ttf.body() as Uploaded).asset, {
        id: 'bebasneue-regular',
        kind: 'font',
        family: 'Bebas Neue',
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('rejects upload when no project is loaded with 404 E_NO_PROJECT', async ({ client }) => {
    const res = await client
      .post('/api/assets')
      .file('file', pngBytes(), { filename: 'x.png', contentType: 'image/png' })
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'E_NO_PROJECT' } })
  })

  test('rejects when `file` multipart field is missing with 400', async ({ client }) => {
    const dir = await makeProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      const res = await client.post('/api/assets').field('other', 'value')
      res.assertStatus(400)
      res.assertBodyContains({ error: { code: 'E_BAD_REQUEST' } })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('rejects unsupported extension with 400 (bodyparser validation)', async ({ client }) => {
    const dir = await makeProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      const res = await client
        .post('/api/assets')
        .file('file', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' })
      res.assertStatus(400)
      res.assertBodyContains({ error: { code: 'E_BAD_REQUEST' } })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

test.group('Asset upload · target=global puts on the user pool', (group) => {
  const shelves = isolatedShelves(group)

  test('target=global writes to the user shelf even without a project loaded', async ({
    client,
    assert,
  }) => {
    const bytes = pngBytes()
    const hex = sha256(bytes)
    const res = await client
      .post('/api/assets')
      .field('target', 'global')
      .file('file', bytes, { filename: 'logo.png', contentType: 'image/png' })
    res.assertStatus(201)
    assert.deepInclude((res.body() as Uploaded).asset, { id: 'logo', shelf: 'user', sha: hex })
    assert.isTrue(existsSync(join(shelves.user, 'blobs', `${hex}.png`)))
    assert.deepEqual(Object.keys(await catalogue(shelves.user)), ['logo'])
  })

  test('target=global does not touch the project shelf', async ({ client, assert }) => {
    const dir = await makeProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      const res = await client
        .post('/api/assets')
        .field('target', 'global')
        .file('file', pngBytes(), { filename: 'shared.png', contentType: 'image/png' })
      res.assertStatus(201)
      assert.isFalse(existsSync(join(dir, 'assets', 'catalogue.json')), 'no project shelf written')
      assert.deepEqual(Object.keys(await catalogue(shelves.user)), ['shared'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('an id the project shelf holds is not shadowed by a global upload', async ({
    client,
    assert,
  }) => {
    const dir = await makeProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      await client
        .post('/api/assets')
        .file('file', pngBytes(), { filename: 'mark.png', contentType: 'image/png' })
      const res = await client
        .post('/api/assets')
        .field('target', 'global')
        .file('file', Buffer.from(PNG_1X1_RED_BASE64, 'base64'), {
          filename: 'mark.png',
          contentType: 'image/png',
        })
      res.assertStatus(201)
      assert.deepInclude((res.body() as Uploaded).asset, { id: 'mark-2', shelf: 'user' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('default target (omitted) still requires a project', async ({ client }) => {
    const res = await client
      .post('/api/assets')
      .file('file', pngBytes(), { filename: 'a.png', contentType: 'image/png' })
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'E_NO_PROJECT' } })
  })

  test('unknown target value rejects with E_BAD_REQUEST', async ({ client }) => {
    const res = await client
      .post('/api/assets')
      .field('target', 'cloud')
      .file('file', pngBytes(), { filename: 'a.png', contentType: 'image/png' })
    res.assertStatus(400)
    res.assertBodyContains({ error: { code: 'E_BAD_REQUEST' } })
  })

  test('a global upload lists in /api/library?scope=global', async ({ client, assert }) => {
    const res = await client
      .post('/api/assets')
      .field('target', 'global')
      .file('file', pngBytes(), { filename: 'shared.png', contentType: 'image/png' })
    res.assertStatus(201)
    await libraryIndex.flush()
    const list = await client.get('/api/library').qs({ kind: 'asset', scope: 'global' })
    const items = (list.body() as { items: Array<{ id: string; scope: string; shelf?: string }> })
      .items
    assert.deepInclude(items.find((i) => i.id === 'shared') ?? {}, {
      scope: 'global',
      shelf: 'user',
    })
  })
})

// ─── step 20.7: GET /api/library?scope=… filter validation ──────────────────
test.group('Library catalog · scope filter', (group) => {
  let globalDir: string
  let prevEnv: string | undefined

  group.each.setup(async () => {
    await libraryIndex.detach()
    await libraryIndex.detachGlobal()
    await projectStore.unload()
    globalDir = await mkdtemp(join(tmpdir(), 'davidup-scope-filter-'))
    prevEnv = process.env.DAVIDUP_LIBRARY
    process.env.DAVIDUP_LIBRARY = globalDir
    globalLibraryRoot.setPath(globalDir)
  })

  group.each.teardown(async () => {
    if (prevEnv === undefined) delete process.env.DAVIDUP_LIBRARY
    else process.env.DAVIDUP_LIBRARY = prevEnv
    globalLibraryRoot.setPath(null)
    await libraryIndex.detach()
    await libraryIndex.detachGlobal()
    await rm(globalDir, { recursive: true, force: true })
  })

  test('rejects unknown scope with 400', async ({ client }) => {
    const res = await client.get('/api/library').qs({ scope: 'cloud' })
    res.assertStatus(400)
    res.assertBodyContains({ error: { code: 'E_BAD_REQUEST' } })
  })

  test('scope=global returns only global items; scope=project returns project ones', async ({
    client,
    assert,
  }) => {
    await writeFile(
      join(globalDir, 'index.json'),
      JSON.stringify({
        version: '0.1',
        templates: [],
        behaviors: [],
        scenes: [],
        assets: [{ id: 'global-only', url: 'assets/g.png' }],
        fonts: [],
      }),
      'utf8'
    )
    await libraryIndex.attachGlobal(globalDir)

    const dir = await makeProject()
    await mkdir(join(dir, 'library'), { recursive: true })
    await writeFile(
      join(dir, 'library', 'index.json'),
      JSON.stringify({
        version: '0.1',
        templates: [],
        behaviors: [],
        scenes: [],
        assets: [{ id: 'project-only', url: 'assets/p.png' }],
        fonts: [],
      }),
      'utf8'
    )
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()

      const globalRes = await client.get('/api/library').qs({ scope: 'global' })
      globalRes.assertStatus(200)
      const globalBody = globalRes.body() as { items: Array<{ id: string; scope: string }> }
      assert.isTrue(
        globalBody.items.every((i) => i.scope === 'global'),
        'scope=global must filter to global-only items'
      )
      assert.isTrue(globalBody.items.some((i) => i.id === 'global-only'))
      assert.isFalse(globalBody.items.some((i) => i.id === 'project-only'))

      const projectRes = await client.get('/api/library').qs({ scope: 'project' })
      projectRes.assertStatus(200)
      const projectBody = projectRes.body() as { items: Array<{ id: string; scope: string }> }
      assert.isTrue(
        projectBody.items.every((i) => i.scope === 'project'),
        'scope=project must filter to project-only items'
      )
      assert.isTrue(projectBody.items.some((i) => i.id === 'project-only'))
      assert.isFalse(projectBody.items.some((i) => i.id === 'global-only'))
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
