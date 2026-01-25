/**
 * Animation type definitions
 */

/**
 * Easing function signature.
 * Takes normalized time (0-1) and returns eased progress.
 * @param t - Normalized time, 0 = start, 1 = end
 * @returns Eased progress value (may exceed 0-1 for elastic/bounce)
 */
export type EasingFunction = (t: number) => number;

/**
 * Union of all supported easing function names.
 * Used for string-based easing lookup.
 */
export type EasingName =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInBounce'
  | 'easeOutBounce'
  | 'easeInOutBounce'
  | 'easeInElastic'
  | 'easeOutElastic'
  | 'easeInOutElastic';
