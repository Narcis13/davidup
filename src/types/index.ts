// TypeScript types inferred from Zod schemas
import { z } from 'zod';
import { OutputConfigSchema } from '../schemas/output.js';
import { VideoSpecSchema } from '../schemas/video-spec.js';
import { SceneSchema } from '../schemas/scene.js';
import {
  TextElementSchema,
  ImageElementSchema,
  ShapeElementSchema,
  ElementSchema,
  ShadowSchema,
  StrokeSchema,
  GradientFillSchema,
  GradientStopSchema,
} from '../schemas/elements.js';

// Output types
export type OutputConfig = z.infer<typeof OutputConfigSchema>;

// Video spec types
export type VideoSpec = z.infer<typeof VideoSpecSchema>;

// Scene types
export type Scene = z.infer<typeof SceneSchema>;

// Element types
export type TextElement = z.infer<typeof TextElementSchema>;
export type ImageElement = z.infer<typeof ImageElementSchema>;
export type ShapeElement = z.infer<typeof ShapeElementSchema>;
export type Element = z.infer<typeof ElementSchema>;

// Shared types
export type Shadow = z.infer<typeof ShadowSchema>;
export type Stroke = z.infer<typeof StrokeSchema>;
export type GradientFill = z.infer<typeof GradientFillSchema>;
export type GradientStop = z.infer<typeof GradientStopSchema>;
