import { z } from 'zod';

// ============================================================================
// Shared Schemas
// ============================================================================

/**
 * Hex color string (with optional alpha).
 * Examples: #ffffff, #ff0000, #00ff00aa
 */
const HexColorSchema = z.string().regex(
  /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/,
  { message: 'Invalid hex color format. Use #RRGGBB or #RRGGBBAA' }
);

/**
 * CSS color string (hex, rgb, rgba, named colors).
 * For simplicity, we accept any string and let the renderer handle it.
 */
const ColorSchema = z.string().min(1, { message: 'Color cannot be empty' });

/**
 * Gradient stop: position (0-1) and color.
 */
const GradientStopSchema = z.object({
  offset: z.number().min(0).max(1, { message: 'Gradient offset must be between 0 and 1' }),
  color: ColorSchema,
});

/**
 * Gradient fill definition.
 */
const GradientFillSchema = z.object({
  type: z.enum(['linear', 'radial']),
  /** Angle in degrees for linear gradients (0 = left to right) */
  angle: z.number().optional(),
  /** Gradient color stops (minimum 2) */
  stops: z.array(GradientStopSchema).min(2, { message: 'Gradient requires at least 2 color stops' }),
});

/**
 * Fill can be a solid color or gradient.
 */
const FillSchema = z.union([ColorSchema, GradientFillSchema]);

/**
 * Shadow effect for text.
 */
export const ShadowSchema = z.object({
  color: ColorSchema,
  blur: z.number().min(0, { message: 'Shadow blur cannot be negative' }),
  offsetX: z.number(),
  offsetY: z.number(),
});

/**
 * Stroke (outline) effect.
 */
export const StrokeSchema = z.object({
  color: ColorSchema,
  width: z.number().min(0, { message: 'Stroke width cannot be negative' }),
});

// ============================================================================
// Text Element Schema (RNDR-01 through RNDR-04)
// ============================================================================

/**
 * Text element with full styling support.
 *
 * Requirements covered:
 * - RNDR-01: Font family, size, weight, style, color, alignment
 * - RNDR-02: Text shadow and stroke/outline effects
 * - RNDR-03: Text background with padding and border radius
 * - RNDR-04: Max width for automatic wrapping
 *
 * Note: RNDR-05 (word-by-word reveal) is deferred to Phase 03 (Animation System)
 */
export const TextElementSchema = z.object({
  type: z.literal('text'),

  // Content
  text: z.string().min(1, { message: 'Text content cannot be empty' }),

  // Position
  x: z.number(),
  y: z.number(),

  // Font styling (RNDR-01)
  fontFamily: z.string().default('Inter'),
  fontSize: z.number().min(1, { message: 'Font size must be at least 1' }).default(32),
  fontWeight: z.number().min(100).max(900).default(400),
  fontStyle: z.enum(['normal', 'italic']).default('normal'),
  color: ColorSchema.default('#ffffff'),
  textAlign: z.enum(['left', 'center', 'right']).default('left'),
  lineHeight: z.number().min(0.5).max(3).default(1.2),

  // Effects (RNDR-02)
  shadow: ShadowSchema.optional(),
  stroke: StrokeSchema.optional(),

  // Background (RNDR-03)
  backgroundColor: ColorSchema.optional(),
  padding: z.number().min(0).default(0),
  borderRadius: z.number().min(0).default(0),

  // Wrapping (RNDR-04)
  maxWidth: z.number().min(1).optional(),

  // Transform properties (shared)
  rotation: z.number().optional(),
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
});

// ============================================================================
// Image Element Schema (RNDR-06 through RNDR-08)
// ============================================================================

/**
 * Image element with fit modes and clipping.
 *
 * Requirements covered:
 * - RNDR-06: Image elements from URLs or uploaded assets
 * - RNDR-07: Fit mode (cover, contain, fill)
 * - RNDR-08: Border radius
 */
export const ImageElementSchema = z.object({
  type: z.literal('image'),

  // Source (URL or asset:{id})
  src: z.string().min(1, { message: 'Image source cannot be empty' }),

  // Position and dimensions
  x: z.number(),
  y: z.number(),
  width: z.number().min(1, { message: 'Image width must be at least 1' }),
  height: z.number().min(1, { message: 'Image height must be at least 1' }),

  // Fit mode (RNDR-07)
  fit: z.enum(['cover', 'contain', 'fill']).default('cover'),

  // Border radius (RNDR-08)
  borderRadius: z.number().min(0).default(0),

  // Transform properties (shared)
  rotation: z.number().optional(),
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
});

// ============================================================================
// Shape Element Schema (RNDR-09 through RNDR-11)
// ============================================================================

/**
 * Shape element with gradient fills and strokes.
 *
 * Requirements covered:
 * - RNDR-09: Shape elements (rectangle, circle, ellipse, line)
 * - RNDR-10: Fill color including linear/radial gradients
 * - RNDR-11: Stroke color and width
 */
export const ShapeElementSchema = z.object({
  type: z.literal('shape'),

  // Shape type (RNDR-09)
  shape: z.enum(['rectangle', 'circle', 'ellipse', 'line']),

  // Position
  x: z.number(),
  y: z.number(),

  // Dimensions (usage depends on shape type)
  // rectangle, ellipse: width and height
  // circle: radius
  // line: width = x2-x1, height = y2-y1 (endpoint offset)
  width: z.number().optional(),
  height: z.number().optional(),
  radius: z.number().min(0).optional(),

  // Fill (RNDR-10)
  fill: FillSchema.optional(),

  // Stroke (RNDR-11)
  stroke: StrokeSchema.optional(),

  // Border radius for rectangles
  borderRadius: z.number().min(0).default(0),

  // Transform properties (shared)
  rotation: z.number().optional(),
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
}).refine(
  (data) => {
    // Validate shape-specific requirements
    switch (data.shape) {
      case 'rectangle':
      case 'ellipse':
        return data.width !== undefined && data.height !== undefined;
      case 'circle':
        return data.radius !== undefined;
      case 'line':
        return data.width !== undefined && data.height !== undefined;
      default:
        return true;
    }
  },
  {
    message: 'Shape requires specific dimensions: rectangle/ellipse/line need width+height, circle needs radius',
  }
);

// ============================================================================
// Base Shape Schema (for discriminated union)
// ============================================================================

/**
 * Base shape element schema without refinement.
 * Used in discriminated union for type discrimination.
 */
const BaseShapeElementSchema = z.object({
  type: z.literal('shape'),

  // Shape type (RNDR-09)
  shape: z.enum(['rectangle', 'circle', 'ellipse', 'line']),

  // Position
  x: z.number(),
  y: z.number(),

  // Dimensions (usage depends on shape type)
  width: z.number().optional(),
  height: z.number().optional(),
  radius: z.number().min(0).optional(),

  // Fill (RNDR-10)
  fill: FillSchema.optional(),

  // Stroke (RNDR-11)
  stroke: StrokeSchema.optional(),

  // Border radius for rectangles
  borderRadius: z.number().min(0).default(0),

  // Transform properties (shared)
  rotation: z.number().optional(),
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
});

// ============================================================================
// Discriminated Union
// ============================================================================

/**
 * Discriminated union of all element types.
 * The 'type' field determines which schema applies.
 *
 * Note: ShapeElementSchema with refinement should be used for full validation.
 * ElementSchema provides initial type discrimination.
 */
export const ElementSchema = z.discriminatedUnion('type', [
  TextElementSchema,
  ImageElementSchema,
  BaseShapeElementSchema,
]);

// ============================================================================
// Exports for shared schemas
// ============================================================================

export {
  ColorSchema,
  HexColorSchema,
  FillSchema,
  GradientFillSchema,
  GradientStopSchema,
};
