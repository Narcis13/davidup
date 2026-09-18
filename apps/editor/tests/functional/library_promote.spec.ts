/*
|--------------------------------------------------------------------------
| v1.1 S29 — promoting project-library assets and fonts to the global pool
|--------------------------------------------------------------------------
*/

import { test } from '@japa/runner'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
