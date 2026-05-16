// Unit tests for `useTimelineDrag`'s pure helpers — step 11.
//
// The DOM-touching parts of the composable (window pointer listeners, cursor
// styling, click suppression) are exercised end-to-end through the Chrome MCP
// verification. Here we lock down the deterministic math:
//
//   - snapValue: rounding to a configurable grid, zero-step disables.
//   - computeDragValues: per-mode delta application + clamp + min-duration.
//
// If this file ever drifts from the live composable, the e2e run catches
// regressions on the actual editor page.

import { test } from '@japa/runner'
import {
  computeDragValues,
  snapValue,
  roundTime,
} from '../../inertia/composables/timelineDragMath.js'

test.group('useTimelineDrag.snapValue', () => {
  test('rounds to nearest step', ({ assert }) => {
    assert.equal(snapValue(1.06, 0.25), 1.0)
    assert.equal(snapValue(1.13, 0.25), 1.25)
    assert.equal(snapValue(1.37, 0.25), 1.25)
    assert.equal(snapValue(1.38, 0.25), 1.5)
  })

  test('respects custom step', ({ assert }) => {
    assert.equal(snapValue(0.4, 0.1), roundTime(0.4))
    assert.equal(snapValue(0.43, 0.1), 0.4)
    assert.equal(snapValue(0.46, 0.1), 0.5)
  })

  test('zero or negative step disables snapping', ({ assert }) => {
    assert.equal(snapValue(1.23456, 0), 1.23456)
    assert.equal(snapValue(1.23456, -0.5), 1.23456)
  })
})

test.group('useTimelineDrag.computeDragValues — move', () => {
  test('shifts start by the snapped delta', ({ assert }) => {
    const r = computeDragValues({
      mode: 'move',
      originalStart: 1.0,
      originalDuration: 2.0,
      timeDelta: 0.6,
      compositionDuration: 10,
      snapStep: 0.25,
      minDuration: 0.25,
      snap: true,
    })
    assert.equal(r.start, 1.5)
    assert.equal(r.duration, 2.0)
  })

  test('clamps start at 0 (cannot drag past the timeline left edge)', ({ assert }) => {
    const r = computeDragValues({
      mode: 'move',
      originalStart: 0.5,
      originalDuration: 1.5,
      timeDelta: -2.0,
      compositionDuration: 10,
      snapStep: 0.25,
      minDuration: 0.25,
      snap: true,
    })
    assert.equal(r.start, 0)
    assert.equal(r.duration, 1.5)
  })

  test('clamps end at composition duration (cannot drag past right edge)', ({
    assert,
  }) => {
    const r = computeDragValues({
      mode: 'move',
      originalStart: 8,
      originalDuration: 2,
      timeDelta: 5,
      compositionDuration: 10,
      snapStep: 0.25,
      minDuration: 0.25,
      snap: true,
    })
    assert.equal(r.start, 8)
    assert.equal(r.duration, 2)
  })

  test('alt-key bypasses snap', ({ assert }) => {
    const r = computeDragValues({
      mode: 'move',
      originalStart: 1.0,
      originalDuration: 2.0,
      timeDelta: 0.137,
      compositionDuration: 10,
      snapStep: 0.25,
      minDuration: 0.25,
      snap: false,
    })
    assert.equal(r.start, 1.137)
    assert.equal(r.duration, 2.0)
  })
})

test.group('useTimelineDrag.computeDragValues — resize-left', () => {
  test('drags start later, keeping end fixed', ({ assert }) => {
    const r = computeDragValues({
      mode: 'resize-left',
      originalStart: 1.0,
      originalDuration: 2.0,
      timeDelta: 0.5,
      compositionDuration: 10,
      snapStep: 0.25,
      minDuration: 0.25,
      snap: true,
    })
    assert.equal(r.start, 1.5)
    assert.equal(r.duration, 1.5)
  })

  test('clamps to start >= 0 (extending past the timeline left edge)', ({
    assert,
  }) => {
    const r = computeDragValues({
      mode: 'resize-left',
      originalStart: 0.5,
      originalDuration: 1.5,
      timeDelta: -2,
      compositionDuration: 10,
      snapStep: 0.25,
      minDuration: 0.25,
      snap: true,
    })
    assert.equal(r.start, 0)
    assert.equal(r.duration, 2)
  })

  test('cannot shrink below minDuration', ({ assert }) => {
    const r = computeDragValues({
      mode: 'resize-left',
      originalStart: 1.0,
      originalDuration: 1.0,
      timeDelta: 5,
      compositionDuration: 10,
      snapStep: 0.25,
      minDuration: 0.25,
      snap: true,
    })
    assert.equal(r.start, 1.75)
    assert.equal(r.duration, 0.25)
  })
})

test.group('useTimelineDrag.computeDragValues — resize-right', () => {
  test('extends duration', ({ assert }) => {
    const r = computeDragValues({
      mode: 'resize-right',
      originalStart: 1.0,
      originalDuration: 2.0,
      timeDelta: 0.5,
      compositionDuration: 10,
      snapStep: 0.25,
      minDuration: 0.25,
      snap: true,
    })
    assert.equal(r.start, 1.0)
    assert.equal(r.duration, 2.5)
  })

  test('clamps end to composition duration', ({ assert }) => {
    const r = computeDragValues({
      mode: 'resize-right',
      originalStart: 8,
      originalDuration: 1,
      timeDelta: 5,
      compositionDuration: 10,
      snapStep: 0.25,
      minDuration: 0.25,
      snap: true,
    })
    assert.equal(r.start, 8)
    assert.equal(r.duration, 2)
  })

  test('cannot shrink below minDuration', ({ assert }) => {
    const r = computeDragValues({
      mode: 'resize-right',
      originalStart: 1.0,
      originalDuration: 1.0,
      timeDelta: -5,
      compositionDuration: 10,
      snapStep: 0.25,
      minDuration: 0.25,
      snap: true,
    })
    assert.equal(r.start, 1.0)
    assert.equal(r.duration, 0.25)
  })

  test('alt-key bypasses snap on right-edge resize', ({ assert }) => {
    const r = computeDragValues({
      mode: 'resize-right',
      originalStart: 1.0,
      originalDuration: 1.0,
      timeDelta: 0.331,
      compositionDuration: 10,
      snapStep: 0.25,
      minDuration: 0.25,
      snap: false,
    })
    assert.equal(roundTime(r.duration), 1.331)
  })
})
