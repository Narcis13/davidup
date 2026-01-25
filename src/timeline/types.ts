/**
 * Timeline type definitions.
 * Types for managing scene sequencing and transitions.
 *
 * @module timeline/types
 */

import type { Scene } from '../types/index.js';
import type { Transition } from '../schemas/animation.js';

/**
 * Extended scene type with transition info.
 * Scenes in a timeline may have transitions to the next scene.
 */
export interface SceneWithTransition extends Scene {
  transition?: Transition;
}

/**
 * Information about the current scene at a specific frame.
 * Returned by Timeline.getSceneAtFrame() with all context needed for rendering.
 */
export interface SceneInfo {
  /** The current scene */
  scene: SceneWithTransition;
  /** Index of this scene in the timeline (0-indexed) */
  sceneIndex: number;
  /** Frame number within this scene (0-indexed from scene start) */
  localFrame: number;
  /** Global frame number in the video */
  globalFrame: number;
  /** Whether this frame is during a transition */
  inTransition: boolean;
  /** Transition details if inTransition is true */
  transition?: {
    from: SceneWithTransition;
    to: SceneWithTransition;
    /** Progress of transition 0-1 (uneased) */
    progress: number;
    /** Progress of transition 0-1 (with easing applied) */
    easedProgress: number;
    type: 'fade' | 'slide' | 'zoom';
    direction?: 'left' | 'right' | 'up' | 'down';
  };
}

/**
 * Timeline configuration.
 * Required parameters to construct a Timeline instance.
 */
export interface TimelineConfig {
  /** Array of scenes in order of playback */
  scenes: SceneWithTransition[];
  /** Frames per second for time-to-frame conversion */
  fps: number;
}
