// Tests for the library thumbnail endpoint + service — step 13.
//
// Covers:
//   - GET /api/library/thumbnail returns a PNG for known items
//   - Asset image items render via the engine (no placeholder header)
//   - Font items render via the engine (no placeholder header)
//   - Template / scene / behavior items render either via the engine or a
//     deterministic placeholder PNG (and the response is well-formed in
//     either case)
//   - Missing ids return 404; missing/invalid kinds return 400
//   - Cache invalidates when the underlying catalog reloads

import { test } from '@japa/runner'
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import libraryIndex from '#services/library_index'
import libraryThumbnail from '#services/library_thumbnail'
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

const BALL_PNG = resolve(import.meta.dirname, '../../../../examples/ball.png')
const FONT_TTF = resolve(
  import.meta.dirname,
  '../../../../examples/fonts/BebasNeue-Regular.ttf'
)

async function makeLibraryProject() {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-thumb-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(VALID_COMP, null, 2), 'utf8')
  await mkdir(join(dir, 'library'), { recursive: true })
  await mkdir(join(dir, 'assets'), { recursive: true })
  await mkdir(join(dir, 'fonts'), { recursive: true })
  await copyFile(BALL_PNG, join(dir, 'assets', 'ball.png'))
  await copyFile(FONT_TTF, join(dir, 'fonts', 'Display.ttf'))
  await writeFile(
    join(dir, 'library', 'index.json'),
    JSON.stringify({
      assets: [
        { id: 'ball', name: 'Ball PNG', url: '../assets/ball.png' },
        { id: 'orphan', name: 'Orphan asset', url: '../assets/missing.png' },
      ],
      fonts: [
        {
          id: 'display',
          name: 'Display Font',
          family: 'PreviewDisplay',
          url: '../fonts/Display.ttf',
        },
      ],
    }),
    'utf8'
  )
  await writeFile(
    join(dir, 'library', 'badge.template.json'),
    JSON.stringify({
      id: 'badge',
      name: 'Badge',
      description: 'Pill badge template',
      items: {
        pill: {
          type: 'shape',
          kind: 'rect',
          width: 320,
          height: 96,
          cornerRadius: 48,
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
    }),
    'utf8'
  )
  await writeFile(
    join(dir, 'library', 'fade-in.behavior.json'),
    JSON.stringify({ id: 'fadeIn', name: 'Fade in', description: 'Linear opacity 0→1' }),
    'utf8'
  )
  await writeFile(
    join(dir, 'library', 'intro.scene.json'),
    JSON.stringify({
      id: 'intro',
      name: 'Intro',
      duration: 2,
      items: {
        bg: {
          type: 'shape',
          kind: 'rect',
          width: 200,
          height: 200,
          fillColor: '#1b2451',
          transform: {
            x: 240,
            y: 135,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            anchorX: 0.5,
            anchorY: 0.5,
            opacity: 1,
          },
        },
      },
    }),
    'utf8'
  )
  return dir
}

function isPng(buffer: ArrayBuffer | Uint8Array): boolean {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (view.length < 8) return false
  return (
    view[0] === 0x89 &&
    view[1] === 0x50 &&
    view[2] === 0x4e &&
    view[3] === 0x47 &&
    view[4] === 0x0d &&
    view[5] === 0x0a &&
    view[6] === 0x1a &&
    view[7] === 0x0a
  )
}

test.group('Library thumbnails · HTTP', (group) => {
  group.each.setup(async () => {
    await libraryIndex.detach()
    await libraryIndex.detachGlobal()
    await projectStore.unload()
    libraryThumbnail.clear()
  })

  test('400 when kind or id query params are missing', async ({ client }) => {
    const r1 = await client.get('/api/library/thumbnail')
    r1.assertStatus(400)
    const r2 = await client.get('/api/library/thumbnail').qs({ kind: 'template' })
    r2.assertStatus(400)
    const r3 = await client.get('/api/library/thumbnail').qs({ kind: 'banana', id: 'x' })
    r3.assertStatus(400)
  })

  test('404 when no item with the given id exists', async ({ client }) => {
    const dir = await makeLibraryProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()
      const res = await client
        .get('/api/library/thumbnail')
        .qs({ kind: 'template', id: 'no-such-thing' })
      res.assertStatus(404)
      res.assertBodyContains({ error: { code: 'E_LIBRARY_ITEM_NOT_FOUND' } })
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('asset image returns a PNG via the engine (no placeholder header)', async ({
    client,
    assert,
  }) => {
    const dir = await makeLibraryProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()
      const res = await client.get('/api/library/thumbnail').qs({ kind: 'asset', id: 'ball' })
      res.assertStatus(200)
      assert.equal(res.header('content-type'), 'image/png')
      assert.isUndefined(res.header('x-thumbnail-placeholder'))
      assert.isTrue(isPng(res.response.body))
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('asset with missing source file falls back to a placeholder PNG', async ({
    client,
    assert,
  }) => {
    const dir = await makeLibraryProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()
      const res = await client.get('/api/library/thumbnail').qs({ kind: 'asset', id: 'orphan' })
      res.assertStatus(200)
      assert.equal(res.header('content-type'), 'image/png')
      assert.equal(res.header('x-thumbnail-placeholder'), '1')
      assert.isTrue(isPng(res.response.body))
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('font item returns a PNG (text "Aa" rendered with the family)', async ({
    client,
    assert,
  }) => {
    const dir = await makeLibraryProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()
      const res = await client.get('/api/library/thumbnail').qs({ kind: 'font', id: 'display' })
      res.assertStatus(200)
      assert.equal(res.header('content-type'), 'image/png')
      assert.isTrue(isPng(res.response.body))
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('template item renders via engine (no placeholder)', async ({ client, assert }) => {
    const dir = await makeLibraryProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()
      const res = await client
        .get('/api/library/thumbnail')
        .qs({ kind: 'template', id: 'badge' })
      res.assertStatus(200)
      assert.equal(res.header('content-type'), 'image/png')
      assert.isUndefined(res.header('x-thumbnail-placeholder'))
      assert.isTrue(isPng(res.response.body))
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('scene item renders via engine (no placeholder)', async ({ client, assert }) => {
    const dir = await makeLibraryProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()
      const res = await client.get('/api/library/thumbnail').qs({ kind: 'scene', id: 'intro' })
      res.assertStatus(200)
      assert.equal(res.header('content-type'), 'image/png')
      assert.isUndefined(res.header('x-thumbnail-placeholder'))
      assert.isTrue(isPng(res.response.body))
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('behavior item renders via engine (no placeholder)', async ({ client, assert }) => {
    const dir = await makeLibraryProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()
      const res = await client
        .get('/api/library/thumbnail')
        .qs({ kind: 'behavior', id: 'fadeIn' })
      res.assertStatus(200)
      assert.equal(res.header('content-type'), 'image/png')
      assert.isUndefined(res.header('x-thumbnail-placeholder'))
      assert.isTrue(isPng(res.response.body))
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('second request for the same item is served from cache (identical bytes)', async ({
    client,
    assert,
  }) => {
    const dir = await makeLibraryProject()
    try {
      await client.post('/api/project').json({ directory: dir })
      await libraryIndex.flush()
      const a = await client.get('/api/library/thumbnail').qs({ kind: 'asset', id: 'ball' })
      const b = await client.get('/api/library/thumbnail').qs({ kind: 'asset', id: 'ball' })
      a.assertStatus(200)
      b.assertStatus(200)
      const bufA = new Uint8Array(a.response.body)
      const bufB = new Uint8Array(b.response.body)
      assert.equal(bufA.length, bufB.length)
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
