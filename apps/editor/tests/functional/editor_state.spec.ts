import { test } from '@japa/runner'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EditorStateStore,
  DEFAULT_PANEL_LAYOUT,
  PANEL_LIMITS,
} from '#services/editor_state'
import editorStateSingleton from '#services/editor_state'

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-state-'))
  const path = join(dir, 'state.json')
  return { dir, path, store: new EditorStateStore({ path }) }
}

test.group('EditorStateStore · service', () => {
  test('returns defaults when state.json does not exist', async ({ assert }) => {
    const { dir, store } = await makeStore()
    try {
      const state = await store.read()
      assert.deepEqual(state.panelLayout, DEFAULT_PANEL_LAYOUT)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('persists panelLayout to disk via update()', async ({ assert }) => {
    const { dir, path, store } = await makeStore()
    try {
      const next = await store.update({
        panelLayout: { leftWidth: 333, rightWidth: 277, bottomHeight: 199 },
      })
      assert.equal(next.panelLayout.leftWidth, 333)
      assert.equal(next.panelLayout.rightWidth, 277)
      assert.equal(next.panelLayout.bottomHeight, 199)
      const onDisk = JSON.parse(await readFile(path, 'utf8'))
      assert.deepEqual(onDisk.panelLayout, {
        leftWidth: 333,
        rightWidth: 277,
        bottomHeight: 199,
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('clamps out-of-range sizes to PANEL_LIMITS', async ({ assert }) => {
    const { dir, store } = await makeStore()
    try {
      const next = await store.update({
        panelLayout: { leftWidth: 9999, rightWidth: 0, bottomHeight: -50 },
      })
      assert.equal(next.panelLayout.leftWidth, PANEL_LIMITS.leftWidth.max)
      assert.equal(next.panelLayout.rightWidth, PANEL_LIMITS.rightWidth.min)
      assert.equal(next.panelLayout.bottomHeight, PANEL_LIMITS.bottomHeight.min)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('partial updates merge with existing state', async ({ assert }) => {
    const { dir, store } = await makeStore()
    try {
      await store.update({ panelLayout: { leftWidth: 250 } })
      store.resetCache()
      const after = await store.update({ panelLayout: { rightWidth: 500 } })
      assert.equal(after.panelLayout.leftWidth, 250)
      assert.equal(after.panelLayout.rightWidth, 500)
      assert.equal(after.panelLayout.bottomHeight, DEFAULT_PANEL_LAYOUT.bottomHeight)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('survives a malformed state.json by falling back to defaults', async ({ assert }) => {
    const { dir, path, store } = await makeStore()
    try {
      await writeFile(path, '{not json', 'utf8')
      const state = await store.read()
      assert.deepEqual(state.panelLayout, DEFAULT_PANEL_LAYOUT)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

test.group('Editor state · HTTP', (group) => {
  let stateDir: string

  group.each.setup(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'davidup-state-http-'))
    editorStateSingleton.setPath(join(stateDir, 'state.json'))
  })

  group.each.teardown(async () => {
    editorStateSingleton.setPath(null)
    await rm(stateDir, { recursive: true, force: true })
  })

  test('GET /api/editor-state returns defaults on first run', async ({ client, assert }) => {
    const res = await client.get('/api/editor-state')
    res.assertStatus(200)
    const body = res.body() as { panelLayout: typeof DEFAULT_PANEL_LAYOUT }
    assert.deepEqual(body.panelLayout, DEFAULT_PANEL_LAYOUT)
  })

  test('PUT /api/editor-state persists panelLayout to ~/.davidup/state.json', async ({
    client,
    assert,
  }) => {
    const res = await client.put('/api/editor-state').json({
      panelLayout: { leftWidth: 311, rightWidth: 290, bottomHeight: 175 },
    })
    res.assertStatus(200)
    const body = res.body() as { panelLayout: typeof DEFAULT_PANEL_LAYOUT }
    assert.equal(body.panelLayout.leftWidth, 311)
    assert.equal(body.panelLayout.rightWidth, 290)
    assert.equal(body.panelLayout.bottomHeight, 175)

    const onDisk = JSON.parse(await readFile(join(stateDir, 'state.json'), 'utf8'))
    assert.equal(onDisk.panelLayout.leftWidth, 311)

    // Subsequent GET reflects the persisted value.
    const next = await client.get('/api/editor-state')
    next.assertStatus(200)
    const nextBody = next.body() as { panelLayout: typeof DEFAULT_PANEL_LAYOUT }
    assert.equal(nextBody.panelLayout.leftWidth, 311)
  })
})
