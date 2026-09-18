// Unit tests for the easing picker's pure helpers — v1.1 S17. The select and
// number-field plumbing in `inputs/Easing.vue` is a thin shell over these.

import { test } from '@japa/runner'
import {
  BEZIER_OPTION,
  DEFAULT_BEZIER,
  DEFAULT_STEPS,
  STEPS_OPTION,
  easingForOption,
  easingOptionValue,
  parseSteps,
  patchBezier,
} from '../../inertia/composables/easingInputMath.js'

test.group('easingInputMath.easingOptionValue', () => {
  test('maps names, object forms and an omitted easing to select values', ({ assert }) => {
    assert.equal(easingOptionValue(undefined), 'linear')
    assert.equal(easingOptionValue('easeOutBack'), 'easeOutBack')
    assert.equal(easingOptionValue({ bezier: [0.25, 0.1, 0.25, 1] }), BEZIER_OPTION)
    assert.equal(easingOptionValue({ steps: 3 }), STEPS_OPTION)
  })
})

test.group('easingInputMath.easingForOption', () => {
  test('switching to an object form seeds it', ({ assert }) => {
    assert.deepEqual(easingForOption(BEZIER_OPTION, 'linear'), { bezier: [...DEFAULT_BEZIER] })
    assert.deepEqual(easingForOption(STEPS_OPTION, { bezier: [0, 0, 1, 1] }), { steps: DEFAULT_STEPS })
  })

  test('the seeded bezier is a fresh array, not the shared default', ({ assert }) => {
    const seeded = easingForOption(BEZIER_OPTION, undefined) as { bezier: number[] }
    seeded.bezier[0] = 0.9
    assert.equal(DEFAULT_BEZIER[0], 0.25)
  })

  test('re-selecting the form in use keeps its numbers', ({ assert }) => {
    const current = { bezier: [0.6, -0.28, 0.735, 0.045] as [number, number, number, number] }
    assert.strictEqual(easingForOption(BEZIER_OPTION, current), current)
    const stepped = { steps: 7 }
    assert.strictEqual(easingForOption(STEPS_OPTION, stepped), stepped)
  })

  test('names pass through; unknown options are ignored', ({ assert }) => {
    assert.equal(easingForOption('easeInOutSine', { steps: 2 }), 'easeInOutSine')
    assert.isNull(easingForOption('easeBogus', 'linear'))
  })
})

test.group('easingInputMath.patchBezier', () => {
  const EASE = { bezier: [0.25, 0.1, 0.25, 1] as [number, number, number, number] }

  test('patches one slot without mutating the input', ({ assert }) => {
    assert.deepEqual(patchBezier(EASE, 1, '1.4'), { bezier: [0.25, 1.4, 0.25, 1] })
    assert.deepEqual(patchBezier(EASE, 2, ' 0,5 '), { bezier: [0.25, 0.1, 0.5, 1] })
    assert.deepEqual(EASE.bezier, [0.25, 0.1, 0.25, 1])
  })

  test('x slots stay in [0, 1]; y slots may overshoot', ({ assert }) => {
    assert.isNull(patchBezier(EASE, 0, '-0.1'))
    assert.isNull(patchBezier(EASE, 2, '1.01'))
    assert.deepEqual(patchBezier(EASE, 3, '-2'), { bezier: [0.25, 0.1, 0.25, -2] })
  })

  test('rejects empty and non-numeric text', ({ assert }) => {
    assert.isNull(patchBezier(EASE, 1, ''))
    assert.isNull(patchBezier(EASE, 1, 'abc'))
    assert.isNull(patchBezier(EASE, 1, 'Infinity'))
  })
})

test.group('easingInputMath.parseSteps', () => {
  test('accepts integers ≥ 1 only', ({ assert }) => {
    assert.deepEqual(parseSteps('4'), { steps: 4 })
    assert.deepEqual(parseSteps(' 12 '), { steps: 12 })
    assert.isNull(parseSteps('0'))
    assert.isNull(parseSteps('2.5'))
    assert.isNull(parseSteps('-3'))
    assert.isNull(parseSteps(''))
  })
})
