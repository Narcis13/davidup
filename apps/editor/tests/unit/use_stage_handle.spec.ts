// Unit tests for `useStageHandle`'s pure math helpers (UX_GAPS §G phase 2).
//
// Same DOM-free split as use_stage_drag.spec.ts: window listeners, body
// cursor, click suppression are exercised end-to-end via Chrome MCP. Here
// we lock down:
//
//   - computeResize for every handle kind with default anchor (0.5, 0.5)
//   - opposite-corner stays fixed for corner handles
//   - aspect-lock when `preserveAspect` is true
//   - minSize clamp
//   - rotation-aware delta projection
//   - computeRotation snapping to 15°
//
// If the live composable's call ever drifts from this contract, Chrome MCP
// run catches it on the actual editor page.

import { test } from '@japa/runner'
import {
  computeResize,
  computeRotation,
  type ItemGeom,
} from '../../inertia/composables/stageHandleMath.js'

function baseGeom(overrides: Partial<ItemGeom> = {}): ItemGeom {
  return {
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    ...overrides,
  }
}

test.group('computeResize: corner handles (anchor=0.5,0.5, no rotation)', () => {
  test('br grows width and height; pivot shifts by delta/2 to keep TL fixed', ({ assert }) => {
    const r = computeResize({
      handle: 'br',
      geom: baseGeom(),
      deltaWorldX: 40,
      deltaWorldY: 20,
      preserveAspect: false,
      minSize: 1,
    })
    assert.equal(r.width, 240)
    assert.equal(r.height, 120)
    // TL was at (0, 50) and must remain there:
    //   new TL = (newX - newW/2, newY - newH/2) = (120-120, 110-60) = (0, 50) ✓
    assert.equal(r.x, 120)
    assert.equal(r.y, 110)
  })

  test('tl shrinks via positive cursor delta; pivot moves toward BR', ({ assert }) => {
    const r = computeResize({
      handle: 'tl',
      geom: baseGeom(),
      deltaWorldX: 20,
      deltaWorldY: 10,
      preserveAspect: false,
      minSize: 1,
    })
    assert.equal(r.width, 180)
    assert.equal(r.height, 90)
    // BR was at (200, 150) and must remain there:
    //   new BR = (newX + newW/2, newY + newH/2) = (110+90, 105+45) = (200,150) ✓
    assert.equal(r.x, 110)
    assert.equal(r.y, 105)
  })

  test('tr: width grows from cdx+, height shrinks from cdy+', ({ assert }) => {
    const r = computeResize({
      handle: 'tr',
      geom: baseGeom(),
      deltaWorldX: 10,
      deltaWorldY: 10,
      preserveAspect: false,
      minSize: 1,
    })
    assert.equal(r.width, 210)
    assert.equal(r.height, 90)
    // BL was at (0, 150); new BL = (newX - newW/2, newY + newH/2) = (105-105, 105+45) = (0, 150) ✓
    assert.equal(r.x, 105)
    assert.equal(r.y, 105)
  })
})

test.group('computeResize: edge handles', () => {
  test('r changes width only, not height', ({ assert }) => {
    const r = computeResize({
      handle: 'r',
      geom: baseGeom(),
      deltaWorldX: 30,
      deltaWorldY: 999,
      preserveAspect: false,
      minSize: 1,
    })
    assert.equal(r.width, 230)
    assert.equal(r.height, 100)
    assert.equal(r.x, 115)
    assert.equal(r.y, 100)
  })

  test('t changes height only, pivot moves down by delta/2', ({ assert }) => {
    const r = computeResize({
      handle: 't',
      geom: baseGeom(),
      deltaWorldX: 999,
      deltaWorldY: 20,
      preserveAspect: false,
      minSize: 1,
    })
    assert.equal(r.width, 200)
    assert.equal(r.height, 80)
    assert.equal(r.x, 100)
    assert.equal(r.y, 110)
  })
})

test.group('computeResize: aspect-lock (Shift)', () => {
  test('br preserves W:H ratio using the larger relative delta', ({ assert }) => {
    // 200x100 starting; cdx=100 → ratioW=1.5, cdy=10 → ratioH=1.1 → use 1.5
    const r = computeResize({
      handle: 'br',
      geom: baseGeom(),
      deltaWorldX: 100,
      deltaWorldY: 10,
      preserveAspect: true,
      minSize: 1,
    })
    assert.equal(r.width, 300)
    assert.equal(r.height, 150)
  })

  test('does not aspect-lock an edge handle', ({ assert }) => {
    const r = computeResize({
      handle: 'r',
      geom: baseGeom(),
      deltaWorldX: 100,
      deltaWorldY: 0,
      preserveAspect: true,
      minSize: 1,
    })
    assert.equal(r.width, 300)
    assert.equal(r.height, 100)
  })
})

test.group('computeResize: clamps to minSize', () => {
  test('br with huge negative delta cannot collapse past minSize', ({ assert }) => {
    const r = computeResize({
      handle: 'br',
      geom: baseGeom(),
      deltaWorldX: -1000,
      deltaWorldY: -1000,
      preserveAspect: false,
      minSize: 5,
    })
    assert.equal(r.width, 5)
    assert.equal(r.height, 5)
  })
})

test.group('computeResize: with rotation', () => {
  test('90° item: world Δx feeds local Δy (height), Δy feeds −Δx (width)', ({ assert }) => {
    // rotation = π/2 means the local x-axis points up in world coords.
    // World delta (10, 0) projects to local (0, -10) → reduces height.
    const r = computeResize({
      handle: 'br',
      geom: baseGeom({ rotation: Math.PI / 2 }),
      deltaWorldX: 10,
      deltaWorldY: 0,
      preserveAspect: false,
      minSize: 1,
    })
    assert.equal(r.width, 200)
    assert.equal(r.height, 90)
  })
})

test.group('computeResize: scale-aware', () => {
  test('scaleX=2: world Δx grows visible width but local w by half that', ({ assert }) => {
    const r = computeResize({
      handle: 'r',
      geom: baseGeom({ scaleX: 2, width: 100 }),
      deltaWorldX: 40,
      deltaWorldY: 0,
      preserveAspect: false,
      minSize: 1,
    })
    // visible width was 200; cursor moves the right edge by 40 → visible 240
    // local width = 240 / 2 = 120
    assert.equal(r.width, 120)
  })
})

test.group('computeRotation', () => {
  test('quarter turn: cursor from +x axis to +y axis adds π/2', ({ assert }) => {
    const r = computeRotation({
      geom: baseGeom(),
      startCursorX: 200,
      startCursorY: 100,
      cursorX: 100,
      cursorY: 200,
      snap15: false,
    })
    // Expect rotation + π/2; original is 0, so r ≈ π/2
    assert.closeTo(r, Math.PI / 2, 1e-3)
  })

  test('snap15 rounds to the nearest 15° multiple', ({ assert }) => {
    // 22° → nearest 15° step (15° or 30°) → 15°.  22−15=7, 30−22=8 → 15° wins.
    const angleDeg = 22
    const r = computeRotation({
      geom: baseGeom(),
      startCursorX: 200,
      startCursorY: 100,
      cursorX: 100 + Math.cos((angleDeg * Math.PI) / 180) * 100,
      cursorY: 100 + Math.sin((angleDeg * Math.PI) / 180) * 100,
      snap15: true,
    })
    const expected = (15 * Math.PI) / 180
    assert.closeTo(r, expected, 1e-4)
  })
})
