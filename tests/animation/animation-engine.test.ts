import { describe, it, expect } from 'vitest';
import { getAnimatedValue, getAnimatedElement } from '../../src/animation/animation-engine.js';
import { easeIn, easeOut } from '../../src/animation/easing.js';
import type { Keyframe, AnimatedElementProps, PropertyAnimation } from '../../src/animation/types.js';

describe('getAnimatedValue', () => {
  describe('single keyframe', () => {
    it('should return keyframe value regardless of frame', () => {
      const keyframes: Keyframe[] = [{ frame: 10, value: 50 }];
      expect(getAnimatedValue(0, keyframes)).toBe(50);
      expect(getAnimatedValue(10, keyframes)).toBe(50);
      expect(getAnimatedValue(100, keyframes)).toBe(50);
    });
  });

  describe('two keyframes linear interpolation', () => {
    it('should interpolate between keyframes', () => {
      const keyframes: Keyframe[] = [
        { frame: 0, value: 0 },
        { frame: 30, value: 100 },
      ];
      expect(getAnimatedValue(0, keyframes)).toBe(0);
      expect(getAnimatedValue(15, keyframes)).toBe(50);
      expect(getAnimatedValue(30, keyframes)).toBe(100);
    });

    it('should return first keyframe value before first keyframe', () => {
      const keyframes: Keyframe[] = [
        { frame: 10, value: 50 },
        { frame: 30, value: 100 },
      ];
      expect(getAnimatedValue(0, keyframes)).toBe(50);
      expect(getAnimatedValue(5, keyframes)).toBe(50);
    });

    it('should return last keyframe value after last keyframe', () => {
      const keyframes: Keyframe[] = [
        { frame: 0, value: 0 },
        { frame: 30, value: 100 },
      ];
      expect(getAnimatedValue(40, keyframes)).toBe(100);
      expect(getAnimatedValue(100, keyframes)).toBe(100);
    });
  });

  describe('multiple keyframes', () => {
    it('should interpolate correct segment for given frame', () => {
      const keyframes: Keyframe[] = [
        { frame: 0, value: 0 },
        { frame: 30, value: 100 },
        { frame: 60, value: 50 },
      ];
      // Between first two keyframes
      expect(getAnimatedValue(15, keyframes)).toBe(50);
      // At second keyframe
      expect(getAnimatedValue(30, keyframes)).toBe(100);
      // Between second and third keyframes (30->60, 100->50)
      expect(getAnimatedValue(45, keyframes)).toBe(75); // midpoint
    });
  });

  describe('out-of-order keyframes', () => {
    it('should sort keyframes internally and return correct value', () => {
      // Keyframes given in wrong order
      const keyframes: Keyframe[] = [
        { frame: 30, value: 100 },
        { frame: 0, value: 0 },
        { frame: 60, value: 50 },
      ];
      expect(getAnimatedValue(0, keyframes)).toBe(0);
      expect(getAnimatedValue(15, keyframes)).toBe(50);
      expect(getAnimatedValue(30, keyframes)).toBe(100);
      expect(getAnimatedValue(45, keyframes)).toBe(75);
    });
  });

  describe('keyframe easing', () => {
    it('should apply keyframe-specific easing', () => {
      const keyframes: Keyframe[] = [
        { frame: 0, value: 0 },
        { frame: 30, value: 100, easing: 'easeIn' },
      ];
      // easeIn at t=0.5 gives t*t = 0.25
      expect(getAnimatedValue(15, keyframes)).toBe(25);
    });

    it('should apply default easing when no keyframe easing specified', () => {
      const keyframes: Keyframe[] = [
        { frame: 0, value: 0 },
        { frame: 30, value: 100 },
      ];
      // With easeIn default, t=0.5 gives 0.25
      expect(getAnimatedValue(15, keyframes, easeIn)).toBe(25);
    });

    it('should prioritize keyframe easing over default', () => {
      const keyframes: Keyframe[] = [
        { frame: 0, value: 0 },
        { frame: 30, value: 100, easing: 'easeOut' },
      ];
      // easeOut at t=0.5 gives 0.75, even with easeIn default
      expect(getAnimatedValue(15, keyframes, easeIn)).toBe(75);
    });
  });

  describe('empty keyframes', () => {
    it('should return 0 for empty keyframes array', () => {
      expect(getAnimatedValue(10, [])).toBe(0);
    });
  });
});

describe('getAnimatedElement', () => {
  // Helper to create a minimal base element
  const createBaseElement = () => ({
    type: 'text' as const,
    text: 'Hello',
    x: 100,
    y: 200,
    fontFamily: 'Inter',
    fontSize: 32,
    fontWeight: 400,
    fontStyle: 'normal' as const,
    color: '#ffffff',
    textAlign: 'left' as const,
    lineHeight: 1.2,
    padding: 0,
    borderRadius: 0,
  });

  describe('time visibility', () => {
    it('should return null when frame is before startTime', () => {
      const element = {
        ...createBaseElement(),
        startTime: 2, // starts at 2 seconds
      };
      const fps = 30;
      // Frame 30 = 1 second, which is before startTime of 2 seconds
      const result = getAnimatedElement(element, 30, fps);
      expect(result).toBeNull();
    });

    it('should return null when frame is at or after endTime', () => {
      const element = {
        ...createBaseElement(),
        endTime: 3, // ends at 3 seconds
      };
      const fps = 30;
      // Frame 90 = 3 seconds, which is at endTime
      const result = getAnimatedElement(element, 90, fps);
      expect(result).toBeNull();
    });

    it('should return element when frame is within range', () => {
      const element = {
        ...createBaseElement(),
        startTime: 1,
        endTime: 3,
      };
      const fps = 30;
      // Frame 60 = 2 seconds, which is within [1, 3)
      const result = getAnimatedElement(element, 60, fps);
      expect(result).not.toBeNull();
      expect(result?.x).toBe(100);
    });

    it('should return element when no time bounds specified', () => {
      const element = createBaseElement();
      const fps = 30;
      const result = getAnimatedElement(element, 0, fps);
      expect(result).not.toBeNull();
    });
  });

  describe('animated properties', () => {
    it('should merge animated x value with static element', () => {
      const animations: PropertyAnimation[] = [
        {
          property: 'x',
          keyframes: [
            { frame: 0, value: 0 },
            { frame: 30, value: 200 },
          ],
        },
      ];
      const element = {
        ...createBaseElement(),
        animations,
      };
      const fps = 30;
      const result = getAnimatedElement(element, 15, fps);
      expect(result).not.toBeNull();
      expect(result?.x).toBe(100); // midpoint = 100
    });

    it('should animate opacity', () => {
      const animations: PropertyAnimation[] = [
        {
          property: 'opacity',
          keyframes: [
            { frame: 0, value: 0 },
            { frame: 30, value: 1 },
          ],
        },
      ];
      const element = {
        ...createBaseElement(),
        animations,
      };
      const fps = 30;
      const result = getAnimatedElement(element, 15, fps);
      expect(result).not.toBeNull();
      expect(result?.opacity).toBe(0.5);
    });

    it('should animate multiple properties simultaneously', () => {
      const animations: PropertyAnimation[] = [
        {
          property: 'x',
          keyframes: [
            { frame: 0, value: 0 },
            { frame: 30, value: 100 },
          ],
        },
        {
          property: 'y',
          keyframes: [
            { frame: 0, value: 0 },
            { frame: 30, value: 200 },
          ],
        },
      ];
      const element = {
        ...createBaseElement(),
        animations,
      };
      const fps = 30;
      const result = getAnimatedElement(element, 15, fps);
      expect(result).not.toBeNull();
      expect(result?.x).toBe(50);
      expect(result?.y).toBe(100);
    });

    it('should preserve non-animated properties', () => {
      const animations: PropertyAnimation[] = [
        {
          property: 'x',
          keyframes: [
            { frame: 0, value: 0 },
            { frame: 30, value: 100 },
          ],
        },
      ];
      const element = {
        ...createBaseElement(),
        animations,
      };
      const fps = 30;
      const result = getAnimatedElement(element, 15, fps);
      expect(result).not.toBeNull();
      expect(result?.text).toBe('Hello');
      expect(result?.fontSize).toBe(32);
      expect(result?.y).toBe(200); // not animated, stays static
    });
  });

  describe('animation timing relative to element startTime', () => {
    it('should use frame directly (animation engine uses absolute frames)', () => {
      // Animation keyframes use absolute frame numbers
      const animations: PropertyAnimation[] = [
        {
          property: 'opacity',
          keyframes: [
            { frame: 30, value: 0 }, // starts at frame 30
            { frame: 60, value: 1 }, // ends at frame 60
          ],
        },
      ];
      const element = {
        ...createBaseElement(),
        startTime: 1, // element visible from 1 second
        animations,
      };
      const fps = 30;
      // At frame 45 (1.5 seconds), midpoint of animation
      const result = getAnimatedElement(element, 45, fps);
      expect(result).not.toBeNull();
      expect(result?.opacity).toBe(0.5);
    });
  });
});
