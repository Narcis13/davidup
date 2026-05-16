// Functional tests for the library drag-drop flow — step 14.
//
// Exercises the full path the editor takes when a user drops a library
// card on a track / stage:
//
//   1. ProjectStore loads a project that has a `library/` subtree.
//   2. LibraryIndex auto-registers templates + scenes into the engine
//      registry (the step 8 piece of the plan).
//   3. The composable's command builder produces an `apply_template`
//      command.
//   4. CommandBus.apply runs it through the engine and returns a new
//      composition that includes the expanded items + tweens.
//
// This is the precise sequence the live UI runs on every drop, minus the
// HTML5 DnD plumbing (Chrome MCP verifies that end of the pipeline live).

import { test } from '@japa/runner'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import projectStore from '#services/project_store'
import libraryIndex from '#services/library_index'
import commandBus from '#services/command_bus'
import {
  buildCommandsForNewTrackDrop,
  buildCommandsForTrackDrop,
  type LibraryDragPayload,
} from '../../inertia/composables/useLibraryDrag.js'

const BASE_COMP = {
  version: '0.1',
  composition: {
    width: 1280,
    height: 720,
    fps: 60,
    duration: 6,
    background: '#0a0e27',
  },
  assets: [],
  layers: [{ id: 'fg', z: 10, opacity: 1, blendMode: 'normal', items: [] as string[] }],
  items: {} as Record<string, unknown>,
  tweens: [],
}

async function makeProjectWithLibrary(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'davidup-libdrop-'))
  await writeFile(join(dir, 'composition.json'), JSON.stringify(BASE_COMP, null, 2), 'utf8')
  const libDir = join(dir, 'library')
  await mkdir(join(libDir, 'templates'), { recursive: true })
  await mkdir(join(libDir, 'scenes'), { recursive: true })
  await writeFile(
    join(libDir, 'index.json'),
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
  await writeFile(
    join(libDir, 'templates', 'title-card.template.json'),
    JSON.stringify({
      id: 'titleCard',
      name: 'Title card',
      // Shape-only template so the test doesn't depend on a font asset being
      // registered (the engine's validator rejects text items that reference
      // an unknown font family).
      params: [
        { name: 'title', type: 'string', required: true },
        { name: 'color', type: 'color', default: '#ff6b35' },
      ],
      items: {
        title: {
          type: 'shape',
          kind: 'rect',
          width: 640,
          height: 160,
          cornerRadius: 12,
          fillColor: '${params.color}',
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
    }),
    'utf8'
  )
  return dir
}

function titleCardPayload(): LibraryDragPayload {
  return {
    kind: 'template',
    id: 'titleCard',
    name: 'Title card',
    defaults: {
      // Brand-defaults pre-bind: required `title` gets the item's name; the
      // rest pass through their per-descriptor defaults.
      title: 'Title card',
      color: '#ff6b35',
    },
  }
}

test.group('Library drop → composition mutation (step 14)', (group) => {
  group.each.setup(async () => {
    await libraryIndex.detach()
    await projectStore.unload()
  })

  test('dropping a template on the new-track zone applies it via the bus', async ({
    assert,
  }) => {
    const dir = await makeProjectWithLibrary()
    try {
      await projectStore.load(dir)
      // LibraryIndex registers templates as part of attach() inside load().
      // Sanity-check the registry actually sees titleCard.
      const { hasTemplate } = await import('davidup/compose')
      assert.isTrue(hasTemplate('titleCard'), 'library template registered')

      const commands = buildCommandsForNewTrackDrop(titleCardPayload(), {
        layerId: 'fg',
        start: 0,
      })
      assert.lengthOf(commands, 1)

      const result = await commandBus.apply(commands[0]!)
      // Expanded template prefixes its local item id with the instance id.
      // We don't pin the exact id (it includes a timestamp) so we look for
      // any item whose key ends in `__title`.
      const items = (result.composition as { items: Record<string, unknown> }).items
      const titleKeys = Object.keys(items).filter((k) => k.endsWith('__title'))
      assert.isAtLeast(
        titleKeys.length,
        1,
        'composition should include the template-expanded title item'
      )
      const layer = (result.composition as {
        layers: Array<{ id: string; items: string[] }>
      }).layers.find((l) => l.id === 'fg')
      assert.isAtLeast(layer!.items.length, 1)
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('dropping a built-in behavior on an existing track adds tweens', async ({
    assert,
  }) => {
    const compWithItem = {
      ...BASE_COMP,
      layers: [{ id: 'fg', z: 10, opacity: 1, blendMode: 'normal', items: ['logo'] }],
      items: {
        logo: {
          type: 'shape',
          kind: 'rect',
          width: 200,
          height: 200,
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
    }
    const dir = await mkdtemp(join(tmpdir(), 'davidup-libdrop-beh-'))
    try {
      await writeFile(
        join(dir, 'composition.json'),
        JSON.stringify(compWithItem, null, 2),
        'utf8'
      )
      await projectStore.load(dir)

      // The library catalog hasn't been attached here, but built-in
      // behaviors (like `fadeIn`) don't need registration — they live in
      // src/compose/behaviors.ts and the engine looks them up by name.
      const payload: LibraryDragPayload = {
        kind: 'behavior',
        id: 'fadeIn',
        name: 'Fade in',
        defaults: { duration: 0.5, easing: 'easeOutQuad' },
      }
      const commands = buildCommandsForTrackDrop(payload, {
        targetItemId: 'logo',
        defaultLayerId: 'fg',
        start: 0.4,
      })
      assert.lengthOf(commands, 1)

      const before = (projectStore.composition as { tweens: unknown[] }).tweens.length
      const result = await commandBus.apply(commands[0]!)
      const after = (result.composition as { tweens: unknown[] }).tweens.length
      assert.isAtLeast(after, before + 1, 'behavior should add at least one tween')

      // The added tween should target our row's item.
      const tweens = (result.composition as {
        tweens: Array<{ target: string; id: string }>
      }).tweens
      const ours = tweens.find((t) => t.target === 'logo')
      assert.exists(ours, 'a tween targeting `logo` should exist')
    } finally {
      await projectStore.unload()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
