// Unit tests for the Inspector's client-side helpers in `useCommandBus`.
//
// Step 09 adds the Inspector, which reads nested values out of items via
// `readPath` (so dotted accessors like `transform.opacity` stay readable
// in the field registry) and re-applies the EditorController's asset URL
// rewrite on /api/command responses (so the browser driver keeps
// resolving image / font srcs after a mutation).
//
// Both helpers are pure — no DOM, no fetch — so they unit-test cleanly
// without jsdom.

import { test } from '@japa/runner'
import {
  affectedItemIds,
  readPath,
  rewriteAssetsForBrowser,
  type Command,
} from '../../inertia/composables/useCommandBus.js'

test.group('useCommandBus · readPath', () => {
  test('reads a top-level field', ({ assert }) => {
    assert.equal(readPath({ opacity: 0.5 }, 'opacity'), 0.5)
  })

  test('reads a nested transform field', ({ assert }) => {
    const item = { transform: { x: 100, opacity: 0.5 } }
    assert.equal(readPath(item, 'transform.opacity'), 0.5)
    assert.equal(readPath(item, 'transform.x'), 100)
  })

  test('returns undefined for missing segments', ({ assert }) => {
    assert.isUndefined(readPath({ transform: {} }, 'transform.opacity'))
    assert.isUndefined(readPath({}, 'transform.opacity'))
    assert.isUndefined(readPath(null, 'transform.opacity'))
  })
})

test.group('useCommandBus · rewriteAssetsForBrowser', () => {
  function baseComp() {
    return {
      composition: { width: 1, height: 1, fps: 60, duration: 1, background: '#000' },
      assets: [
        { id: 'ball', type: 'image', src: './ball.png' },
        { id: 'font', type: 'font', src: 'fonts/Display.ttf', family: 'Display' },
        { id: 'remote', type: 'image', src: 'https://cdn.example.com/x.png' },
        { id: 'inline', type: 'image', src: 'data:image/png;base64,iVBOR' },
        { id: 'already', type: 'image', src: '/project-files/cached.png' },
      ],
      layers: [],
      items: {},
      tweens: [],
    }
  }

  test('rewrites relative paths to /project-files/ URLs', ({ assert }) => {
    const out = rewriteAssetsForBrowser(baseComp() as Parameters<typeof rewriteAssetsForBrowser>[0])
    const a = out.assets as Array<{ id: string; src: string }>
    assert.equal(a.find((x) => x.id === 'ball')!.src, '/project-files/ball.png')
    assert.equal(a.find((x) => x.id === 'font')!.src, '/project-files/fonts/Display.ttf')
  })

  test('leaves absolute / data: / already-prefixed URLs alone', ({ assert }) => {
    const out = rewriteAssetsForBrowser(baseComp() as Parameters<typeof rewriteAssetsForBrowser>[0])
    const a = out.assets as Array<{ id: string; src: string }>
    assert.equal(a.find((x) => x.id === 'remote')!.src, 'https://cdn.example.com/x.png')
    assert.equal(a.find((x) => x.id === 'inline')!.src, 'data:image/png;base64,iVBOR')
    assert.equal(a.find((x) => x.id === 'already')!.src, '/project-files/cached.png')
  })

  test('does not mutate the input', ({ assert }) => {
    const input = baseComp()
    const before = JSON.stringify(input)
    rewriteAssetsForBrowser(input as Parameters<typeof rewriteAssetsForBrowser>[0])
    assert.equal(JSON.stringify(input), before)
  })
})

// Per-item attribution for the Inspector "AI edit" pill (step 20.2). The
// composable's `itemLastSource` map is built by calling `affectedItemIds`
// on the echoed command + toolResult — wrong attribution = wrong pill on
// the wrong item, which is the FR-13 user-visible bug.
test.group('useCommandBus · affectedItemIds', () => {
  test('update_item targets payload.id', ({ assert }) => {
    const cmd: Command = {
      kind: 'update_item',
      payload: { id: 'spr-1', props: { opacity: 0.5 } },
      source: 'mcp',
    }
    assert.deepEqual(affectedItemIds(cmd, undefined), ['spr-1'])
  })

  test('remove_item targets payload.id', ({ assert }) => {
    const cmd: Command = {
      kind: 'remove_item',
      payload: { id: 'gone' },
      source: 'ui',
    }
    assert.deepEqual(affectedItemIds(cmd, undefined), ['gone'])
  })

  test('move_item_to_layer reads payload.itemId', ({ assert }) => {
    const cmd: Command = {
      kind: 'move_item_to_layer',
      payload: { itemId: 'spr-2', targetLayerId: 'bg' },
      source: 'mcp',
    }
    assert.deepEqual(affectedItemIds(cmd, undefined), ['spr-2'])
  })

  test('apply_behavior reads payload.target', ({ assert }) => {
    const cmd: Command = {
      kind: 'apply_behavior',
      payload: { target: 'item-x', behavior: 'wobble', start: 0, duration: 1 },
      source: 'mcp',
    }
    assert.deepEqual(affectedItemIds(cmd, undefined), ['item-x'])
  })

  test('add_sprite prefers toolResult.itemId over payload.id', ({ assert }) => {
    const cmd: Command = {
      kind: 'add_sprite',
      payload: { layerId: 'fg', asset: 'ball', x: 0, y: 0, width: 10, height: 10 },
      source: 'mcp',
    }
    assert.deepEqual(affectedItemIds(cmd, { itemId: 'spr-generated' }), ['spr-generated'])
  })

  test('add_shape falls back to payload.id when toolResult has none', ({ assert }) => {
    const cmd: Command = {
      kind: 'add_shape',
      payload: {
        layerId: 'fg',
        kind: 'rect',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        id: 'explicit-id',
      },
      source: 'ui',
    }
    assert.deepEqual(affectedItemIds(cmd, null), ['explicit-id'])
  })

  test('commands that do not target a single item return []', ({ assert }) => {
    const cmd: Command = {
      kind: 'set_composition_property',
      payload: { property: 'duration', value: 5 },
      source: 'ui',
    }
    assert.deepEqual(affectedItemIds(cmd, undefined), [])
  })
})
