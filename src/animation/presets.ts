/**
 * Animation presets for common enter/exit animations.
 * Generates PropertyAnimation arrays from simple preset configurations.
 *
 * @module animation/presets
 */

import type { PropertyAnimation, EasingName } from './types.js';

/**
 * Available preset animation types.
 */
export type PresetType = 'fade' | 'slide' | 'scale' | 'bounce';

/**
 * Direction options for slide animations.
 */
export type SlideDirection = 'left' | 'right' | 'top' | 'bottom';

/**
 * Configuration for generating animation presets.
 */
export interface PresetConfig {
  /** Type of animation preset */
  type: PresetType;
  /** Duration in frames (NOT seconds - convert with Math.round(seconds * fps)) */
  duration: number;
  /** Direction for slide preset (default: 'left') */
  direction?: SlideDirection;
  /** Distance in pixels for slide preset (default: 100) */
  distance?: number;
  /** Easing function name (default varies by preset and enter/exit) */
  easing?: EasingName;
}

/**
 * Calculate slide offset based on direction.
 * Returns [offsetX, offsetY] tuple.
 *
 * @param direction - Slide direction
 * @param distance - Distance in pixels
 * @returns Tuple of [offsetX, offsetY]
 */
function getSlideOffset(
  direction: SlideDirection,
  distance: number
): [number, number] {
  switch (direction) {
    case 'left':
      return [-distance, 0];
    case 'right':
      return [distance, 0];
    case 'top':
      return [0, -distance];
    case 'bottom':
      return [0, distance];
  }
}

/**
 * Generate keyframes for an enter animation preset.
 *
 * Enter animations transition from an initial state (invisible, off-screen, scaled down)
 * to the element's final position.
 *
 * @param config - Preset configuration
 * @param startFrame - Frame when animation starts
 * @param elementX - Element's final X position
 * @param elementY - Element's final Y position
 * @returns Array of PropertyAnimations to apply
 *
 * @example
 * ```ts
 * // Fade in over 30 frames starting at frame 0
 * const fadeIn = generateEnterKeyframes(
 *   { type: 'fade', duration: 30 },
 *   0, 100, 100
 * );
 *
 * // Slide in from left over 45 frames
 * const slideIn = generateEnterKeyframes(
 *   { type: 'slide', duration: 45, direction: 'left', distance: 200 },
 *   0, 500, 300
 * );
 * ```
 */
export function generateEnterKeyframes(
  config: PresetConfig,
  startFrame: number,
  elementX: number,
  elementY: number
): PropertyAnimation[] {
  const {
    type,
    duration,
    direction = 'left',
    distance = 100,
    easing = type === 'bounce' ? 'easeOutBounce' : 'easeOut',
  } = config;

  const endFrame = startFrame + duration;

  switch (type) {
    case 'fade':
      return [
        {
          property: 'opacity',
          keyframes: [
            { frame: startFrame, value: 0 },
            { frame: endFrame, value: 1, easing },
          ],
        },
      ];

    case 'slide': {
      const [offsetX, offsetY] = getSlideOffset(direction, distance);
      return [
        {
          property: 'x',
          keyframes: [
            { frame: startFrame, value: elementX + offsetX },
            { frame: endFrame, value: elementX, easing },
          ],
        },
        {
          property: 'y',
          keyframes: [
            { frame: startFrame, value: elementY + offsetY },
            { frame: endFrame, value: elementY, easing },
          ],
        },
        {
          property: 'opacity',
          keyframes: [
            { frame: startFrame, value: 0 },
            { frame: endFrame, value: 1, easing },
          ],
        },
      ];
    }

    case 'scale':
      return [
        {
          property: 'scaleX',
          keyframes: [
            { frame: startFrame, value: 0 },
            { frame: endFrame, value: 1, easing },
          ],
        },
        {
          property: 'scaleY',
          keyframes: [
            { frame: startFrame, value: 0 },
            { frame: endFrame, value: 1, easing },
          ],
        },
        {
          property: 'opacity',
          keyframes: [
            { frame: startFrame, value: 0 },
            { frame: endFrame, value: 1, easing },
          ],
        },
      ];

    case 'bounce':
      // Bounce uses easeOutBounce for scale, fades in quickly at start
      return [
        {
          property: 'scaleX',
          keyframes: [
            { frame: startFrame, value: 0 },
            { frame: endFrame, value: 1, easing: 'easeOutBounce' },
          ],
        },
        {
          property: 'scaleY',
          keyframes: [
            { frame: startFrame, value: 0 },
            { frame: endFrame, value: 1, easing: 'easeOutBounce' },
          ],
        },
        {
          property: 'opacity',
          keyframes: [
            { frame: startFrame, value: 0 },
            { frame: Math.round(startFrame + duration * 0.3), value: 1 },
          ],
        },
      ];
  }
}

/**
 * Generate keyframes for an exit animation preset.
 *
 * Exit animations transition from the element's current state to an exit state
 * (invisible, off-screen, scaled down). This is the reverse of enter animations.
 *
 * @param config - Preset configuration
 * @param startFrame - Frame when animation starts
 * @param elementX - Element's current X position
 * @param elementY - Element's current Y position
 * @returns Array of PropertyAnimations to apply
 *
 * @example
 * ```ts
 * // Fade out over 30 frames starting at frame 60
 * const fadeOut = generateExitKeyframes(
 *   { type: 'fade', duration: 30 },
 *   60, 100, 100
 * );
 *
 * // Slide out to right over 45 frames
 * const slideOut = generateExitKeyframes(
 *   { type: 'slide', duration: 45, direction: 'right', distance: 200 },
 *   60, 500, 300
 * );
 * ```
 */
export function generateExitKeyframes(
  config: PresetConfig,
  startFrame: number,
  elementX: number,
  elementY: number
): PropertyAnimation[] {
  const {
    type,
    duration,
    direction = 'left',
    distance = 100,
    easing = type === 'bounce' ? 'easeInBounce' : 'easeIn',
  } = config;

  const endFrame = startFrame + duration;

  switch (type) {
    case 'fade':
      return [
        {
          property: 'opacity',
          keyframes: [
            { frame: startFrame, value: 1 },
            { frame: endFrame, value: 0, easing },
          ],
        },
      ];

    case 'slide': {
      const [offsetX, offsetY] = getSlideOffset(direction, distance);
      return [
        {
          property: 'x',
          keyframes: [
            { frame: startFrame, value: elementX },
            { frame: endFrame, value: elementX + offsetX, easing },
          ],
        },
        {
          property: 'y',
          keyframes: [
            { frame: startFrame, value: elementY },
            { frame: endFrame, value: elementY + offsetY, easing },
          ],
        },
        {
          property: 'opacity',
          keyframes: [
            { frame: startFrame, value: 1 },
            { frame: endFrame, value: 0, easing },
          ],
        },
      ];
    }

    case 'scale':
      return [
        {
          property: 'scaleX',
          keyframes: [
            { frame: startFrame, value: 1 },
            { frame: endFrame, value: 0, easing },
          ],
        },
        {
          property: 'scaleY',
          keyframes: [
            { frame: startFrame, value: 1 },
            { frame: endFrame, value: 0, easing },
          ],
        },
        {
          property: 'opacity',
          keyframes: [
            { frame: startFrame, value: 1 },
            { frame: endFrame, value: 0, easing },
          ],
        },
      ];

    case 'bounce':
      // Bounce exit uses easeInBounce for scale, fades out quickly at end
      return [
        {
          property: 'scaleX',
          keyframes: [
            { frame: startFrame, value: 1 },
            { frame: endFrame, value: 0, easing: 'easeInBounce' },
          ],
        },
        {
          property: 'scaleY',
          keyframes: [
            { frame: startFrame, value: 1 },
            { frame: endFrame, value: 0, easing: 'easeInBounce' },
          ],
        },
        {
          property: 'opacity',
          keyframes: [
            { frame: Math.round(endFrame - duration * 0.3), value: 1 },
            { frame: endFrame, value: 0 },
          ],
        },
      ];
  }
}
