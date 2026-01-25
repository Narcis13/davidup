/**
 * Interpolation utilities for animation calculations.
 * Maps values from one range to another with optional easing and extrapolation.
 *
 * @module animation/interpolate
 */

import type { EasingFunction } from './types.js';

/**
 * Options for the interpolate function.
 */
export interface InterpolateOptions {
  /**
   * Easing function to apply to the interpolation.
   * Transforms the linear progress before mapping to output range.
   * Defaults to linear (no transformation).
   */
  easing?: EasingFunction;

  /**
   * Behavior when input is below the input range.
   * - 'clamp': Return outputRange[0] (default)
   * - 'extend': Continue the interpolation linearly
   */
  extrapolateLeft?: 'clamp' | 'extend';

  /**
   * Behavior when input is above the input range.
   * - 'clamp': Return outputRange[1] (default)
   * - 'extend': Continue the interpolation linearly
   */
  extrapolateRight?: 'clamp' | 'extend';
}

/**
 * Interpolates a value from one range to another.
 *
 * Takes a frame number and maps it from an input range to an output range.
 * Supports easing functions and extrapolation control.
 *
 * @param frame - The current frame number to interpolate
 * @param inputRange - [start, end] of input range (frame numbers)
 * @param outputRange - [start, end] of output range (values)
 * @param options - Optional interpolation settings
 * @returns The interpolated value in the output range
 *
 * @example
 * // Linear interpolation
 * interpolate(15, [0, 30], [0, 100]); // 50
 *
 * @example
 * // With easing
 * interpolate(15, [0, 30], [0, 100], { easing: easeIn }); // 25
 *
 * @example
 * // With extend extrapolation
 * interpolate(-5, [0, 30], [0, 100], { extrapolateLeft: 'extend' }); // -16.67
 */
export function interpolate(
  frame: number,
  inputRange: [number, number],
  outputRange: [number, number],
  options?: InterpolateOptions
): number {
  const [inputStart, inputEnd] = inputRange;
  const [outputStart, outputEnd] = outputRange;
  const extrapolateLeft = options?.extrapolateLeft ?? 'clamp';
  const extrapolateRight = options?.extrapolateRight ?? 'clamp';
  const easing = options?.easing;

  // Handle edge case: input range has zero length
  if (inputEnd === inputStart) {
    return outputStart;
  }

  // Calculate progress (0 to 1) within input range
  let progress = (frame - inputStart) / (inputEnd - inputStart);

  // Handle extrapolation before clamping progress
  const isBeforeRange = frame < inputStart;
  const isAfterRange = frame > inputEnd;

  if (isBeforeRange && extrapolateLeft === 'clamp') {
    progress = 0;
  } else if (isAfterRange && extrapolateRight === 'clamp') {
    progress = 1;
  }

  // Apply easing only within the 0-1 range
  // For extrapolated values, continue linearly from the eased endpoints
  let easedProgress: number;

  if (easing) {
    if (progress < 0) {
      // Linear extrapolation below: use the derivative at t=0
      // For most easings, this is close to linear
      easedProgress = progress; // Linear extrapolation for simplicity
    } else if (progress > 1) {
      // Linear extrapolation above: continue from eased endpoint
      easedProgress = 1 + (progress - 1); // Linear extrapolation for simplicity
    } else {
      easedProgress = easing(progress);
    }
  } else {
    easedProgress = progress;
  }

  // Map progress to output range
  const outputDelta = outputEnd - outputStart;
  return outputStart + easedProgress * outputDelta;
}
