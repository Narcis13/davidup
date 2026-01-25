/**
 * Animation module exports.
 * Provides easing functions, interpolation, and animation engine.
 *
 * @module animation
 */

// Types
export type {
  EasingFunction,
  EasingName,
  Keyframe,
  PropertyAnimation,
  AnimationPreset,
  AnimationPresetType,
  AnimatedElementProps,
} from './types.js';

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

// Interpolation
export { interpolate } from './interpolate.js';
export type { InterpolateOptions } from './interpolate.js';

// Animation engine
export { getAnimatedValue, getAnimatedElement } from './animation-engine.js';

// Presets
export {
  generateEnterKeyframes,
  generateExitKeyframes,
} from './presets.js';
export type {
  PresetConfig,
  PresetType,
  SlideDirection,
} from './presets.js';
