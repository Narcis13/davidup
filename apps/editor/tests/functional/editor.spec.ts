import { test } from '@japa/runner'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import projectStore from '#services/project_store'
import { rewriteAssetsForBrowser } from '#controllers/editor_controller'

const VALID_COMP = {
  version: '0.1',
  composition: {
    width: 1280,
    height: 720,
    fps: 60,
    duration: 3,
    background: '#0a0e27',
  },
  assets: [
    { id: 'ball', type: 'image', src: './ball.png' },
    { id: 'badge', type: 'image', src: 'logos/badge.png' },
    { id: 'font-display', type: 'font', src: './fonts/Display.ttf', family: 'Display' },
  ],
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

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-editor-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(VALID_COMP, null, 2), 'utf8')
  // Asset files used by /project-files/* tests.
  await writeFile(join(dir, 'ball.png'), Buffer.from([1, 2, 3, 4]))
  await mkdir(join(dir, 'logos'), { recursive: true })
  await writeFile(join(dir, 'logos', 'badge.png'), Buffer.from([5, 6, 7, 8, 9]))
  await mkdir(join(dir, 'fonts'), { recursive: true })
  await writeFile(join(dir, 'fonts', 'Display.ttf'), Buffer.from('FAKE-FONT-DATA'))
  return dir
}

test.group('rewriteAssetsForBrowser', () => {
  test('rewrites relative srcs to /project-files/* URLs', ({ assert }) => {
    const out = rewriteAssetsForBrowser(VALID_COMP) as typeof VALID_COMP
    assert.equal(out.assets[0].src, '/project-files/ball.png')
    assert.equal(out.assets[1].src, '/project-files/logos/badge.png')
    assert.equal(out.assets[2].src, '/project-files/fonts/Display.ttf')
  })

  test('does not mutate input', ({ assert }) => {
    const before = JSON.stringify(VALID_COMP)
    rewriteAssetsForBrowser(VALID_COMP)
    assert.equal(JSON.stringify(VALID_COMP), before)
  })

  test('leaves absolute URLs and data URIs untouched', ({ assert }) => {
    const comp = {
      assets: [
        { id: 'a', type: 'image', src: 'https://cdn.example.com/foo.png' },
        { id: 'b', type: 'image', src: 'data:image/png;base64,AAA' },
      ],
    }
    const out = rewriteAssetsForBrowser(comp) as typeof comp
    assert.equal(out.assets[0].src, 'https://cdn.example.com/foo.png')
    assert.equal(out.assets[1].src, 'data:image/png;base64,AAA')
  })

  test('returns input unchanged when not an object', ({ assert }) => {
    assert.equal(rewriteAssetsForBrowser(null), null)
    assert.equal(rewriteAssetsForBrowser('nope'), 'nope')
  })
})

/**
 * Pull the JSON payload Adonis/Inertia embeds in the rendered HTML.
 * The edge layout (`@inertia()`) emits `<div id="app" data-page='{...}'></div>`
 * — that JSON is the source of truth for what props the Vue page receives.
 */
function extractInertiaPage(html: string): {
  component: string
  props: Record<string, unknown>
} {
  // Two possible shapes:
  //   - SSR enabled: `<script data-page="app" type="application/json">{json}</script>`
  //     (inertia core SSR body — see @inertiajs/core/dist/index.js).
  //   - SSR disabled: `<div id="app" data-page="<html-encoded-json>"></div>`
  //     (adonis inertia edge plugin).
  const ssrScript = html.match(
    /<script[^>]*data-page="[^"]*"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
  )
  if (ssrScript) return JSON.parse(ssrScript[1])

  const attr = html.match(/<div[^>]*id="app"[^>]*data-page="([^"]*)"/)
  if (!attr) throw new Error('Could not find inertia page payload in HTML')
  const decoded = attr[1]
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // &amp; last so we don't double-decode entities like &amp;lt;.
    .replace(/&amp;/g, '&')
  return JSON.parse(decoded)
}

test.group('Editor page', (group) => {
  group.each.setup(async () => {
    await projectStore.unload()
  })

  test('GET /editor renders the inertia editor page with composition + rewritten assets', async ({
    client,
    assert,
  }) => {
    const dir = await makeProject()
    try {
      await projectStore.load(dir)
      const res = await client.get('/editor')
      res.assertStatus(200)
      const page = extractInertiaPage(res.text())
      assert.equal(page.component, 'editor')
      const composition = page.props.composition as typeof VALID_COMP
      const project = page.props.project as { root: string }
      assert.equal(project.root, dir)
      assert.equal(composition.assets[0].src, '/project-files/ball.png')
      assert.equal(composition.assets[1].src, '/project-files/logos/badge.png')
      assert.equal(composition.assets[2].src, '/project-files/fonts/Display.ttf')
      assert.isNull(page.props.error)
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('GET /editor renders the empty state when no project is loaded', async ({
    client,
    assert,
  }) => {
    const res = await client.get('/editor')
    res.assertStatus(200)
    const page = extractInertiaPage(res.text())
    assert.equal(page.component, 'editor')
    assert.isNull(page.props.composition)
    assert.isNull(page.props.project)
    const error = page.props.error as { code: string }
    assert.equal(error.code, 'E_NO_PROJECT')
  })

  test('GET /editor emits the inertia data-page payload', async ({ client }) => {
    const res = await client.get('/editor')
    res.assertStatus(200)
    res.assertTextIncludes('data-page')
  })
})

test.group('Editor file streaming', (group) => {
  group.each.setup(async () => {
    await projectStore.unload()
  })

  test('GET /project-files/ball.png streams the file from the project root', async ({
    client,
    assert,
  }) => {
    const dir = await makeProject()
    try {
      await projectStore.load(dir)
      const res = await client.get('/project-files/ball.png')
      res.assertStatus(200)
      assert.equal(res.header('content-type'), 'image/png')
      assert.equal(res.header('content-length'), '4')
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('serves nested paths', async ({ client }) => {
    const dir = await makeProject()
    try {
      await projectStore.load(dir)
      const res = await client.get('/project-files/logos/badge.png')
      res.assertStatus(200)
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('returns 404 when no project is loaded', async ({ client }) => {
    const res = await client.get('/project-files/anything.png')
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'E_NO_PROJECT' } })
  })

  test('returns 404 for missing files', async ({ client }) => {
    const dir = await makeProject()
    try {
      await projectStore.load(dir)
      const res = await client.get('/project-files/missing.png')
      res.assertStatus(404)
      res.assertBodyContains({ error: { code: 'E_FILE_NOT_FOUND' } })
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('blocks path traversal with ../', async ({ client }) => {
    const dir = await makeProject()
    try {
      await projectStore.load(dir)
      const res = await client.get('/project-files/..%2F..%2Fetc%2Fpasswd')
      // Either 403 (traversal blocked) or 404 (not found) is acceptable.
      assert(res.status() === 403 || res.status() === 404)
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

function assert(cond: unknown): asserts cond {
  if (!cond) throw new Error('expected condition to be truthy')
}
