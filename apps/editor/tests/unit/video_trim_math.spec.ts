// Unit tests for the pure helpers behind `useVideoTrimDrag` — U5 (Timeline
// video item trim handles). Mirrors `use_timeline_drag.spec.ts`'s split: the
// DOM-touching pointer plumbing is exercised manually in the booted editor;
// this file locks down the deterministic clamping math.

import { test } from '@japa/runner'
import { computeTrimIn, computeTrimOut, snapTrim } from '../../inertia/composables/videoTrimMath.js'

test.group('videoTrimMath.snapTrim', () => {
  test('rounds to nearest step', ({ assert }) => {
    assert.equal(snapTrim(1.06, 0.25), 1.0)
    assert.equal(snapTrim(1.13, 0.25), 1.25)
  })

  test('zero or negative step disables snapping', ({ assert }) => {
    assert.equal(snapTrim(1.23456, 0), 1.23456)
    assert.equal(snapTrim(1.23456, -1), 1.23456)
  })
})

test.group('videoTrimMath.computeTrimIn', () => {
  test('shifts trimIn by the snapped delta', ({ assert }) => {
    const v = computeTrimIn({
      originalTrimIn: 1.0,
      trimOutBound: 5.0,
      timeDelta: 0.6,
      snapStep: 0.25,
      snap: true,
    })
    assert.equal(v, 1.5)
  })

  test('clamps at zero — cannot trim before the start of the source', ({ assert }) => {
    const v = computeTrimIn({
      originalTrimIn: 0.2,
      trimOutBound: 5.0,
      timeDelta: -2.0,
      snapStep: 0.25,
      snap: true,
    })
    assert.equal(v, 0)
  })

  test('cannot cross trimOut — clamps to trimOut minus the minimum window', ({ assert }) => {
    const v = computeTrimIn({
      originalTrimIn: 4.5,
      trimOutBound: 5.0,
      timeDelta: 10,
      snapStep: 0.25,
      snap: true,
    })
    assert.isBelow(v, 5.0)
    assert.isAtLeast(v, 4.9)
  })

  test('Alt (snap: false) allows sub-step precision', ({ assert }) => {
    const v = computeTrimIn({
      originalTrimIn: 1.0,
      trimOutBound: 5.0,
      timeDelta: 0.13,
      snapStep: 0.25,
      snap: false,
    })
    assert.equal(v, 1.13)
  })
})

test.group('videoTrimMath.computeTrimOut', () => {
  test('shifts trimOut by the snapped delta', ({ assert }) => {
    const v = computeTrimOut({
      originalTrimOut: 5.0,
      trimInBound: 1.0,
      timeDelta: -0.5,
      assetDuration: 12,
      snapStep: 0.25,
      snap: true,
    })
    assert.equal(v, 4.5)
  })

  test('clamps to the asset duration when known', ({ assert }) => {
    const v = computeTrimOut({
      originalTrimOut: 11.5,
      trimInBound: 0,
      timeDelta: 5,
      assetDuration: 12,
      snapStep: 0.25,
      snap: true,
    })
    assert.equal(v, 12)
  })

  test('no clamp when asset duration is unknown (null)', ({ assert }) => {
    const v = computeTrimOut({
      originalTrimOut: 100,
      trimInBound: 0,
      timeDelta: 500,
      assetDuration: null,
      snapStep: 0.25,
      snap: true,
    })
    assert.equal(v, 600)
  })

  test('cannot cross trimIn — clamps to trimIn plus the minimum window', ({ assert }) => {
    const v = computeTrimOut({
      originalTrimOut: 1.2,
      trimInBound: 1.0,
      timeDelta: -5,
      assetDuration: 12,
      snapStep: 0.25,
      snap: true,
    })
    assert.isAbove(v, 1.0)
    assert.isBelow(v, 1.1)
  })
})
