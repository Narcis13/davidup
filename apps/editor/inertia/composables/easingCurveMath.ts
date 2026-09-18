// Pure helpers for the easing curve editor (`EasingCurve.vue`) — v1.1 S28.
//
// Kept in its own file so the unit tests can import this module without the
// SFC (japa can't load `.vue`). Same split as `easingInputMath.ts`.
//
// The curve is drawn in a unit box: x = normalised tween time t ∈ [0, 1],
// y = eased progress. The visible y range always covers [0, 1] plus
// headroom, and grows to fit overshooting curves (back easings, a bezier
// with y outside [0, 1]). Samples come from the engine's own `getEasing`, so
// the preview is the exact curve the renderer uses.

import { getEasing } from 'davidup/easings'
import type { BezierEasing, Easing } from 'davidup/easings'
import type { Command } from './useCommandBus.js'

export interface CurveBox {
  width: number
  height: number
  /** Inset on every side, in px, so handles near the edge stay grabbable. */
  pad: number
  /** Visible y range (eased value), bottom → top. */
  yMin: number
  yMax: number
}

export type BezierHandle = 'p1' | 'p2'

/** Minimum y range: [0, 1] with a quarter of headroom above and below. */
export const BASE_Y_MIN = -0.25
export const BASE_Y_MAX = 1.25
/** Samples along t for the drawn path; steps easings add their own jumps. */
export const CURVE_SAMPLES = 96
/** Bezier handle values are rounded to this many decimals. */
export const HANDLE_DECIMALS = 3

/**
 * The y range to draw `easing` in: [BASE_Y_MIN, BASE_Y_MAX], widened to the
 * curve's sampled extremes and — for a bezier — its control points, with a
 * 10 % margin on the widened side.
 */
export function curveYRange(easing: Easing | undefined): { yMin: number; yMax: number } {
  const f = getEasing(easing)
  let lo = 0
  let hi = 1
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const y = f(i / CURVE_SAMPLES)
    if (y < lo) lo = y
    if (y > hi) hi = y
  }
  if (isBezier(easing)) {
    lo = Math.min(lo, easing.bezier[1], easing.bezier[3])
    hi = Math.max(hi, easing.bezier[1], easing.bezier[3])
  }
  const margin = 0.1 * (hi - lo)
  return {
    yMin: Math.min(BASE_Y_MIN, lo - (lo < 0 ? margin : 0)),
    yMax: Math.max(BASE_Y_MAX, hi + (hi > 1 ? margin : 0)),
  }
}

/** Unit-space point (t, value) → SVG px. y grows downward in SVG. */
export function toSvg(box: CurveBox, t: number, value: number): { x: number; y: number } {
  const w = box.width - 2 * box.pad
  const h = box.height - 2 * box.pad
  return {
    x: box.pad + t * w,
    y: box.pad + ((box.yMax - value) / (box.yMax - box.yMin)) * h,
  }
}

/** SVG px → unit-space point. Inverse of `toSvg`; not clamped. */
export function fromSvg(box: CurveBox, x: number, y: number): { t: number; value: number } {
  const w = box.width - 2 * box.pad
  const h = box.height - 2 * box.pad
  return {
    t: (x - box.pad) / w,
    value: box.yMax - ((y - box.pad) / h) * (box.yMax - box.yMin),
  }
}

/**
 * SVG path `d` for the easing over t ∈ [0, 1]. Steps easings are drawn as a
 * staircase (vertical risers at each jump) instead of sampled diagonals.
 */
export function easingPath(box: CurveBox, easing: Easing | undefined): string {
  const points: Array<{ x: number; y: number }> = []
  if (isSteps(easing)) {
    const n = easing.steps
    for (let k = 0; k < n; k++) {
      const v = k / n
      points.push(toSvg(box, k / n, v), toSvg(box, (k + 1) / n, v))
    }
    points.push(toSvg(box, 1, 1))
  } else {
    const f = getEasing(easing)
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const t = i / CURVE_SAMPLES
      points.push(toSvg(box, t, f(t)))
    }
  }
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x, 2)} ${round(p.y, 2)}`)
    .join(' ')
}

/**
 * Move one bezier control point to the unit-space pointer position. x is
 * clamped to [0, 1] (the engine rejects anything else), y to the visible
 * range; both are rounded to HANDLE_DECIMALS. Returns a new easing — the
 * input is not mutated.
 */
export function dragBezierHandle(
  easing: BezierEasing,
  handle: BezierHandle,
  t: number,
  value: number,
  yRange: { yMin: number; yMax: number }
): BezierEasing {
  const x = round(clamp(t, 0, 1), HANDLE_DECIMALS)
  const y = round(clamp(value, yRange.yMin, yRange.yMax), HANDLE_DECIMALS)
  const [x1, y1, x2, y2] = easing.bezier
  return { bezier: handle === 'p1' ? [x, y, x2, y2] : [x1, y1, x, y] }
}

/** True when two bezier easings have the same four numbers. */
export function sameBezier(a: BezierEasing, b: BezierEasing): boolean {
  return a.bezier.every((v, i) => v === b.bezier[i])
}

/**
 * The single `update_tween` a finished handle drag commits — the whole
 * easing object, so one drag is one undo step. Returns null when the drag
 * ended where it started (a click on a handle), so no no-op edit is sent.
 */
export function bezierHandleCommand(
  tweenId: string,
  before: BezierEasing,
  after: BezierEasing
): Command | null {
  if (sameBezier(before, after)) return null
  return {
    kind: 'update_tween',
    payload: { id: tweenId, props: { easing: { bezier: [...after.bezier] } } },
    source: 'ui',
  }
}

/**
 * Where the playhead sits inside a tween, as normalised t ∈ [0, 1], or null
 * when it is outside the tween's window (or the tween has no duration).
 */
export function tweenProgressAt(
  tween: { start: number; duration: number },
  playhead: number
): number | null {
  if (!(tween.duration > 0)) return null
  const t = (playhead - tween.start) / tween.duration
  if (t < 0 || t > 1) return null
  return t
}

/** Composition time for normalised t within a tween (t is clamped). */
export function tweenTimeAt(tween: { start: number; duration: number }, t: number): number {
  return tween.start + clamp(t, 0, 1) * tween.duration
}

function isBezier(easing: Easing | undefined): easing is BezierEasing {
  return typeof easing === 'object' && easing !== null && 'bezier' in easing
}

function isSteps(easing: Easing | undefined): easing is { steps: number } {
  return typeof easing === 'object' && easing !== null && 'steps' in easing
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function round(v: number, decimals: number): number {
  const k = 10 ** decimals
  const r = Math.round(v * k) / k
  // Avoid emitting -0 into JSON-facing values.
  return r === 0 ? 0 : r
}
