// Unit tests for the easing curve editor's pure helpers — v1.1 S28. The SVG
// and pointer plumbing in `EasingCurve.vue` is a thin shell over these.

import { test } from '@japa/runner'
import {
  BASE_Y_MAX,
  BASE_Y_MIN,
  bezierHandleCommand,
  curveYRange,
  dragBezierHandle,
  easingPath,
  fromSvg,
  toSvg,
  tweenProgressAt,
  tweenTimeAt,
  type CurveBox,
} from '../../inertia/composables/easingCurveMath.js'

const EASE = { bezier: [0.25, 0.1, 0.25, 1] as [number, number, number, number] }
const BOX: CurveBox = { width: 240, height: 160, pad: 10, yMin: -0.25, yMax: 1.25 }

test.group('easingCurveMath.bezierHandleCommand', () => {
  test('a finished drag maps to one update_tween carrying the whole bezier', ({ assert }) => {
    const after = dragBezierHandle(EASE, 'p1', 0.4, 0.8, BOX)
    assert.deepEqual(bezierHandleCommand('tw-1', EASE, after), {
      kind: 'update_tween',
      payload: { id: 'tw-1', props: { easing: { bezier: [0.4, 0.8, 0.25, 1] } } },
      source: 'ui',
    })
  })

  test('the command holds a copy, not the draft array', ({ assert }) => {
    const after = dragBezierHandle(EASE, 'p2', 0.9, 0.2, BOX)
    const command = bezierHandleCommand('tw-1', EASE, after)!
    after.bezier[0] = 0.99
    const props = command.payload.props as { easing: { bezier: number[] } }
    assert.deepEqual(props.easing.bezier, [0.25, 0.1, 0.9, 0.2])
  })

  test('a drag that ends where it started sends nothing', ({ assert }) => {
    assert.isNull(bezierHandleCommand('tw-1', EASE, { bezier: [0.25, 0.1, 0.25, 1] }))
  })

  test('pointer px → handle → command, end to end', ({ assert }) => {
    // Pointer over unit-space (0.5, 1.1) moves P2 there.
    const px = toSvg(BOX, 0.5, 1.1)
    const p = fromSvg(BOX, px.x, px.y)
    const after = dragBezierHandle(EASE, 'p2', p.t, p.value, BOX)
    assert.deepEqual(bezierHandleCommand('tw-9', EASE, after)?.payload, {
      id: 'tw-9',
      props: { easing: { bezier: [0.25, 0.1, 0.5, 1.1] } },
    })
  })
})

test.group('easingCurveMath.dragBezierHandle', () => {
  test('moves only the dragged control point and does not mutate the input', ({ assert }) => {
    assert.deepEqual(dragBezierHandle(EASE, 'p1', 0.1, 0.2, BOX).bezier, [0.1, 0.2, 0.25, 1])
    assert.deepEqual(dragBezierHandle(EASE, 'p2', 0.7, 0.3, BOX).bezier, [0.25, 0.1, 0.7, 0.3])
    assert.deepEqual(EASE.bezier, [0.25, 0.1, 0.25, 1])
  })

  test('x is clamped to [0, 1]; y to the visible range', ({ assert }) => {
    assert.deepEqual(dragBezierHandle(EASE, 'p1', -0.3, 5, BOX).bezier, [0, 1.25, 0.25, 1])
    assert.deepEqual(dragBezierHandle(EASE, 'p2', 1.4, -9, BOX).bezier, [0.25, 0.1, 1, -0.25])
  })

  test('rounds to 3 decimals and never emits -0', ({ assert }) => {
    const next = dragBezierHandle(EASE, 'p1', 0.123456, -0.0001, BOX)
    assert.deepEqual(next.bezier, [0.123, 0, 0.25, 1])
    assert.isFalse(Object.is(next.bezier[1], -0))
  })
})

test.group('easingCurveMath.geometry', () => {
  test('toSvg / fromSvg round-trip; (0,0) bottom-left, (1,1) top-right', ({ assert }) => {
    const o = toSvg(BOX, 0, 0)
    const e = toSvg(BOX, 1, 1)
    assert.equal(o.x, 10)
    assert.isAbove(o.y, e.y)
    assert.equal(e.x, 230)
    const back = fromSvg(BOX, toSvg(BOX, 0.3, 0.7).x, toSvg(BOX, 0.3, 0.7).y)
    assert.closeTo(back.t, 0.3, 1e-9)
    assert.closeTo(back.value, 0.7, 1e-9)
  })

  test('y range is the base range for curves inside [0, 1]', ({ assert }) => {
    assert.deepEqual(curveYRange('linear'), { yMin: BASE_Y_MIN, yMax: BASE_Y_MAX })
    assert.deepEqual(curveYRange(undefined), { yMin: BASE_Y_MIN, yMax: BASE_Y_MAX })
    assert.deepEqual(curveYRange({ steps: 3 }), { yMin: BASE_Y_MIN, yMax: BASE_Y_MAX })
  })

  test('y range widens for overshoot and out-of-range control points', ({ assert }) => {
    // easeInBack dips to ≈ -0.1, inside the base headroom.
    assert.equal(curveYRange('easeInBack').yMin, BASE_Y_MIN)
    const wide = curveYRange({ bezier: [0.3, -1, 0.7, 2] })
    assert.isBelow(wide.yMin, -1)
    assert.isAbove(wide.yMax, 2)
  })

  test('curve path starts at (0,0) and ends at (1,1)', ({ assert }) => {
    const d = easingPath(BOX, 'easeOutCubic')
    const o = toSvg(BOX, 0, 0)
    const e = toSvg(BOX, 1, 1)
    // Path coordinates are rounded to 2 decimals.
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
    assert.closeTo(nums[0], o.x, 0.005)
    assert.closeTo(nums[1], o.y, 0.005)
    assert.closeTo(nums[nums.length - 2], e.x, 0.005)
    assert.closeTo(nums[nums.length - 1], e.y, 0.005)
  })

  test('steps draw as a staircase: two points per step plus the final jump', ({ assert }) => {
    const d = easingPath(BOX, { steps: 4 })
    assert.lengthOf(d.split(' L'), 4 * 2 + 1)
  })
})

test.group('easingCurveMath.scrub', () => {
  const TWEEN = { start: 2, duration: 4 }

  test('playhead → progress inside the window, null outside', ({ assert }) => {
    assert.equal(tweenProgressAt(TWEEN, 2), 0)
    assert.equal(tweenProgressAt(TWEEN, 3), 0.25)
    assert.equal(tweenProgressAt(TWEEN, 6), 1)
    assert.isNull(tweenProgressAt(TWEEN, 1.9))
    assert.isNull(tweenProgressAt(TWEEN, 6.1))
    assert.isNull(tweenProgressAt({ start: 0, duration: 0 }, 0))
  })

  test('scrub position → composition time, clamped to the tween', ({ assert }) => {
    assert.equal(tweenTimeAt(TWEEN, 0.5), 4)
    assert.equal(tweenTimeAt(TWEEN, -1), 2)
    assert.equal(tweenTimeAt(TWEEN, 3), 6)
  })
})
