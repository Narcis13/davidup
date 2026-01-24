// TypeScript types inferred from Zod schemas
import { z } from 'zod';
import { OutputConfigSchema } from '../schemas/output.js';
import { VideoSpecSchema } from '../schemas/video-spec.js';

/** Output configuration for video rendering */
export type OutputConfig = z.infer<typeof OutputConfigSchema>;

/** Complete video specification */
export type VideoSpec = z.infer<typeof VideoSpecSchema>;
