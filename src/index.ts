// GameMotion - JSON-to-video rendering engine
// Main entry point

// Config
export * from './config/limits.js';

// Schemas
export * from './schemas/index.js';

// Types
export * from './types/index.js';

// Validators
export * from './validators/index.js';

// Errors
export * from './errors/index.js';

// Render
export * from './render/index.js';

// Animation (selective exports to avoid conflicts with schemas)
export {
  // Easing functions
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
  // Interpolation
  interpolate,
  // Animation engine
  getAnimatedValue,
  getAnimatedElement,
  // Presets
  generateEnterKeyframes,
  generateExitKeyframes,
  // Types (avoid duplicating schema types)
  type EasingFunction,
  type InterpolateOptions,
  type AnimatedElementProps,
  type PresetConfig,
  type PresetType,
  type SlideDirection,
} from './animation/index.js';

// Timeline
export {
  Timeline,
  renderTransition,
  type SceneWithTransition,
  type SceneInfo,
  type TimelineConfig,
  type TransitionType,
  type TransitionDirection,
  type TransitionRenderOptions,
} from './timeline/index.js';
