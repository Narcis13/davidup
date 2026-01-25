/**
 * Timeline class for managing scene sequencing and durations.
 * Handles multi-scene videos by calculating which scene is active at any frame
 * and managing transition timing between scenes.
 *
 * @module timeline/timeline
 */

import type { SceneInfo, SceneWithTransition, TimelineConfig } from './types.js';
import { getEasingFunction } from '../animation/easing.js';
import type { EasingName } from '../animation/types.js';

/**
 * Timeline manages scene sequencing for multi-scene videos.
 * Pre-calculates frame counts to avoid floating-point drift during playback.
 */
export class Timeline {
  private readonly scenes: SceneWithTransition[];
  private readonly fps: number;
  private readonly sceneFrames: number[]; // Cached frame counts per scene
  private readonly totalFrames: number;

  /**
   * Create a new Timeline instance.
   *
   * @param config - Timeline configuration with scenes and fps
   */
  constructor(config: TimelineConfig) {
    this.scenes = config.scenes;
    this.fps = config.fps;

    // Pre-calculate frame counts (avoid floating point accumulation)
    this.sceneFrames = this.scenes.map((scene) =>
      Math.round(scene.duration * this.fps)
    );
    this.totalFrames = this.sceneFrames.reduce((a, b) => a + b, 0);
  }

  /**
   * Get the total number of frames in the timeline.
   * Sum of all scene durations converted to frames.
   */
  getTotalFrames(): number {
    return this.totalFrames;
  }

  /**
   * Get the total duration of the timeline in seconds.
   * Calculated from total frames to ensure consistency.
   */
  getTotalDuration(): number {
    return this.totalFrames / this.fps;
  }

  /**
   * Get the number of scenes in the timeline.
   */
  getSceneCount(): number {
    return this.scenes.length;
  }

  /**
   * Get scene information for a specific frame.
   * Returns the active scene, local frame within that scene,
   * and transition details if the frame is during a transition.
   *
   * @param frame - Global frame number (0-indexed)
   * @returns Scene information including transition state
   */
  getSceneAtFrame(frame: number): SceneInfo {
    // Clamp frame to valid range
    const clampedFrame = Math.max(0, Math.min(frame, this.totalFrames - 1));

    let accumulatedFrames = 0;

    for (let i = 0; i < this.scenes.length; i++) {
      const scene = this.scenes[i];
      const sceneFrameCount = this.sceneFrames[i];
      const sceneEndFrame = accumulatedFrames + sceneFrameCount;

      // Check if we're in this scene
      if (clampedFrame < sceneEndFrame) {
        const localFrame = clampedFrame - accumulatedFrames;

        // Check for transition to next scene
        if (scene.transition && i < this.scenes.length - 1) {
          const transitionFrames = Math.round(
            (scene.transition.duration ?? 0.5) * this.fps
          );
          const transitionStartLocal = sceneFrameCount - transitionFrames;

          if (localFrame >= transitionStartLocal) {
            const nextScene = this.scenes[i + 1];
            const progress =
              (localFrame - transitionStartLocal) / transitionFrames;
            const easing = getEasingFunction(
              (scene.transition.easing ?? 'easeInOut') as EasingName
            );
            const easedProgress = easing(progress);

            return {
              scene,
              sceneIndex: i,
              localFrame,
              globalFrame: clampedFrame,
              inTransition: true,
              transition: {
                from: scene,
                to: nextScene,
                progress,
                easedProgress,
                type: scene.transition.type,
                direction: scene.transition.direction,
              },
            };
          }
        }

        // Normal frame (not in transition)
        return {
          scene,
          sceneIndex: i,
          localFrame,
          globalFrame: clampedFrame,
          inTransition: false,
        };
      }

      accumulatedFrames = sceneEndFrame;
    }

    // Should never reach here due to clamping, but return last scene as fallback
    const lastIdx = this.scenes.length - 1;
    return {
      scene: this.scenes[lastIdx],
      sceneIndex: lastIdx,
      localFrame: this.sceneFrames[lastIdx] - 1,
      globalFrame: this.totalFrames - 1,
      inTransition: false,
    };
  }
}
