import { z } from 'zod';
import { OutputConfigSchema } from './output.js';

/**
 * Zod schema for a complete video specification.
 * Wraps output configuration with room for future expansion.
 */
export const VideoSpecSchema = z.object({
  /** Output configuration for the video */
  output: OutputConfigSchema,
});
