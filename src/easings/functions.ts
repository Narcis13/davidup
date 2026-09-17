// Pure easing functions. Each f satisfies f(0) === 0, f(1) === 1.
// Back easings overshoot in the middle but still hit endpoints exactly.
// Formulas follow the canonical easings.net definitions.

import type { Easing, EasingName } from "./names.js";

export type EasingFn = (t: number) => number;

const PI = Math.PI;
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;

export const linear: EasingFn = (t) => t;

export const easeInQuad: EasingFn = (t) => t * t;
export const easeOutQuad: EasingFn = (t) => 1 - (1 - t) * (1 - t);
export const easeInOutQuad: EasingFn = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export const easeInCubic: EasingFn = (t) => t * t * t;
export const easeOutCubic: EasingFn = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic: EasingFn = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeInQuart: EasingFn = (t) => t * t * t * t;
export const easeOutQuart: EasingFn = (t) => 1 - Math.pow(1 - t, 4);
export const easeInOutQuart: EasingFn = (t) =>
  t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;

export const easeInBack: EasingFn = (t) => c3 * t * t * t - c1 * t * t;
export const easeOutBack: EasingFn = (t) =>
  1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
export const easeInOutBack: EasingFn = (t) =>
  t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;

export const easeInSine: EasingFn = (t) => 1 - Math.cos((t * PI) / 2);
export const easeOutSine: EasingFn = (t) => Math.sin((t * PI) / 2);
export const easeInOutSine: EasingFn = (t) => -(Math.cos(PI * t) - 1) / 2;

export const easeInExpo: EasingFn = (t) =>
  t === 0 ? 0 : Math.pow(2, 10 * t - 10);
export const easeOutExpo: EasingFn = (t) =>
  t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
export const easeInOutExpo: EasingFn = (t) => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return t < 0.5
    ? Math.pow(2, 20 * t - 10) / 2
    : (2 - Math.pow(2, -20 * t + 10)) / 2;
};

export const EASINGS: Record<EasingName, EasingFn> = {
  linear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInQuart,
  easeOutQuart,
  easeInOutQuart,
  easeInBack,
  easeOutBack,
  easeInOutBack,
  easeInSine,
  easeOutSine,
  easeInOutSine,
  easeInExpo,
  easeOutExpo,
  easeInOutExpo,
};

// ──────────────── Parametric easings (v1.1 S17) ────────────────

// Solver tolerance on x (time). |dy/dx| is bounded on sane curves, so the
// eased value lands within ~1e-12 of the exact curve — far inside the 1e-6
// CSS-reference tolerance the tests hold it to.
const BEZIER_EPSILON = 1e-12;
const NEWTON_ITERATIONS = 8;
const NEWTON_MIN_SLOPE = 1e-6;
// Enough halvings to shrink [0, 1] below double resolution; bounds the loop
// even if the tolerance is never met.
const BISECTION_ITERATIONS = 64;

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)`, implicit endpoints (0, 0) and (1, 1).
 * Solves x(s) = t for the curve parameter s, then returns y(s). The solver is
 * the one browsers use (WebKit's UnitBezier): Newton–Raphson from s = t, and
 * bisection on [0, 1] when Newton stalls on a flat stretch of x(s) or leaves
 * the unit interval. Bisection always converges because x1, x2 ∈ [0, 1]
 * makes x(s) non-decreasing.
 *
 * Deliberately not the Cardano closed form: that needs cbrt/acos/cos, whose
 * last bit may differ between JS engines. This path uses only + − × ÷ and
 * comparisons, so node and browser renders get identical values. Pure, and
 * no memoization — each call constructs a closure over the coefficients.
 *
 * Input is clamped to [0, 1]; f(0) === 0 and f(1) === 1 exactly.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  // Power-basis coefficients: x(s) = ((ax·s + bx)·s + cx)·s, same for y.
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (s: number): number => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number): number => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number): number => (3 * ax * s + 2 * bx) * s + cx;

  const solveS = (t: number): number => {
    let s = t;
    for (let i = 0; i < NEWTON_ITERATIONS; i++) {
      const err = sampleX(s) - t;
      if (Math.abs(err) < BEZIER_EPSILON) return s;
      const slope = slopeX(s);
      if (Math.abs(slope) < NEWTON_MIN_SLOPE) break;
      s -= err / slope;
      if (s < 0 || s > 1) break;
    }
    let lo = 0;
    let hi = 1;
    s = t;
    for (let i = 0; i < BISECTION_ITERATIONS; i++) {
      const err = sampleX(s) - t;
      if (Math.abs(err) < BEZIER_EPSILON) return s;
      if (err < 0) lo = s;
      else hi = s;
      s = lo + (hi - lo) / 2;
    }
    return s;
  };

  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solveS(t));
  };
}

/**
 * CSS `steps(n)` / `steps(n, jump-end)`: floor(t·n)/n on [0, 1), 1 at t ≥ 1.
 * The value holds at 0 for the first 1/n of the tween, and the jump to 1
 * lands exactly when the tween ends. Input below 0 returns 0.
 */
export function steps(n: number): EasingFn {
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return Math.floor(t * n) / n;
  };
}

export function getEasing(easing: Easing | undefined): EasingFn {
  if (easing === undefined) return linear;
  if (typeof easing === "string") return EASINGS[easing];
  if ("bezier" in easing) {
    const [x1, y1, x2, y2] = easing.bezier;
    return cubicBezier(x1, y1, x2, y2);
  }
  return steps(easing.steps);
}
