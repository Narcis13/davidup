/**
 * Animation engine for processing keyframes and animated elements.
 * Core of the animation system - takes keyframe definitions and returns
 * interpolated values for any frame number.
 *
 * @module animation/animation-engine
 */

import type { EasingFunction, Keyframe, AnimatedElementProps, PropertyAnimation } from './types.js';
import { getEasingFunction } from './easing.js';
import { interpolate } from './interpolate.js';

/**
 * Gets the interpolated value at a specific frame from a set of keyframes.
 *
 * Handles:
 * - Single keyframe: returns that value for all frames
 * - Multiple keyframes: interpolates between appropriate keyframes
 * - Before first keyframe: returns first keyframe value
 * - After last keyframe: returns last keyframe value
 * - Out-of-order keyframes: sorts internally
 * - Keyframe-specific easing: applies easing for each segment
 *
 * @param frame - The current frame number
 * @param keyframes - Array of keyframes (will be sorted by frame)
 * @param defaultEasing - Optional default easing function for segments without specified easing
 * @returns The interpolated value at the given frame
 *
 * @example
 * const keyframes = [
 *   { frame: 0, value: 0 },
 *   { frame: 30, value: 100 },
 * ];
 * getAnimatedValue(15, keyframes); // 50
 */
export function getAnimatedValue(
  frame: number,
  keyframes: Keyframe[],
  defaultEasing?: EasingFunction
): number {
  // Handle empty keyframes
  if (keyframes.length === 0) {
    return 0;
  }

  // Sort keyframes by frame number (don't mutate original)
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);

  // Single keyframe: return its value for all frames
  if (sorted.length === 1) {
    return sorted[0].value;
  }

  // Before first keyframe: return first value
  if (frame <= sorted[0].frame) {
    return sorted[0].value;
  }

  // After last keyframe: return last value
  if (frame >= sorted[sorted.length - 1].frame) {
    return sorted[sorted.length - 1].value;
  }

  // Find the segment containing this frame
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];

    if (frame >= start.frame && frame <= end.frame) {
      // Determine easing: keyframe-specific > default > linear
      let easing: EasingFunction | undefined;
      if (end.easing) {
        easing = getEasingFunction(end.easing);
      } else if (defaultEasing) {
        easing = defaultEasing;
      }

      return interpolate(
        frame,
        [start.frame, end.frame],
        [start.value, end.value],
        { easing }
      );
    }
  }

  // Fallback (should not reach here with correct logic)
  return sorted[sorted.length - 1].value;
}

/**
 * Base element type with minimal required properties.
 * Used as a constraint for getAnimatedElement.
 */
interface BaseElement {
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
}

/**
 * Resolves an element's animated properties for a specific frame.
 *
 * Returns null if the frame is outside the element's visibility range
 * (before startTime or at/after endTime).
 *
 * @param element - The element with potential animations and time bounds
 * @param frame - The current frame number
 * @param fps - Frames per second (used to convert time bounds to frames)
 * @returns The element with resolved animations, or null if not visible
 *
 * @example
 * const element = {
 *   type: 'text',
 *   x: 100,
 *   animations: [{
 *     property: 'x',
 *     keyframes: [{ frame: 0, value: 0 }, { frame: 30, value: 200 }]
 *   }]
 * };
 * getAnimatedElement(element, 15, 30); // { ...element, x: 100 }
 */
export function getAnimatedElement<T extends BaseElement>(
  element: T & AnimatedElementProps,
  frame: number,
  fps: number
): T | null {
  // Convert time bounds to frame numbers
  const startFrame = element.startTime !== undefined
    ? Math.round(element.startTime * fps)
    : -Infinity;
  const endFrame = element.endTime !== undefined
    ? Math.round(element.endTime * fps)
    : Infinity;

  // Check visibility (exclusive end - element disappears at endTime)
  if (frame < startFrame || frame >= endFrame) {
    return null;
  }

  // If no animations, return element as-is
  if (!element.animations || element.animations.length === 0) {
    // Return a copy without the animation props
    const { animations, enter, exit, startTime, endTime, ...rest } = element;
    return rest as T;
  }

  // Create a copy of the element
  const result = { ...element };

  // Process each animation
  for (const animation of element.animations) {
    const value = getAnimatedValue(frame, animation.keyframes);
    (result as Record<string, unknown>)[animation.property] = value;
  }

  // Remove animation metadata from result
  const { animations, enter, exit, startTime, endTime, ...clean } = result;
  return clean as T;
}
