import { z } from 'zod';
import { VIDEO_LIMITS } from '../config/limits.js';

/**
 * Zod schema for output configuration.
 * Validates dimensions, fps, and duration against VIDEO_LIMITS.
 */
export const OutputConfigSchema = z.object({
  /** Width in pixels (1 to 1920) */
  width: z
    .number({
      required_error: 'Width is required',
      invalid_type_error: 'Width must be a number',
    })
    .int({ message: 'Width must be a whole number' })
    .min(1, { message: 'Width must be at least 1 pixel' })
    .max(VIDEO_LIMITS.maxWidth, {
      message: `Width cannot exceed ${VIDEO_LIMITS.maxWidth} pixels`,
    }),

  /** Height in pixels (1 to 1920) */
  height: z
    .number({
      required_error: 'Height is required',
      invalid_type_error: 'Height must be a number',
    })
    .int({ message: 'Height must be a whole number' })
    .min(1, { message: 'Height must be at least 1 pixel' })
    .max(VIDEO_LIMITS.maxHeight, {
      message: `Height cannot exceed ${VIDEO_LIMITS.maxHeight} pixels`,
    }),

  /** Frames per second (1 to 60, defaults to 30) */
  fps: z
    .number({
      invalid_type_error: 'FPS must be a number',
    })
    .int({ message: 'FPS must be a whole number' })
    .min(VIDEO_LIMITS.minFps, {
      message: `FPS must be at least ${VIDEO_LIMITS.minFps}`,
    })
    .max(VIDEO_LIMITS.maxFps, {
      message: `FPS cannot exceed ${VIDEO_LIMITS.maxFps}`,
    })
    .default(VIDEO_LIMITS.defaultFps),

  /** Duration in seconds (must be positive, max 300) */
  duration: z
    .number({
      required_error: 'Duration is required',
      invalid_type_error: 'Duration must be a number',
    })
    .positive({ message: 'Duration must be greater than 0' })
    .max(VIDEO_LIMITS.maxDuration, {
      message: `Duration cannot exceed ${VIDEO_LIMITS.maxDuration} seconds`,
    }),
});
