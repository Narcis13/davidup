import { describe, it, expect } from 'vitest';
import { interpolate } from '../../src/animation/interpolate.js';
import { easeIn, easeOut, linear } from '../../src/animation/easing.js';

describe('interpolate', () => {
  describe('linear interpolation', () => {
    it('should return start of output range at start of input range', () => {
      expect(interpolate(0, [0, 30], [0, 100])).toBe(0);
    });

    it('should return middle of output range at middle of input range', () => {
      expect(interpolate(15, [0, 30], [0, 100])).toBe(50);
    });

    it('should return end of output range at end of input range', () => {
      expect(interpolate(30, [0, 30], [0, 100])).toBe(100);
    });

    it('should handle non-zero start frame', () => {
      // frame 60 is middle of [30, 90], output should be middle of [0, 100]
      expect(interpolate(60, [30, 90], [0, 100])).toBe(50);
    });

    it('should handle reversed output range', () => {
      // [100, 0] output means value decreases as frame increases
      expect(interpolate(0, [0, 30], [100, 0])).toBe(100);
      expect(interpolate(15, [0, 30], [100, 0])).toBe(50);
      expect(interpolate(30, [0, 30], [100, 0])).toBe(0);
    });
  });

  describe('clamping (default behavior)', () => {
    it('should clamp to start of output range when below input range', () => {
      expect(interpolate(-5, [0, 30], [0, 100])).toBe(0);
    });

    it('should clamp to end of output range when above input range', () => {
      expect(interpolate(35, [0, 30], [0, 100])).toBe(100);
    });

    it('should clamp with explicit extrapolateLeft=clamp', () => {
      expect(interpolate(-5, [0, 30], [0, 100], { extrapolateLeft: 'clamp' })).toBe(0);
    });

    it('should clamp with explicit extrapolateRight=clamp', () => {
      expect(interpolate(35, [0, 30], [0, 100], { extrapolateRight: 'clamp' })).toBe(100);
    });
  });

  describe('extend extrapolation', () => {
    it('should extend below input range when extrapolateLeft=extend', () => {
      // frame=-5 is 5 below 0, which is 5/30 of the range = 16.67% before start
      // Expected: 0 - (16.67% of 100) = -16.67
      const result = interpolate(-5, [0, 30], [0, 100], { extrapolateLeft: 'extend' });
      expect(result).toBeCloseTo(-16.67, 1);
    });

    it('should extend above input range when extrapolateRight=extend', () => {
      // frame=35 is 5 above 30, which is 5/30 of the range = 16.67% after end
      // Expected: 100 + (16.67% of 100) = 116.67
      const result = interpolate(35, [0, 30], [0, 100], { extrapolateRight: 'extend' });
      expect(result).toBeCloseTo(116.67, 1);
    });

    it('should handle extend with reversed output range', () => {
      // frame=-5 with output [100, 0] should extend ABOVE 100
      const result = interpolate(-5, [0, 30], [100, 0], { extrapolateLeft: 'extend' });
      expect(result).toBeCloseTo(116.67, 1);
    });
  });

  describe('easing', () => {
    it('should apply easeIn (slower start)', () => {
      // At midpoint with easeIn (t*t), t=0.5 gives 0.25
      const result = interpolate(15, [0, 30], [0, 100], { easing: easeIn });
      expect(result).toBe(25); // easeIn at t=0.5 is 0.25
    });

    it('should apply easeOut (faster start)', () => {
      // At midpoint with easeOut, t=0.5 gives t*(2-t) = 0.5*1.5 = 0.75
      const result = interpolate(15, [0, 30], [0, 100], { easing: easeOut });
      expect(result).toBe(75);
    });

    it('should apply linear easing explicitly', () => {
      const result = interpolate(15, [0, 30], [0, 100], { easing: linear });
      expect(result).toBe(50);
    });

    it('should work without easing option (defaults to linear)', () => {
      const withoutEasing = interpolate(15, [0, 30], [0, 100]);
      const withLinear = interpolate(15, [0, 30], [0, 100], { easing: linear });
      expect(withoutEasing).toBe(withLinear);
    });
  });

  describe('edge cases', () => {
    it('should handle same start and end input (division by zero)', () => {
      // When inputRange[0] === inputRange[1], should return outputRange[0]
      expect(interpolate(10, [10, 10], [0, 100])).toBe(0);
    });

    it('should handle negative output range', () => {
      expect(interpolate(15, [0, 30], [-100, 100])).toBe(0);
      expect(interpolate(0, [0, 30], [-100, 100])).toBe(-100);
    });
  });
});
