/**
 * Template schemas for AI-powered template generation.
 * Defines platform presets, generation request/response schemas, and built-in templates.
 */
import { z } from 'zod';
import { VideoSpecSchema } from './video-spec.js';

/**
 * Platform presets with recommended dimensions and framerate
 */
export const PLATFORM_PRESETS = {
  tiktok: { width: 1080, height: 1920, fps: 30 },
  youtube: { width: 1920, height: 1080, fps: 30 },
  instagram: { width: 1080, height: 1080, fps: 30 },
} as const;

/**
 * Schema for template generation request
 */
export const GenerateRequestSchema = z.object({
  /** Description of the video to generate */
  description: z.string().min(10).max(1000),
  /** Target platform for video dimensions */
  platform: z.enum(['tiktok', 'youtube', 'instagram']),
  /** Visual style of the video */
  style: z.enum(['energetic', 'professional', 'playful']),
});

/**
 * Schema for template variable definition
 */
export const TemplateVariableSchema = z.object({
  /** Variable name (used as placeholder) */
  name: z.string(),
  /** Human-readable description */
  description: z.string().optional(),
  /** Type of value expected */
  type: z.enum(['text', 'url', 'color']),
  /** Default value if not provided */
  default: z.string().optional(),
});

/**
 * Schema for template generation response
 */
export const GenerateResponseSchema = z.object({
  /** Generated video specification */
  spec: VideoSpecSchema,
  /** Variables that can be customized in the template */
  variables: z.array(TemplateVariableSchema),
});

/**
 * Schema for built-in template definitions
 */
export const BuiltInTemplateSchema = z.object({
  /** Unique template identifier */
  id: z.string(),
  /** Human-readable template name */
  name: z.string(),
  /** Description of the template */
  description: z.string(),
  /** Target platform (or universal for all) */
  platform: z.enum(['tiktok', 'youtube', 'instagram', 'universal']),
  /** Visual style description */
  style: z.string(),
  /** Customizable variables */
  variables: z.array(TemplateVariableSchema),
  /** Video specification */
  spec: VideoSpecSchema,
});

// Type exports inferred from schemas
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;
export type TemplateVariable = z.infer<typeof TemplateVariableSchema>;
export type BuiltInTemplate = z.infer<typeof BuiltInTemplateSchema>;
