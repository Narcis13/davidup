// Unit tests for timeline zoom + snapping math — v1.1 S27.
//
// Pure helpers only (`timelineZoomMath.ts`, plus the edge-aware
// `computeDragValues`); the scroll-container wiring in Timeline.vue is
// exercised by hand / the Playwright smoke.

import { test } from '@japa/runner'
import {
  EDGE_SNAP_PX,
  MAX_PX_PER_SECOND,
  anchoredScrollLeft,
  buildRulerTicks,
  clampPxPerSecond,
  collectEdges,
  effectivePxPerSecond,
  fitPxPerSecond,
  formatTickLabel,
  fpsToNumber,
  nearestEdge,
  rulerTickSpec,
  sliderToZoom,
  snapToFrame,
  zoomStep,
  zoomToSlider,
} from '../../inertia/composables/timelineZoomMath.js'
import { computeDragValues, roundTime } from '../../inertia/composables/timelineDragMath.js'

test.group('timeline zoom — levels', () => {
  test('fpsToNumber parses numbers and rational strings', ({ assert }) => {
    assert.equal(fpsToNumber(60), 60)
    assert.closeTo(fpsToNumber('30000/1001'), 29.97, 0.001)
    assert.equal(fpsToNumber('24'), 24)
    assert.equal(fpsToNumber(0), 0)
    assert.equal(fpsToNumber('abc'), 0)
    assert.equal(fpsToNumber(undefined), 0)
  })

  test('fit level fills the viewport with the whole composition', ({ assert }) => {
    assert.equal(fitPxPerSecond(900, 30), 30)
    assert.equal(fitPxPerSecond(0, 30), 0)
    assert.equal(fitPxPerSecond(900, 0), 0)
  })

  test('zooming out to or past fit collapses to null (fit)', ({ assert }) => {
    assert.isNull(clampPxPerSecond(30, 30))
    assert.isNull(clampPxPerSecond(10, 30))
    assert.equal(clampPxPerSecond(45, 30), 45)
    assert.equal(clampPxPerSecond(1e9, 30), MAX_PX_PER_SECOND)
    assert.isNull(clampPxPerSecond(Number.NaN, 30))
  })

  test('effective zoom is the explicit level or the fit level', ({ assert }) => {
    assert.equal(effectivePxPerSecond(null, 30), 30)
    assert.equal(effectivePxPerSecond(120, 30), 120)
    assert.equal(effectivePxPerSecond(null, 0), 1)
  })

  test('⌘+ / ⌘− step multiplicatively and return to fit', ({ assert }) => {
    const in1 = zoomStep(null, 30, 1)
    assert.equal(in1, 45)
    const in2 = zoomStep(in1, 30, 1)
    assert.equal(in2, 67.5)
    assert.equal(zoomStep(in2, 30, -1), 45)
    assert.isNull(zoomStep(45, 30, -1))
    assert.isNull(zoomStep(null, 30, -1))
    assert.equal(zoomStep(MAX_PX_PER_SECOND, 30, 1), MAX_PX_PER_SECOND)
  })

  test('a 30 s clip can reach frame precision at 60 fps', ({ assert }) => {
    // 900 px lane → fit = 30 px/s = 0.5 px per frame. Enough ⌘+ presses must
    // reach ≥ 10 px per frame (600 px/s).
    let z: number | null = null
    for (let i = 0; i < 20; i += 1) z = zoomStep(z, 30, 1)
    assert.isAtLeast(effectivePxPerSecond(z, 30) / 60, 10)
  })

  test('slider maps log-scale and round-trips', ({ assert }) => {
    assert.equal(zoomToSlider(null, 30), 0)
    assert.equal(zoomToSlider(MAX_PX_PER_SECOND, 30), 1)
    assert.isNull(sliderToZoom(0, 30))
    assert.equal(sliderToZoom(1, 30), MAX_PX_PER_SECOND)
    const mid = sliderToZoom(0.5, 30)!
    assert.closeTo(zoomToSlider(mid, 30), 0.5, 1e-9)
    // geometric midpoint of [30, 2400]
    assert.closeTo(mid, Math.sqrt(30 * MAX_PX_PER_SECOND), 1e-6)
  })

  test('anchored zoom keeps the time under the anchor fixed', ({ assert }) => {
    // At 30 px/s, scrolled 0, anchor 300 px → t = 10 s. At 60 px/s the same
    // 10 s must sit under 300 px again → scrollLeft = 600 − 300.
    assert.equal(anchoredScrollLeft({ scrollLeft: 0, anchorPx: 300, oldPps: 30, newPps: 60 }), 300)
    // Zooming back out clamps at 0.
    assert.equal(anchoredScrollLeft({ scrollLeft: 300, anchorPx: 300, oldPps: 60, newPps: 30 }), 0)
    assert.equal(anchoredScrollLeft({ scrollLeft: 42, anchorPx: 10, oldPps: 0, newPps: 30 }), 42)
  })
})

test.group('timeline zoom — ruler', () => {
  test('major ticks stay ≥ 64 px apart at any zoom', ({ assert }) => {
    for (const pps of [2, 10, 30, 100, 300, 1000, 2400]) {
      const { major } = rulerTickSpec(pps, 30)
      assert.isAtLeast(major * pps, 64, `pps=${pps}`)
    }
    assert.equal(rulerTickSpec(30, 30).major, 5)
    assert.equal(rulerTickSpec(100, 30).major, 1)
  })

  test('minor ticks drop to frames once a frame is ≥ 8 px wide', ({ assert }) => {
    // 30 fps at 300 px/s → 10 px per frame.
    const spec = rulerTickSpec(300, 30)
    assert.closeTo(spec.minor, 1 / 30, 1e-12)
    // 30 fps at 100 px/s → 3.3 px per frame → regular subdivision.
    assert.equal(rulerTickSpec(100, 30).minor, 0.25)
  })

  test('buildRulerTicks covers [0, duration] and flags majors', ({ assert }) => {
    const ticks = buildRulerTicks(2, { major: 1, minor: 0.25 })
    assert.equal(ticks.length, 9)
    assert.deepEqual(
      ticks.filter((t) => t.major).map((t) => t.t),
      [0, 1, 2],
    )
    assert.deepEqual(buildRulerTicks(0, { major: 1, minor: 0.25 }), [])
  })

  test('frame-minor ticks stay aligned with majors', ({ assert }) => {
    const ticks = buildRulerTicks(1, { major: 0.5, minor: 1 / 30 })
    assert.equal(ticks.length, 31)
    assert.deepEqual(
      ticks.filter((t) => t.major).map((t) => t.t),
      [0, 0.5, 1],
    )
  })

  test('majors off the frame grid still render (0.25 s at 30 fps)', ({ assert }) => {
    const ticks = buildRulerTicks(1, { major: 0.25, minor: 1 / 30 })
    assert.deepEqual(
      ticks.filter((t) => t.major).map((t) => t.t),
      [0, 0.25, 0.5, 0.75, 1],
    )
    // 31 frame ticks, 3 of which coincide with majors (0, 0.5, 1) + 2 extra majors.
    assert.equal(ticks.length, 33)
    for (let i = 1; i < ticks.length; i += 1) assert.isAbove(ticks[i].t, ticks[i - 1].t)
  })

  test('tick labels', ({ assert }) => {
    assert.equal(formatTickLabel(0), '0s')
    assert.equal(formatTickLabel(1.5), '1.5s')
    assert.equal(formatTickLabel(0.1), '0.1s')
    assert.equal(formatTickLabel(60), '1:00')
    assert.equal(formatTickLabel(90), '1:30')
  })
})

test.group('timeline snapping', () => {
  test('snapToFrame rounds to the nearest frame boundary', ({ assert }) => {
    assert.closeTo(snapToFrame(0.51, 30), 15 / 30, 1e-12)
    assert.closeTo(snapToFrame(0.52, 30), 16 / 30, 1e-12)
    assert.closeTo(snapToFrame(1.001, 60), 1, 1e-12)
    assert.equal(snapToFrame(0.123, 0), 0.123)
  })

  test('nearestEdge picks the closest edge within the threshold', ({ assert }) => {
    assert.equal(nearestEdge(2.03, [1, 2, 3], 0.05), 2)
    assert.isNull(nearestEdge(2.1, [1, 2, 3], 0.05))
    assert.equal(nearestEdge(2.5, [2.46, 2.53], 0.05), 2.53)
    assert.isNull(nearestEdge(2, [2], 0))
  })

  test('collectEdges excludes the dragged bar and dedupes', ({ assert }) => {
    const edges = collectEdges(
      [
        { id: 'a', start: 0, end: 1 },
        { id: 'b', start: 1, end: 2.5 },
        { id: 'self', start: 0.3, end: 0.7 },
      ],
      'self',
    )
    assert.deepEqual(edges, [0, 1, 2.5])
  })

  test('edge threshold is EDGE_SNAP_PX in screen space', ({ assert }) => {
    // At 30 px/s, 6 px ≈ 0.2 s; at 600 px/s, 0.01 s — zooming in tightens it.
    assert.closeTo(EDGE_SNAP_PX / 30, 0.2, 1e-12)
    assert.closeTo(EDGE_SNAP_PX / 600, 0.01, 1e-12)
  })
})

test.group('computeDragValues — frame grid + edge snapping', () => {
  const base = {
    compositionDuration: 30,
    snapStep: 1 / 30,
    minDuration: 1 / 30,
    snap: true,
  }

  test('move snaps start to a frame boundary without edges', ({ assert }) => {
    const r = computeDragValues({
      ...base,
      mode: 'move',
      originalStart: 1,
      originalDuration: 1,
      timeDelta: 0.51,
    })
    assert.equal(roundTime(r.start * 30), 45)
    assert.equal(r.duration, 1)
  })

  test('move: the bar start catches another bar edge', ({ assert }) => {
    const r = computeDragValues({
      ...base,
      mode: 'move',
      originalStart: 0,
      originalDuration: 1,
      timeDelta: 2.47,
      edges: [2.5],
      edgeThreshold: 0.05,
    })
    assert.equal(r.start, 2.5)
  })

  test('move: the bar end catches another bar edge', ({ assert }) => {
    const r = computeDragValues({
      ...base,
      mode: 'move',
      originalStart: 0,
      originalDuration: 1,
      timeDelta: 3.02,
      edges: [4],
      edgeThreshold: 0.05,
    })
    assert.equal(r.start, 3)
    assert.equal(r.start + r.duration, 4)
  })

  test('move: the closer of the two catches wins', ({ assert }) => {
    // start 2.04 is 0.04 from 2; end 3.04 is 0.01 from 3.05.
    const r = computeDragValues({
      ...base,
      mode: 'move',
      originalStart: 0,
      originalDuration: 1,
      timeDelta: 2.04,
      edges: [2, 3.05],
      edgeThreshold: 0.05,
    })
    assert.closeTo(r.start, 2.05, 1e-12)
  })

  test('resize-right end catches an edge; resize-left start too', ({ assert }) => {
    const right = computeDragValues({
      ...base,
      mode: 'resize-right',
      originalStart: 1,
      originalDuration: 1,
      timeDelta: 0.98,
      edges: [3.01],
      edgeThreshold: 0.05,
    })
    assert.equal(right.start + right.duration, 3.01)
    const left = computeDragValues({
      ...base,
      mode: 'resize-left',
      originalStart: 1,
      originalDuration: 1,
      timeDelta: -0.52,
      edges: [0.49],
      edgeThreshold: 0.05,
    })
    assert.equal(left.start, 0.49)
    assert.equal(left.duration, 1.51)
  })

  test('snap: false (Snap off or ⌥) ignores both edges and grid', ({ assert }) => {
    const r = computeDragValues({
      ...base,
      snap: false,
      mode: 'move',
      originalStart: 0,
      originalDuration: 1,
      timeDelta: 2.47,
      edges: [2.5],
      edgeThreshold: 0.05,
    })
    assert.equal(r.start, 2.47)
  })

  test('edge snapping never pushes past the composition end', ({ assert }) => {
    const r = computeDragValues({
      ...base,
      mode: 'move',
      originalStart: 0,
      originalDuration: 2,
      timeDelta: 28.97,
      edges: [29],
      edgeThreshold: 0.05,
    })
    assert.equal(r.start, 28)
  })
})
