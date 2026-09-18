// Unit tests for the stage polygon tool's pure math (v1.1 S26) and the
// arrow-key helpers `useShortcuts` routes through.

import { test } from '@japa/runner'
import {
  buildPolygonShapePayload,
  canClosePolygon,
  dedupePolygonPoints,
} from '../../inertia/composables/polygonToolMath.js'
import { arrowDelta, nudgeCoalesceKey, nudgeStep } from '../../inertia/composables/useNudge.js'

test.group('polygonToolMath', () => {
  test('drops consecutive near-duplicates and a closing vertex on the first', ({ assert }) => {
    assert.deepEqual(
      dedupePolygonPoints([
        [0, 0],
        [10, 0],
        [10.5, 0.5],
        [10, 10],
        [0.5, 0],
      ]),
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    )
  })

  test('needs three distinct vertices to close', ({ assert }) => {
    assert.isFalse(canClosePolygon([]))
    assert.isFalse(
      canClosePolygon([
        [0, 0],
        [50, 50],
        [50, 50],
      ]),
    )
    assert.isTrue(
      canClosePolygon([
        [0, 0],
        [50, 0],
        [50, 50],
      ]),
    )
    assert.isNull(
      buildPolygonShapePayload('fg', [
        [0, 0],
        [1, 1],
      ]),
    )
  })

  test('centres the item on the bbox and rebases points to its top-left', ({ assert }) => {
    const payload = buildPolygonShapePayload('fg', [
      [120, 40],
      [220, 140],
      [20, 140],
    ])
    assert.deepEqual(payload, {
      layerId: 'fg',
      kind: 'polygon',
      x: 120,
      y: 90,
      width: 200,
      height: 100,
      points: [
        [100, 0],
        [200, 100],
        [0, 100],
      ],
      fillColor: '#5b7cfa',
      anchorX: 0.5,
      anchorY: 0.5,
    })
  })
})

test.group('nudge helpers', () => {
  test('arrow keys map to unit directions; other keys to null', ({ assert }) => {
    assert.deepEqual(arrowDelta('ArrowLeft'), { dx: -1, dy: 0 })
    assert.deepEqual(arrowDelta('ArrowRight'), { dx: 1, dy: 0 })
    assert.deepEqual(arrowDelta('ArrowUp'), { dx: 0, dy: -1 })
    assert.deepEqual(arrowDelta('ArrowDown'), { dx: 0, dy: 1 })
    assert.isNull(arrowDelta('Enter'))
  })

  test('step is 1 px, 10 px with Shift', ({ assert }) => {
    assert.equal(nudgeStep(false), 1)
    assert.equal(nudgeStep(true), 10)
  })

  test('coalesce key is selection-order independent', ({ assert }) => {
    assert.equal(nudgeCoalesceKey(['b', 'a']), nudgeCoalesceKey(['a', 'b']))
    assert.notEqual(nudgeCoalesceKey(['a']), nudgeCoalesceKey(['a', 'b']))
  })
})
