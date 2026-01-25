/**
 * Animation type definitions
 */

/**
 * Easing function signature.
 * Takes normalized time (0-1) and returns eased progress.
 * @param t - Normalized time, 0 = start, 1 = end
 * @returns Eased progress value (may exceed 0-1 for elastic/bounce)
 */
export type EasingFunction = (t: number) => number;

/**
 * Union of all supported easing function names.
 * Used for string-based easing lookup.
 */
export type EasingName =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInBounce'
  | 'easeOutBounce'
  | 'easeInOutBounce'
  | 'easeInElastic'
  | 'easeOutElastic'
  | 'easeInOutElastic';

// ============================================================================
// Runtime Keyframe Types
// ============================================================================

/**
 * Runtime keyframe representation (uses frame numbers).
 *
 * NOTE: This is different from KeyframeSchema (Plan 03-02) which uses
 * `time` in seconds. The AnimatedFrameGenerator (Plan 03-07) converts
 * from schema format (time) to runtime format (frame) using:
 *   frame = Math.round(time * fps)
 *
 * This design avoids floating-point drift in frame calculations.
 */
export interface Keyframe {
  /** Frame number (NOT time in seconds - see KeyframeSchema for time-based input) */
  frame: number;
  /** The value at this keyframe */
  value: number;
  /** Easing function to use when interpolating TO this keyframe */
  easing?: EasingName;
}

/**
 * Animation of a specific property using keyframes.
 * Allows fine-grained control over property changes over time.
 */
export interface PropertyAnimation {
  /** The property being animated */
  property: 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity';
  /** Keyframes defining the animation timeline */
  keyframes: Keyframe[];
}

/**
 * Animation preset type for enter/exit animations.
 */
export type AnimationPresetType = 'fade' | 'slide' | 'scale' | 'bounce';

/**
 * Pre-built animation preset for common effects.
 */
export interface AnimationPreset {
  type: AnimationPresetType;
  duration: number;
  direction?: 'left' | 'right' | 'top' | 'bottom';
  distance?: number;
  easing?: EasingName;
}

/**
 * Properties that make an element animated.
 * Can be mixed into any element type.
 */
export interface AnimatedElementProps {
  /** Property animations with keyframes */
  animations?: PropertyAnimation[];
  /** Enter animation preset */
  enter?: AnimationPreset;
  /** Exit animation preset */
  exit?: AnimationPreset;
  /** Time in seconds when element becomes visible */
  startTime?: number;
  /** Time in seconds when element becomes invisible */
  endTime?: number;
}
