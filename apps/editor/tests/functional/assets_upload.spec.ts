// Functional tests for the asset upload pipeline — step 18.
//
// Covers POST /api/assets:
//   - happy path: upload a real PNG → file lands under library/assets/<hash>.png,
//     library/index.json gains the record, response shape is correct, hash matches
//     SHA-256 of the bytes.
//   - idempotency: re-uploading the same bytes returns the same record without
//     duplicating the index entry.
//   - validation: rejects with E_NO_PROJECT before a project is loaded, and
//     E_BAD_REQUEST when the `file` field is missing.
//   - library_index pickup: the new asset appears in GET /api/library within 1s.

import { test } from '@japa/runner'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import projectStore from '#services/project_store'
import libraryIndex from '#services/library_index'

// Minimal 1x1 RGB PNG (white pixel). Stable across runs → stable hash.
const PNG_1X1_WHITE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg=='

function pngBytes(): Buffer {
  return Buffer.from(PNG_1X1_WHITE_BASE64, 'base64')
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

async function makeProject(opts: { withLibrary?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-assets-'))
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
        assets: [],
        fonts: [],
      }),
      'utf8'
    )
  }
  return dir
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false)
}

test.group('Asset upload pipeline · POST /api/assets', (group) => {
  group.each.setup(async () => {
    await libraryIndex.detach()
    await projectStore.unload()
  })

  test('happy path — upload PNG writes hashed file + index entry + record', async ({
    client,
    assert,
  }) => {
    const dir = await makeProject({ withLibrary: true })
    try {
      await client.post('/api/project').json({ directory: dir })

      const bytes = pngBytes()
      const expectedHash = createHash('sha256').update(bytes).digest('hex')

      const res = await client
        .post('/api/assets')
        .file('file', bytes, { filename: 'logo.png', contentType: 'image/png' })
      res.assertStatus(201)
      const body = res.body() as { asset: Record<string, unknown> }
      assert.exists(body.asset, 'response should include asset record')
      const a = body.asset
      assert.equal(a.id, expectedHash)
      assert.equal(a.kind, 'image')
      assert.equal(a.mediaType, 'image/png')
      assert.equal(a.name, 'logo.png')
      assert.equal(a.url, `assets/${expectedHash}.png`)
      assert.equal(a.hash, `sha256:${expectedHash}`)
      assert.equal(a.size, bytes.length)
      assert.isString(a.createdAt)
      // skia-canvas should have read 1x1 dims; if it's not available locally
      // the pipeline gracefully omits them — accept either.
      if (a.width !== undefined) {
        assert.equal(a.width, 1)
        assert.equal(a.height, 1)
      }

      // File landed on disk under library/assets/.
      const onDisk = join(dir, 'library', 'assets', `${expectedHash}.png`)
      assert.isTrue(await pathExists(onDisk), 'hashed asset file should exist on disk')
      const writtenBytes = await readFile(onDisk)
      assert.equal(
        createHash('sha256').update(writtenBytes).digest('hex'),
        expectedHash,
        'written bytes should match uploaded bytes'
      )

      // library/index.json updated.
      const idx = JSON.parse(await readFile(join(dir, 'library', 'index.json'), 'utf8')) as {
        assets: Array<Record<string, unknown>>
      }
      assert.isArray(idx.assets)
      assert.equal(idx.assets.length, 1)
      assert.equal(idx.assets[0].id, expectedHash)
      assert.equal(idx.assets[0].url, `assets/${expectedHash}.png`)
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('asset shows up in /api/library within 2s', async ({ client, assert }) => {
    const dir = await makeProject({ withLibrary: true })
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()

      const bytes = pngBytes()
      const expectedHash = createHash('sha256').update(bytes).digest('hex')

      const uploadRes = await client
        .post('/api/assets')
        .file('file', bytes, { filename: 'drop.png', contentType: 'image/png' })
      uploadRes.assertStatus(201)

      const deadline = Date.now() + 2000
      let found = false
      while (Date.now() < deadline) {
        await libraryIndex.flush()
        const res = await client.get('/api/library').qs({ kind: 'asset' })
        const items = (res.body() as { items: Array<{ id: string }> }).items
        if (items.some((i) => i.id === expectedHash)) {
          found = true
          break
        }
        await delay(75)
      }
      assert.isTrue(found, 'asset should appear in /api/library within 2s')
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('re-uploading the same bytes is idempotent', async ({ client, assert }) => {
    const dir = await makeProject({ withLibrary: true })
    try {
      await client.post('/api/project').json({ directory: dir })
      const bytes = pngBytes()
      const expectedHash = createHash('sha256').update(bytes).digest('hex')

      const first = await client
        .post('/api/assets')
        .file('file', bytes, { filename: 'a.png', contentType: 'image/png' })
      first.assertStatus(201)

      const second = await client
        .post('/api/assets')
        .file('file', bytes, { filename: 'a-renamed.png', contentType: 'image/png' })
      second.assertStatus(201)

      const firstBody = first.body() as { asset: { id: string } }
      const secondBody = second.body() as { asset: { id: string } }
      assert.equal(firstBody.asset.id, expectedHash)
      assert.equal(secondBody.asset.id, expectedHash)

      const idx = JSON.parse(await readFile(join(dir, 'library', 'index.json'), 'utf8')) as {
        assets: Array<{ id: string }>
      }
      assert.equal(idx.assets.length, 1, 'index should not duplicate the same asset')
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('creates library/ + index.json when missing', async ({ client, assert }) => {
    const dir = await makeProject({ withLibrary: false })
    try {
      await client.post('/api/project').json({ directory: dir })
      const bytes = pngBytes()
      const res = await client
        .post('/api/assets')
        .file('file', bytes, { filename: 'fresh.png', contentType: 'image/png' })
      res.assertStatus(201)

      const indexPath = join(dir, 'library', 'index.json')
      assert.isTrue(await pathExists(indexPath), 'index.json should be created')
      const idx = JSON.parse(await readFile(indexPath, 'utf8')) as {
        assets: Array<{ id: string }>
      }
      assert.equal(idx.assets.length, 1)
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('rejects upload when no project is loaded with 404 E_NO_PROJECT', async ({ client }) => {
    const bytes = pngBytes()
    const res = await client
      .post('/api/assets')
      .file('file', bytes, { filename: 'x.png', contentType: 'image/png' })
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'E_NO_PROJECT' } })
  })

  test('rejects when `file` multipart field is missing with 400', async ({ client }) => {
    const dir = await makeProject({ withLibrary: true })
    try {
      await client.post('/api/project').json({ directory: dir })
      const res = await client.post('/api/assets').field('other', 'value')
      res.assertStatus(400)
      res.assertBodyContains({ error: { code: 'E_BAD_REQUEST' } })
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('rejects unsupported extension with 400 (bodyparser validation)', async ({ client }) => {
    const dir = await makeProject({ withLibrary: true })
    try {
      await client.post('/api/project').json({ directory: dir })
      const res = await client
        .post('/api/assets')
        .file('file', Buffer.from('hello'), {
          filename: 'notes.txt',
          contentType: 'text/plain',
        })
      res.assertStatus(400)
      res.assertBodyContains({ error: { code: 'E_BAD_REQUEST' } })
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
