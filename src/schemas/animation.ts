import { z } from 'zod';

/**
 * All supported easing function names.
 * Maps to actual easing functions in the animation engine.
 */
export const EasingNameSchema = z.enum([
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'easeInCubic',
  'easeOutCubic',
  'easeInOutCubic',
  'easeInBounce',
  'easeOutBounce',
  'easeInOutBounce',
  'easeInElastic',
  'easeOutElastic',
  'easeInOutElastic',
]);

/**
 * A single keyframe in an animation timeline.
 * Defines a value at a specific time point.
 */
export const KeyframeSchema = z.object({
  /** Time in seconds from element start */
  time: z.number().min(0, { message: 'Keyframe time must be non-negative' }),

  /** The value at this keyframe */
  value: z.number(),

  /** Easing function to use when interpolating TO this keyframe */
  easing: EasingNameSchema.optional(),
});

/**
 * Animation of a specific property using keyframes.
 * Allows fine-grained control over property changes over time.
 */
export const PropertyAnimationSchema = z.object({
  /** The property being animated */
  property: z.enum(['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity']),

  /** Keyframes defining the animation timeline (minimum 1 required) */
  keyframes: z.array(KeyframeSchema).min(1, {
    message: 'Property animation must have at least one keyframe',
  }),
});

/**
 * Pre-built animation preset for common effects.
 * Simpler than keyframe animations for standard enter/exit animations.
 */
export const AnimationPresetSchema = z.object({
  /** Type of preset animation */
  type: z.enum(['fade', 'slide', 'scale', 'bounce']),

  /** Duration of the animation in seconds */
  duration: z.number().positive({ message: 'Animation duration must be positive' }).default(0.5),

  /** Direction for directional animations (slide) */
  direction: z.enum(['left', 'right', 'top', 'bottom']).optional(),

  /** Distance in pixels for slide animations */
  distance: z.number().positive({ message: 'Distance must be positive' }).optional(),

  /** Easing function for the animation */
  easing: EasingNameSchema.optional(),
});

/**
 * Scene transition effect.
 * Applied between scenes for smooth visual transitions.
 */
export const TransitionSchema = z.object({
  /** Type of transition effect */
  type: z.enum(['fade', 'slide', 'zoom']),

  /** Duration of the transition in seconds */
  duration: z.number().positive({ message: 'Transition duration must be positive' }).default(0.5),

  /** Direction for directional transitions (slide) */
  direction: z.enum(['left', 'right', 'up', 'down']).optional(),

  /** Easing function for the transition */
  easing: EasingNameSchema.optional(),
});

// Inferred TypeScript types
export type EasingName = z.infer<typeof EasingNameSchema>;
export type Keyframe = z.infer<typeof KeyframeSchema>;
export type PropertyAnimation = z.infer<typeof PropertyAnimationSchema>;
export type AnimationPreset = z.infer<typeof AnimationPresetSchema>;
export type Transition = z.infer<typeof TransitionSchema>;
