// Unit tests for `useStageDrag`'s pure helpers (UX_GAPS §G phase 1).
//
// Same split as `use_timeline_drag.spec.ts`: the DOM-touching half of the
// composable (window pointer listeners, body cursor, click suppressor) is
// exercised end-to-end via Chrome MCP. Here we lock down the deterministic
// math used to translate cursor deltas into committed x/y values:
//
//   - snapValue: rounding to a configurable grid, zero-step disables.
//   - computeDraggedPosition: delta application + snap + Alt-bypass.
//
// If the live composable's call to `computeDraggedPosition` ever drifts
// from this contract, the e2e run catches it on the actual editor page.

import { test } from '@japa/runner'
import {
  computeDraggedPosition,
  roundCoord,
  snapValue,
} from '../../inertia/composables/stageDragMath.js'

test.group('useStageDrag.snapValue', () => {
  test('rounds to nearest step', ({ assert }) => {
    assert.equal(snapValue(640.3, 1), 640)
    assert.equal(snapValue(640.6, 1), 641)
    assert.equal(snapValue(637.5, 5), 640)
    assert.equal(snapValue(632.4, 5), 630)
  })

  test('zero or negative step disables snapping', ({ assert }) => {
    assert.equal(snapValue(1.23456, 0), 1.23456)
    assert.equal(snapValue(1.23456, -1), 1.23456)
  })
})

test.group('useStageDrag.roundCoord', () => {
  test('drops floating-point grit past two decimal places', ({ assert }) => {
    assert.equal(roundCoord(0.1 + 0.2), 0.3)
    assert.equal(roundCoord(640.123456), 640.12)
    assert.equal(roundCoord(640.005), 640.01)
  })
})

test.group('useStageDrag.computeDraggedPosition', () => {
  test('translates by the snapped delta', ({ assert }) => {
    const r = computeDraggedPosition({
      originalX: 640,
      originalY: 360,
      deltaX: 50,
      deltaY: -25,
      snapStep: 1,
      snap: true,
    })
    assert.equal(r.x, 690)
    assert.equal(r.y, 335)
  })

  test('snaps to a 10-px grid', ({ assert }) => {
    const r = computeDraggedPosition({
      originalX: 100,
      originalY: 100,
      deltaX: 23,
      deltaY: 47,
      snapStep: 10,
      snap: true,
    })
    assert.equal(r.x, 120)
    assert.equal(r.y, 150)
  })

  test('alt-bypass preserves sub-pixel delta', ({ assert }) => {
    const r = computeDraggedPosition({
      originalX: 640,
      originalY: 360,
      deltaX: 12.37,
      deltaY: -4.51,
      snapStep: 1,
      snap: false,
    })
    assert.equal(r.x, 652.37)
    assert.equal(r.y, 355.49)
  })

  test('snap=true with snapStep=0 still falls through (no snap)', ({ assert }) => {
    const r = computeDraggedPosition({
      originalX: 0,
      originalY: 0,
      deltaX: 1.7,
      deltaY: 2.3,
      snapStep: 0,
      snap: true,
    })
    assert.equal(r.x, 1.7)
    assert.equal(r.y, 2.3)
  })

  test('negative deltas translate into negative coords', ({ assert }) => {
    const r = computeDraggedPosition({
      originalX: 50,
      originalY: 50,
      deltaX: -120,
      deltaY: -90,
      snapStep: 1,
      snap: true,
    })
    assert.equal(r.x, -70)
    assert.equal(r.y, -40)
  })
})
