import { test } from '@japa/runner'
import { mkdtemp, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import projectStore from '#services/project_store'

const HELLO_WORLD_SRC = resolve(import.meta.dirname, '../../../../examples/hello-world.json')

test.group('Project loader · hello-world fixture', (group) => {
  group.each.setup(async () => {
    await projectStore.unload()
  })

  test('loads the canonical engine hello-world example', async ({ client, assert }) => {
    const dir = await mkdtemp(join(tmpdir(), 'davidup-hello-'))
    await copyFile(HELLO_WORLD_SRC, join(dir, 'composition.json'))
    try {
      const res = await client.post('/api/project').json({ directory: dir })
      res.assertStatus(200)
      const body = res.body()
      assert.equal(body.root, dir)
      assert.equal(body.composition.composition.duration, 3)
      assert.equal(body.composition.tweens.length, 3)
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
