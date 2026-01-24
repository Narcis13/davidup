import { describe, it, expect } from 'vitest';
import { validateVideoSpec } from '../../src/validators/spec-validator.js';

describe('validateVideoSpec', () => {
  // ===========================================
  // Valid Specs - Should Return Success
  // ===========================================

  describe('valid specs', () => {
    it('should accept valid spec with all fields', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: 1080, fps: 30, duration: 60 }
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.output.width).toBe(1920);
        expect(result.data.output.height).toBe(1080);
        expect(result.data.output.fps).toBe(30);
        expect(result.data.output.duration).toBe(60);
      }
    });

    it('should apply default fps (30) when not specified', () => {
      const result = validateVideoSpec({
        output: { width: 1280, height: 720, duration: 60 }
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.output.fps).toBe(30);
      }
    });

    it('should accept minimum valid values (1x1, 1fps, small duration)', () => {
      const result = validateVideoSpec({
        output: { width: 1, height: 1, fps: 1, duration: 0.001 }
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.output.width).toBe(1);
        expect(result.data.output.height).toBe(1);
        expect(result.data.output.fps).toBe(1);
        expect(result.data.output.duration).toBe(0.001);
      }
    });

    it('should accept maximum valid values (1920x1920, 60fps, 300s)', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: 1920, fps: 60, duration: 300 }
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.output.width).toBe(1920);
        expect(result.data.output.height).toBe(1920);
        expect(result.data.output.fps).toBe(60);
        expect(result.data.output.duration).toBe(300);
      }
    });

    it('should accept common video resolutions', () => {
      const resolutions = [
        { width: 1920, height: 1080 }, // 1080p
        { width: 1280, height: 720 },  // 720p
        { width: 854, height: 480 },   // 480p
        { width: 640, height: 360 },   // 360p
      ];

      for (const res of resolutions) {
        const result = validateVideoSpec({
          output: { ...res, duration: 30 }
        });
        expect(result.success).toBe(true);
      }
    });
  });

  // ===========================================
  // Invalid Dimensions - Should Fail
  // ===========================================

  describe('invalid dimensions', () => {
    it('should reject width exceeding 1920', () => {
      const result = validateVideoSpec({
        output: { width: 2000, height: 1080, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.width');
      }
    });

    it('should reject height exceeding 1920', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: 2000, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.height');
      }
    });

    it('should reject width of 0', () => {
      const result = validateVideoSpec({
        output: { width: 0, height: 1080, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.width');
      }
    });

    it('should reject negative width', () => {
      const result = validateVideoSpec({
        output: { width: -100, height: 1080, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.width');
      }
    });

    it('should reject negative height', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: -100, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.height');
      }
    });

    it('should reject non-integer width', () => {
      const result = validateVideoSpec({
        output: { width: 1920.5, height: 1080, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.width');
      }
    });

    it('should reject non-integer height', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: 1080.5, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.height');
      }
    });
  });

  // ===========================================
  // Invalid FPS - Should Fail
  // ===========================================

  describe('invalid fps', () => {
    it('should reject fps exceeding 60', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: 1080, fps: 120, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.fps');
      }
    });

    it('should reject fps less than 1', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: 1080, fps: 0, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.fps');
      }
    });

    it('should reject negative fps', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: 1080, fps: -30, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.fps');
      }
    });

    it('should reject non-integer fps', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: 1080, fps: 29.97, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.fps');
      }
    });
  });

  // ===========================================
  // Invalid Duration - Should Fail
  // ===========================================

  describe('invalid duration', () => {
    it('should reject duration exceeding 300 seconds', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: 1080, duration: 301 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.duration');
      }
    });

    it('should reject duration of 0', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: 1080, duration: 0 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.duration');
      }
    });

    it('should reject negative duration', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: 1080, duration: -60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.duration');
      }
    });
  });

  // ===========================================
  // Missing Required Fields - Should Fail
  // ===========================================

  describe('missing required fields', () => {
    it('should reject missing width', () => {
      const result = validateVideoSpec({
        output: { height: 1080, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.width');
      }
    });

    it('should reject missing height', () => {
      const result = validateVideoSpec({
        output: { width: 1920, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.height');
      }
    });

    it('should reject missing duration', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: 1080 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.duration');
      }
    });

    it('should reject missing output object', () => {
      const result = validateVideoSpec({});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output');
      }
    });
  });

  // ===========================================
  // Wrong Types - Should Fail
  // ===========================================

  describe('wrong types', () => {
    it('should reject string instead of number for width', () => {
      const result = validateVideoSpec({
        output: { width: '1920', height: 1080, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.width');
      }
    });

    it('should reject string instead of number for height', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: '1080', duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.height');
      }
    });

    it('should reject string instead of number for fps', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: 1080, fps: '30', duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.fps');
      }
    });

    it('should reject string instead of number for duration', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: 1080, duration: '60' }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors).toHaveProperty('output.duration');
      }
    });

    it('should reject array instead of object for output', () => {
      const result = validateVideoSpec({
        output: [1920, 1080, 30, 60]
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBeTruthy();
      }
    });
  });

  // ===========================================
  // Null/Undefined Input - Should Fail
  // ===========================================

  describe('null/undefined input', () => {
    it('should reject null input', () => {
      const result = validateVideoSpec(null);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBeTruthy();
      }
    });

    it('should reject undefined input', () => {
      const result = validateVideoSpec(undefined);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBeTruthy();
      }
    });

    it('should reject null output', () => {
      const result = validateVideoSpec({ output: null });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBeTruthy();
      }
    });
  });

  // ===========================================
  // Multiple Errors - Should Return All
  // ===========================================

  describe('multiple errors', () => {
    it('should return all field errors, not just first', () => {
      const result = validateVideoSpec({
        output: { width: 5000, height: 5000, fps: 120, duration: 500 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        // Should have errors for multiple fields
        expect(result.error.fieldErrors).toHaveProperty('output.width');
        expect(result.error.fieldErrors).toHaveProperty('output.height');
        expect(result.error.fieldErrors).toHaveProperty('output.fps');
        expect(result.error.fieldErrors).toHaveProperty('output.duration');
      }
    });

    it('should return errors for multiple missing required fields', () => {
      const result = validateVideoSpec({
        output: { width: 1920 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        // Should have errors for height and duration
        expect(result.error.fieldErrors).toHaveProperty('output.height');
        expect(result.error.fieldErrors).toHaveProperty('output.duration');
      }
    });
  });

  // ===========================================
  // Error Message Quality
  // ===========================================

  describe('error message quality', () => {
    it('should provide user-friendly error message for exceeding width', () => {
      const result = validateVideoSpec({
        output: { width: 2000, height: 1080, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const widthErrors = result.error.fieldErrors['output.width'];
        expect(widthErrors).toBeDefined();
        expect(widthErrors!.length).toBeGreaterThan(0);
        // Error message should mention the limit or be descriptive
        expect(widthErrors![0]).toMatch(/1920|max|exceed/i);
      }
    });

    it('should provide user-friendly error message for exceeding fps', () => {
      const result = validateVideoSpec({
        output: { width: 1920, height: 1080, fps: 120, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const fpsErrors = result.error.fieldErrors['output.fps'];
        expect(fpsErrors).toBeDefined();
        expect(fpsErrors!.length).toBeGreaterThan(0);
        // Error message should mention the limit or be descriptive
        expect(fpsErrors![0]).toMatch(/60|max|exceed/i);
      }
    });

    it('should provide overall error message summarizing issues', () => {
      const result = validateVideoSpec({
        output: { width: 2000, height: 1080, duration: 60 }
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBeTruthy();
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });
});
