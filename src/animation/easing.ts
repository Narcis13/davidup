/**
 * Easing functions based on Robert Penner's equations.
 * Transform linear progress (0-1) into curved motion for natural-feeling animations.
 *
 * @module animation/easing
 */

import type { EasingFunction, EasingName } from './types.js';

/**
 * Linear easing - no acceleration.
 * Returns the input unchanged.
 */
export const linear: EasingFunction = (t) => t;

/**
 * Quadratic ease-in.
 * Starts slow and accelerates.
 */
export const easeIn: EasingFunction = (t) => t * t;

/**
 * Quadratic ease-out.
 * Starts fast and decelerates.
 */
export const easeOut: EasingFunction = (t) => t * (2 - t);

/**
 * Quadratic ease-in-out.
 * Starts slow, speeds up, then slows down.
 * Creates an S-curve.
 */
export const easeInOut: EasingFunction = (t) =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

/**
 * Cubic ease-in.
 * Stronger acceleration than quadratic.
 */
export const easeInCubic: EasingFunction = (t) => t * t * t;

/**
 * Cubic ease-out.
 * Stronger deceleration than quadratic.
 */
export const easeOutCubic: EasingFunction = (t) => 1 - Math.pow(1 - t, 3);

/**
 * Cubic ease-in-out.
 * Stronger S-curve than quadratic.
 */
export const easeInOutCubic: EasingFunction = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * Bounce ease-out.
 * Simulates a bouncing ball coming to rest.
 * Based on Robert Penner's bounce algorithm.
 */
export const easeOutBounce: EasingFunction = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;

  if (t < 1 / d1) {
    return n1 * t * t;
  } else if (t < 2 / d1) {
    return n1 * (t -= 1.5 / d1) * t + 0.75;
  } else if (t < 2.5 / d1) {
    return n1 * (t -= 2.25 / d1) * t + 0.9375;
  } else {
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
};

/**
 * Bounce ease-in.
 * Simulates a bouncing ball starting from rest.
 */
export const easeInBounce: EasingFunction = (t) => 1 - easeOutBounce(1 - t);

/**
 * Bounce ease-in-out.
 * Bounces at both start and end.
 */
export const easeInOutBounce: EasingFunction = (t) =>
  t < 0.5
    ? (1 - easeOutBounce(1 - 2 * t)) / 2
    : (1 + easeOutBounce(2 * t - 1)) / 2;

/**
 * Elastic ease-out.
 * Overshoots the target and oscillates back.
 * Uses sine wave with exponential decay.
 */
export const easeOutElastic: EasingFunction = (t) => {
  const c4 = (2 * Math.PI) / 3;

  if (t === 0) return 0;
  if (t === 1) return 1;

  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

/**
 * Elastic ease-in.
 * Winds up before releasing toward target.
 * May produce values below 0.
 */
export const easeInElastic: EasingFunction = (t) => {
  const c4 = (2 * Math.PI) / 3;

  if (t === 0) return 0;
  if (t === 1) return 1;

  return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
};

/**
 * Elastic ease-in-out.
 * Winds up, releases, overshoots, and oscillates back.
 */
export const easeInOutElastic: EasingFunction = (t) => {
  const c5 = (2 * Math.PI) / 4.5;

  if (t === 0) return 0;
  if (t === 1) return 1;

  if (t < 0.5) {
    return -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2;
  }
  return (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
};

/**
 * Map of all easing functions by name.
 * Used for dynamic lookup.
 */
export const EASING_FUNCTIONS: Record<EasingName, EasingFunction> = {
  linear,
  easeIn,
  easeOut,
  easeInOut,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInBounce,
  easeOutBounce,
  easeInOutBounce,
  easeInElastic,
  easeOutElastic,
  easeInOutElastic,
};

/**
 * Get an easing function by name.
 * Returns linear as fallback for unknown names.
 *
 * @param name - Name of the easing function
 * @returns The easing function, or linear if not found
 */
export function getEasingFunction(name: EasingName): EasingFunction {
  return EASING_FUNCTIONS[name] ?? linear;
}
