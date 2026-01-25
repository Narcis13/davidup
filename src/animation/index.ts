/**
 * Animation module exports.
 * Provides easing functions and animation utilities.
 *
 * @module animation
 */

// Types
export type { EasingFunction, EasingName } from './types.js';

// Easing functions
export {
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
  EASING_FUNCTIONS,
  getEasingFunction,
} from './easing.js';
