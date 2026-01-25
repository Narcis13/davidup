/**
 * Audio Configuration Schema
 *
 * Zod schema for validating audio configuration in video encoding.
 * Supports background audio with volume control and fade effects.
 *
 * Requirements covered:
 * - AUDI-01: Background audio support
 * - AUDI-02: Volume control (0.0-1.0)
 * - AUDI-03: Fade in duration
 * - AUDI-04: Fade out duration
 */
import { z } from 'zod';

/**
 * Audio configuration for video encoding
 * Supports background audio with volume control and fade effects
 */
export const AudioConfigSchema = z.object({
  /** Audio file path or URL */
  src: z.string().min(1, 'Audio source path is required'),

  /** Volume multiplier 0.0-1.0 (default: 1.0) - AUDI-02 */
  volume: z.number().min(0).max(1).default(1),

  /** Fade in duration in seconds (default: 0) - AUDI-03 */
  fadeIn: z.number().min(0).default(0),

  /** Fade out duration in seconds (default: 0) - AUDI-04 */
  fadeOut: z.number().min(0).default(0),
}).strict();

/**
 * Audio configuration type inferred from schema
 */
export type AudioConfig = z.infer<typeof AudioConfigSchema>;
