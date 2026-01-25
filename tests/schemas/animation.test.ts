import { describe, expect, it } from 'vitest';
import {
  EasingNameSchema,
  KeyframeSchema,
  PropertyAnimationSchema,
  AnimationPresetSchema,
  TransitionSchema,
} from '../../src/schemas/animation.js';

describe('EasingNameSchema', () => {
  it('should accept all 12 valid easing names', () => {
    const validEasings = [
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
    ];

    for (const easing of validEasings) {
      const result = EasingNameSchema.safeParse(easing);
      expect(result.success, `Expected '${easing}' to be valid`).toBe(true);
    }
  });

  it('should reject invalid easing names', () => {
    const result = EasingNameSchema.safeParse('invalid');
    expect(result.success).toBe(false);
  });
});

describe('KeyframeSchema', () => {
  it('should parse valid keyframe with time and value', () => {
    const result = KeyframeSchema.safeParse({
      time: 0,
      value: 100,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.time).toBe(0);
      expect(result.data.value).toBe(100);
      expect(result.data.easing).toBeUndefined();
    }
  });

  it('should parse keyframe with optional easing', () => {
    const result = KeyframeSchema.safeParse({
      time: 1.5,
      value: 200,
      easing: 'easeInOut',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.easing).toBe('easeInOut');
    }
  });

  it('should reject keyframe with negative time', () => {
    const result = KeyframeSchema.safeParse({
      time: -1,
      value: 100,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Keyframe time must be non-negative');
    }
  });

  it('should accept keyframe with zero time', () => {
    const result = KeyframeSchema.safeParse({
      time: 0,
      value: 50,
    });
    expect(result.success).toBe(true);
  });

  it('should accept negative values', () => {
    const result = KeyframeSchema.safeParse({
      time: 0,
      value: -50,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.value).toBe(-50);
    }
  });
});

describe('PropertyAnimationSchema', () => {
  it('should parse valid property animation', () => {
    const result = PropertyAnimationSchema.safeParse({
      property: 'x',
      keyframes: [
        { time: 0, value: 0 },
        { time: 1, value: 100 },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.property).toBe('x');
      expect(result.data.keyframes).toHaveLength(2);
    }
  });

  it('should accept all valid property names', () => {
    const properties = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'];

    for (const property of properties) {
      const result = PropertyAnimationSchema.safeParse({
        property,
        keyframes: [{ time: 0, value: 1 }],
      });
      expect(result.success, `Expected property '${property}' to be valid`).toBe(true);
    }
  });

  it('should reject property animation with empty keyframes', () => {
    const result = PropertyAnimationSchema.safeParse({
      property: 'opacity',
      keyframes: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'Property animation must have at least one keyframe'
      );
    }
  });

  it('should reject invalid property names', () => {
    const result = PropertyAnimationSchema.safeParse({
      property: 'width',
      keyframes: [{ time: 0, value: 100 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('AnimationPresetSchema', () => {
  it('should parse valid preset with defaults', () => {
    const result = AnimationPresetSchema.safeParse({
      type: 'fade',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('fade');
      expect(result.data.duration).toBe(0.5);
      expect(result.data.direction).toBeUndefined();
    }
  });

  it('should parse preset with all options', () => {
    const result = AnimationPresetSchema.safeParse({
      type: 'slide',
      duration: 1.0,
      direction: 'left',
      distance: 200,
      easing: 'easeOutCubic',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('slide');
      expect(result.data.duration).toBe(1.0);
      expect(result.data.direction).toBe('left');
      expect(result.data.distance).toBe(200);
      expect(result.data.easing).toBe('easeOutCubic');
    }
  });

  it('should accept all preset types', () => {
    const types = ['fade', 'slide', 'scale', 'bounce'];

    for (const type of types) {
      const result = AnimationPresetSchema.safeParse({ type });
      expect(result.success, `Expected type '${type}' to be valid`).toBe(true);
    }
  });

  it('should reject negative duration', () => {
    const result = AnimationPresetSchema.safeParse({
      type: 'fade',
      duration: -0.5,
    });
    expect(result.success).toBe(false);
  });

  it('should reject zero duration', () => {
    const result = AnimationPresetSchema.safeParse({
      type: 'fade',
      duration: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('TransitionSchema', () => {
  it('should parse valid transition with defaults', () => {
    const result = TransitionSchema.safeParse({
      type: 'fade',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('fade');
      expect(result.data.duration).toBe(0.5);
    }
  });

  it('should parse transition with all options', () => {
    const result = TransitionSchema.safeParse({
      type: 'slide',
      duration: 0.8,
      direction: 'up',
      easing: 'easeInOutCubic',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('slide');
      expect(result.data.duration).toBe(0.8);
      expect(result.data.direction).toBe('up');
      expect(result.data.easing).toBe('easeInOutCubic');
    }
  });

  it('should accept all transition types', () => {
    const types = ['fade', 'slide', 'zoom'];

    for (const type of types) {
      const result = TransitionSchema.safeParse({ type });
      expect(result.success, `Expected type '${type}' to be valid`).toBe(true);
    }
  });

  it('should accept all direction values', () => {
    const directions = ['left', 'right', 'up', 'down'];

    for (const direction of directions) {
      const result = TransitionSchema.safeParse({
        type: 'slide',
        direction,
      });
      expect(result.success, `Expected direction '${direction}' to be valid`).toBe(true);
    }
  });

  it('should reject invalid transition type', () => {
    const result = TransitionSchema.safeParse({
      type: 'wipe',
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative duration', () => {
    const result = TransitionSchema.safeParse({
      type: 'fade',
      duration: -1,
    });
    expect(result.success).toBe(false);
  });
});
