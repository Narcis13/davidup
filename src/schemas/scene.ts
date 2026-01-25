import { z } from 'zod';
import { ElementSchema, ColorSchema } from './elements.js';

/**
 * Scene schema containing elements and background.
 * A video consists of one or more scenes, each with their own elements and timing.
 */
export const SceneSchema = z.object({
  /** Unique identifier for the scene */
  id: z.string().optional(),

  /** Scene name for reference */
  name: z.string().optional(),

  /** Duration of this scene in seconds */
  duration: z.number().positive({ message: 'Scene duration must be positive' }),

  /** Background color (CSS color string) */
  background: ColorSchema.default('#000000'),

  /** Elements in this scene, rendered in array order (first = back, last = front) */
  elements: z.array(ElementSchema).default([]),
});

/**
 * Array of scenes making up a video.
 */
export const ScenesSchema = z.array(SceneSchema).min(1, {
  message: 'Video must have at least one scene',
});
