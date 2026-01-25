import { z } from 'zod';
import { OutputConfigSchema } from './output.js';
import { ScenesSchema } from './scene.js';

/**
 * Zod schema for a complete video specification.
 * Contains output configuration and scenes with elements.
 */
export const VideoSpecSchema = z.object({
  /** Output configuration for the video */
  output: OutputConfigSchema,

  /** Scenes containing elements to render */
  scenes: ScenesSchema,
});
