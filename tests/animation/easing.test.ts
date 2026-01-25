import { describe, it, expect } from 'vitest';
import {
  linear,
  easeIn,
  easeOut,
  easeInOut,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInBounce,
  easeOutBounce,
  easeInOutBounce,
  easeInElastic,
  easeOutElastic,
  easeInOutElastic,
  getEasingFunction,
} from '../../src/animation/easing.js';
import type { EasingFunction, EasingName } from '../../src/animation/types.js';

/**
 * Easing function tests following TDD approach
 * Tests boundary values (t=0, t=0.5, t=1) for all easing functions
 */

describe('Easing Functions', () => {
  // Helper for approximate equality with floating point
  const closeTo = (a: number, b: number, epsilon = 0.0001) => {
    return Math.abs(a - b) < epsilon;
  };

  describe('linear', () => {
    it('returns 0 at t=0', () => {
      expect(linear(0)).toBe(0);
    });

    it('returns 0.5 at t=0.5', () => {
      expect(linear(0.5)).toBe(0.5);
    });

    it('returns 1 at t=1', () => {
      expect(linear(1)).toBe(1);
    });
  });

  describe('easeIn (quadratic)', () => {
    it('returns 0 at t=0', () => {
      expect(easeIn(0)).toBe(0);
    });

    it('returns 0.25 at t=0.5', () => {
      expect(easeIn(0.5)).toBe(0.25);
    });

    it('returns 1 at t=1', () => {
      expect(easeIn(1)).toBe(1);
    });
  });

  describe('easeOut (quadratic)', () => {
    it('returns 0 at t=0', () => {
      expect(easeOut(0)).toBe(0);
    });

    it('returns 0.75 at t=0.5', () => {
      expect(easeOut(0.5)).toBe(0.75);
    });

    it('returns 1 at t=1', () => {
      expect(easeOut(1)).toBe(1);
    });
  });

  describe('easeInOut (quadratic)', () => {
    it('returns 0 at t=0', () => {
      expect(easeInOut(0)).toBe(0);
    });

    it('returns 0.5 at t=0.5', () => {
      expect(easeInOut(0.5)).toBe(0.5);
    });

    it('returns 1 at t=1', () => {
      expect(easeInOut(1)).toBe(1);
    });

    it('has S-curve - accelerates then decelerates', () => {
      // First half accelerates (value < midpoint)
      expect(easeInOut(0.25)).toBeLessThan(0.25);
      // Second half decelerates (value > midpoint)
      expect(easeInOut(0.75)).toBeGreaterThan(0.75);
    });
  });

  describe('easeInCubic', () => {
    it('returns 0 at t=0', () => {
      expect(easeInCubic(0)).toBe(0);
    });

    it('returns 0.125 at t=0.5', () => {
      expect(easeInCubic(0.5)).toBe(0.125);
    });

    it('returns 1 at t=1', () => {
      expect(easeInCubic(1)).toBe(1);
    });
  });

  describe('easeOutCubic', () => {
    it('returns 0 at t=0', () => {
      expect(easeOutCubic(0)).toBe(0);
    });

    it('returns 0.875 at t=0.5', () => {
      expect(easeOutCubic(0.5)).toBe(0.875);
    });

    it('returns 1 at t=1', () => {
      expect(easeOutCubic(1)).toBe(1);
    });
  });

  describe('easeInOutCubic', () => {
    it('returns 0 at t=0', () => {
      expect(easeInOutCubic(0)).toBe(0);
    });

    it('returns 0.5 at t=0.5', () => {
      expect(easeInOutCubic(0.5)).toBe(0.5);
    });

    it('returns 1 at t=1', () => {
      expect(easeInOutCubic(1)).toBe(1);
    });
  });

  describe('easeOutBounce', () => {
    it('returns 0 at t=0', () => {
      expect(easeOutBounce(0)).toBe(0);
    });

    it('returns 1 at t=1', () => {
      expect(easeOutBounce(1)).toBe(1);
    });

    it('bounces - creates multiple peaks', () => {
      // The function should have varying values showing bounce behavior
      // At around t=0.9, it should be close to 1 but not exactly 1
      const value = easeOutBounce(0.9);
      expect(value).toBeGreaterThan(0.9);
    });
  });

  describe('easeInBounce', () => {
    it('returns 0 at t=0', () => {
      expect(easeInBounce(0)).toBe(0);
    });

    it('returns 1 at t=1', () => {
      expect(easeInBounce(1)).toBe(1);
    });

    it('bounces at start - values can go negative initially', () => {
      // Early in the animation, bounce may dip below 0
      const value = easeInBounce(0.1);
      // Just verify it's a small value (may be negative or positive depending on bounce phase)
      expect(value).toBeLessThan(0.5);
    });
  });

  describe('easeInOutBounce', () => {
    it('returns 0 at t=0', () => {
      expect(easeInOutBounce(0)).toBe(0);
    });

    it('returns approximately 0.5 at t=0.5', () => {
      expect(closeTo(easeInOutBounce(0.5), 0.5)).toBe(true);
    });

    it('returns 1 at t=1', () => {
      expect(easeInOutBounce(1)).toBe(1);
    });
  });

  describe('easeOutElastic', () => {
    it('returns 0 at t=0', () => {
      expect(easeOutElastic(0)).toBe(0);
    });

    it('returns 1 at t=1', () => {
      expect(easeOutElastic(1)).toBe(1);
    });

    it('may overshoot past 1 during oscillation', () => {
      // Elastic easing overshoots the target
      // At around t=0.3, the elastic function should overshoot 1
      const value = easeOutElastic(0.3);
      // It should be noticeably above the linear value
      expect(value).toBeGreaterThan(0.3);
    });
  });

  describe('easeInElastic', () => {
    it('returns 0 at t=0', () => {
      expect(easeInElastic(0)).toBe(0);
    });

    it('returns 1 at t=1', () => {
      expect(easeInElastic(1)).toBe(1);
    });

    it('may undershoot below 0 during oscillation', () => {
      // Early in the animation, elastic may dip below 0
      const value = easeInElastic(0.1);
      // Should be a small or negative value
      expect(value).toBeLessThan(0.2);
    });
  });

  describe('easeInOutElastic', () => {
    it('returns 0 at t=0', () => {
      expect(easeInOutElastic(0)).toBe(0);
    });

    it('returns 1 at t=1', () => {
      expect(easeInOutElastic(1)).toBe(1);
    });

    it('oscillates around endpoints', () => {
      // The function should oscillate, creating non-linear intermediate values
      const earlyValue = easeInOutElastic(0.2);
      const lateValue = easeInOutElastic(0.8);
      // Early should be less than late
      expect(earlyValue).toBeLessThan(lateValue);
    });
  });

  describe('getEasingFunction', () => {
    it('returns linear function for "linear"', () => {
      const fn = getEasingFunction('linear');
      expect(fn(0.5)).toBe(0.5);
    });

    it('returns easeIn function for "easeIn"', () => {
      const fn = getEasingFunction('easeIn');
      expect(fn(0.5)).toBe(0.25);
    });

    it('returns easeOut function for "easeOut"', () => {
      const fn = getEasingFunction('easeOut');
      expect(fn(0.5)).toBe(0.75);
    });

    it('returns easeInOut function for "easeInOut"', () => {
      const fn = getEasingFunction('easeInOut');
      expect(fn(0.5)).toBe(0.5);
    });

    it('returns easeInCubic function for "easeInCubic"', () => {
      const fn = getEasingFunction('easeInCubic');
      expect(fn(0.5)).toBe(0.125);
    });

    it('returns easeOutCubic function for "easeOutCubic"', () => {
      const fn = getEasingFunction('easeOutCubic');
      expect(fn(0.5)).toBe(0.875);
    });

    it('returns easeInOutCubic function for "easeInOutCubic"', () => {
      const fn = getEasingFunction('easeInOutCubic');
      expect(fn(0.5)).toBe(0.5);
    });

    it('returns easeInBounce function for "easeInBounce"', () => {
      const fn = getEasingFunction('easeInBounce');
      expect(fn(0)).toBe(0);
      expect(fn(1)).toBe(1);
    });

    it('returns easeOutBounce function for "easeOutBounce"', () => {
      const fn = getEasingFunction('easeOutBounce');
      expect(fn(0)).toBe(0);
      expect(fn(1)).toBe(1);
    });

    it('returns easeInOutBounce function for "easeInOutBounce"', () => {
      const fn = getEasingFunction('easeInOutBounce');
      expect(fn(0)).toBe(0);
      expect(fn(1)).toBe(1);
    });

    it('returns easeInElastic function for "easeInElastic"', () => {
      const fn = getEasingFunction('easeInElastic');
      expect(fn(0)).toBe(0);
      expect(fn(1)).toBe(1);
    });

    it('returns easeOutElastic function for "easeOutElastic"', () => {
      const fn = getEasingFunction('easeOutElastic');
      expect(fn(0)).toBe(0);
      expect(fn(1)).toBe(1);
    });

    it('returns easeInOutElastic function for "easeInOutElastic"', () => {
      const fn = getEasingFunction('easeInOutElastic');
      expect(fn(0)).toBe(0);
      expect(fn(1)).toBe(1);
    });

    it('returns linear as fallback for unknown names', () => {
      const fn = getEasingFunction('invalidName' as EasingName);
      expect(fn(0.5)).toBe(0.5); // linear behavior
    });
  });

  describe('All functions boundary values', () => {
    const easingFunctions = [
      { name: 'linear', fn: linear },
      { name: 'easeIn', fn: easeIn },
      { name: 'easeOut', fn: easeOut },
      { name: 'easeInOut', fn: easeInOut },
      { name: 'easeInCubic', fn: easeInCubic },
      { name: 'easeOutCubic', fn: easeOutCubic },
      { name: 'easeInOutCubic', fn: easeInOutCubic },
      { name: 'easeInBounce', fn: easeInBounce },
      { name: 'easeOutBounce', fn: easeOutBounce },
      { name: 'easeInOutBounce', fn: easeInOutBounce },
      { name: 'easeInElastic', fn: easeInElastic },
      { name: 'easeOutElastic', fn: easeOutElastic },
      { name: 'easeInOutElastic', fn: easeInOutElastic },
    ];

    easingFunctions.forEach(({ name, fn }) => {
      it(`${name} returns 0 at t=0`, () => {
        expect(fn(0)).toBe(0);
      });

      it(`${name} returns 1 at t=1`, () => {
        expect(fn(1)).toBe(1);
      });
    });
  });

  describe('Type safety', () => {
    it('EasingFunction type matches signature', () => {
      const fn: EasingFunction = (t: number) => t;
      expect(fn(0.5)).toBe(0.5);
    });

    it('all exported functions match EasingFunction type', () => {
      const fns: EasingFunction[] = [
        linear,
        easeIn,
        easeOut,
        easeInOut,
        easeInCubic,
        easeOutCubic,
        easeInOutCubic,
        easeInBounce,
        easeOutBounce,
        easeInOutBounce,
        easeInElastic,
        easeOutElastic,
        easeInOutElastic,
      ];
      expect(fns.length).toBe(13);
    });
  });
});
