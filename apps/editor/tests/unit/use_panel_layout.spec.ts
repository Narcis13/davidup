// Unit tests for the editor panel layout helpers.
//
// We don't have a DOM (jsdom is not wired up in this app), so the test
// focuses on the pure helpers in `panelLayoutShape.ts`: clamping, defaults,
// derived grid templates. The pointer-drag glue and persistence write-back
// are covered end-to-end by `tests/functional/editor_state.spec.ts` plus
// manual browser verification (step 08 of the build plan).

import { test } from '@japa/runner'
import {
  clampPanel,
  DEFAULT_PANEL_LAYOUT,
  HANDLE_SIZE,
  makeGridColumns,
  makeGridRows,
  normalizeLayout,
  PANEL_LIMITS,
} from '../../inertia/composables/panelLayoutShape.js'

test.group('panelLayoutShape · clampPanel', () => {
  test('clamps below the minimum', ({ assert }) => {
    assert.equal(clampPanel(0, 'leftWidth'), PANEL_LIMITS.leftWidth.min)
    assert.equal(clampPanel(-50, 'bottomHeight'), PANEL_LIMITS.bottomHeight.min)
  })

  test('clamps above the maximum', ({ assert }) => {
    assert.equal(clampPanel(9999, 'leftWidth'), PANEL_LIMITS.leftWidth.max)
    assert.equal(clampPanel(9999, 'rightWidth'), PANEL_LIMITS.rightWidth.max)
  })

  test('passes values inside the range through unchanged', ({ assert }) => {
    assert.equal(clampPanel(250, 'leftWidth'), 250)
    assert.equal(clampPanel(150, 'bottomHeight'), 150)
  })

  test('falls back to the minimum for non-finite inputs', ({ assert }) => {
    // Drag math could produce NaN if a pointer event arrived without a clientX.
    assert.equal(clampPanel(Number.NaN, 'leftWidth'), PANEL_LIMITS.leftWidth.min)
    assert.equal(clampPanel(Number.POSITIVE_INFINITY, 'rightWidth'), PANEL_LIMITS.rightWidth.min)
  })
})

test.group('panelLayoutShape · normalizeLayout', () => {
  test('returns defaults for missing input', ({ assert }) => {
    assert.deepEqual(normalizeLayout(undefined), DEFAULT_PANEL_LAYOUT)
    assert.deepEqual(normalizeLayout(null), DEFAULT_PANEL_LAYOUT)
    assert.deepEqual(normalizeLayout({}), DEFAULT_PANEL_LAYOUT)
  })

  test('clamps every field independently', ({ assert }) => {
    const out = normalizeLayout({ leftWidth: 5000, rightWidth: 0, bottomHeight: -10 })
    assert.equal(out.leftWidth, PANEL_LIMITS.leftWidth.max)
    assert.equal(out.rightWidth, PANEL_LIMITS.rightWidth.min)
    assert.equal(out.bottomHeight, PANEL_LIMITS.bottomHeight.min)
  })

  test('preserves valid partial inputs and defaults the rest', ({ assert }) => {
    const out = normalizeLayout({ leftWidth: 250 })
    assert.equal(out.leftWidth, 250)
    assert.equal(out.rightWidth, DEFAULT_PANEL_LAYOUT.rightWidth)
    assert.equal(out.bottomHeight, DEFAULT_PANEL_LAYOUT.bottomHeight)
  })
})

test.group('panelLayoutShape · grid templates', () => {
  test('makeGridColumns includes both handle gutters between three panel tracks', ({
    assert,
  }) => {
    assert.equal(
      makeGridColumns({ leftWidth: 200, rightWidth: 300, bottomHeight: 220 }),
      `200px ${HANDLE_SIZE}px 1fr ${HANDLE_SIZE}px 300px`,
    )
  })

  test('makeGridRows includes the bottom handle gutter', ({ assert }) => {
    assert.equal(
      makeGridRows({ leftWidth: 280, rightWidth: 320, bottomHeight: 250 }),
      `1fr ${HANDLE_SIZE}px 250px`,
    )
  })
})
