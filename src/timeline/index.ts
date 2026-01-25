/**
 * Timeline module exports.
 * Provides scene sequencing and transition management for multi-scene videos.
 *
 * @module timeline
 */

// Types
export type {
  SceneWithTransition,
  SceneInfo,
  TimelineConfig,
} from './types.js';

// Classes
export { Timeline } from './timeline.js';

// Transitions
export {
  renderTransition,
  type TransitionType,
  type TransitionDirection,
  type TransitionRenderOptions,
} from './transitions.js';
