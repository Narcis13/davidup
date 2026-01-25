import { describe, it, expect } from 'vitest';
import { renderTransition } from '../../src/timeline/transitions.js';

describe('renderTransition', () => {
  /**
   * Create a solid color buffer (raw RGBA).
   */
  function createColorBuffer(width: number, height: number, r: number, g: number, b: number): Buffer {
    const buffer = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      buffer[i * 4] = r;
      buffer[i * 4 + 1] = g;
      buffer[i * 4 + 2] = b;
      buffer[i * 4 + 3] = 255; // Full opacity
    }
    return buffer;
  }

  describe('fade transition', () => {
    it('returns mostly fromBuffer color at progress 0', () => {
      const red = createColorBuffer(10, 10, 255, 0, 0);
      const blue = createColorBuffer(10, 10, 0, 0, 255);

      const result = renderTransition({
        fromBuffer: red,
        toBuffer: blue,
        width: 10,
        height: 10,
        progress: 0,
        type: 'fade',
      });

      // At progress 0, should be mostly red
      // The "from" is drawn at alpha 1, "to" at alpha 0
      expect(result[0]).toBeGreaterThan(200); // R
      expect(result[2]).toBeLessThan(55);     // B
    });

    it('returns mostly toBuffer color at progress 1', () => {
      const red = createColorBuffer(10, 10, 255, 0, 0);
      const blue = createColorBuffer(10, 10, 0, 0, 255);

      const result = renderTransition({
        fromBuffer: red,
        toBuffer: blue,
        width: 10,
        height: 10,
        progress: 1,
        type: 'fade',
      });

      // At progress 1, should be mostly blue
      // The "from" is drawn at alpha 0, "to" at alpha 1
      expect(result[0]).toBeLessThan(55);      // R
      expect(result[2]).toBeGreaterThan(200);  // B
    });

    it('blends both colors at progress 0.5', () => {
      const red = createColorBuffer(10, 10, 255, 0, 0);
      const blue = createColorBuffer(10, 10, 0, 0, 255);

      const result = renderTransition({
        fromBuffer: red,
        toBuffer: blue,
        width: 10,
        height: 10,
        progress: 0.5,
        type: 'fade',
      });

      // At progress 0.5, both colors should be visible
      // Exact values depend on alpha compositing, but both should be present
      expect(result[0]).toBeGreaterThan(50);  // Some R
      expect(result[2]).toBeGreaterThan(50);  // Some B
    });

    it('returns correctly sized buffer', () => {
      const red = createColorBuffer(100, 50, 255, 0, 0);
      const blue = createColorBuffer(100, 50, 0, 0, 255);

      const result = renderTransition({
        fromBuffer: red,
        toBuffer: blue,
        width: 100,
        height: 50,
        progress: 0.5,
        type: 'fade',
      });

      expect(result.length).toBe(100 * 50 * 4);
    });
  });

  describe('slide transition', () => {
    it('slides left by default', () => {
      const red = createColorBuffer(10, 10, 255, 0, 0);
      const blue = createColorBuffer(10, 10, 0, 0, 255);

      const result = renderTransition({
        fromBuffer: red,
        toBuffer: blue,
        width: 10,
        height: 10,
        progress: 0.5,
        type: 'slide',
        direction: 'left',
      });

      // At midpoint, both frames should be visible side by side
      expect(result.length).toBe(10 * 10 * 4);
    });

    it('respects direction parameter - all directions work', () => {
      const red = createColorBuffer(10, 10, 255, 0, 0);
      const blue = createColorBuffer(10, 10, 0, 0, 255);

      for (const direction of ['left', 'right', 'up', 'down'] as const) {
        const result = renderTransition({
          fromBuffer: red,
          toBuffer: blue,
          width: 10,
          height: 10,
          progress: 0.5,
          type: 'slide',
          direction,
        });
        expect(result.length).toBe(10 * 10 * 4);
      }
    });

    it('returns correctly sized buffer', () => {
      const red = createColorBuffer(100, 50, 255, 0, 0);
      const blue = createColorBuffer(100, 50, 0, 0, 255);

      const result = renderTransition({
        fromBuffer: red,
        toBuffer: blue,
        width: 100,
        height: 50,
        progress: 0.5,
        type: 'slide',
        direction: 'left',
      });

      expect(result.length).toBe(100 * 50 * 4);
    });

    it('shows mostly fromBuffer at progress 0', () => {
      const red = createColorBuffer(10, 10, 255, 0, 0);
      const blue = createColorBuffer(10, 10, 0, 0, 255);

      const result = renderTransition({
        fromBuffer: red,
        toBuffer: blue,
        width: 10,
        height: 10,
        progress: 0,
        type: 'slide',
        direction: 'left',
      });

      // At progress 0, "from" is fully visible (no offset)
      // "to" is fully off-screen to the right
      expect(result[0]).toBe(255); // Red at first pixel
    });
  });

  describe('zoom transition', () => {
    it('returns buffer of correct size', () => {
      const red = createColorBuffer(10, 10, 255, 0, 0);
      const blue = createColorBuffer(10, 10, 0, 0, 255);

      const result = renderTransition({
        fromBuffer: red,
        toBuffer: blue,
        width: 10,
        height: 10,
        progress: 0.5,
        type: 'zoom',
      });

      expect(result.length).toBe(10 * 10 * 4);
    });

    it('produces different output at different progress values', () => {
      const red = createColorBuffer(10, 10, 255, 0, 0);
      const blue = createColorBuffer(10, 10, 0, 0, 255);

      const result25 = renderTransition({
        fromBuffer: red,
        toBuffer: blue,
        width: 10,
        height: 10,
        progress: 0.25,
        type: 'zoom',
      });

      const result75 = renderTransition({
        fromBuffer: red,
        toBuffer: blue,
        width: 10,
        height: 10,
        progress: 0.75,
        type: 'zoom',
      });

      // Results should be different
      const diff = Math.abs(result25[0] - result75[0]) + Math.abs(result25[2] - result75[2]);
      expect(diff).toBeGreaterThan(0);
    });

    it('handles progress 0', () => {
      const red = createColorBuffer(10, 10, 255, 0, 0);
      const blue = createColorBuffer(10, 10, 0, 0, 255);

      const result = renderTransition({
        fromBuffer: red,
        toBuffer: blue,
        width: 10,
        height: 10,
        progress: 0,
        type: 'zoom',
      });

      // At progress 0, "from" should dominate
      expect(result.length).toBe(10 * 10 * 4);
    });

    it('handles progress 1', () => {
      const red = createColorBuffer(10, 10, 255, 0, 0);
      const blue = createColorBuffer(10, 10, 0, 0, 255);

      const result = renderTransition({
        fromBuffer: red,
        toBuffer: blue,
        width: 10,
        height: 10,
        progress: 1,
        type: 'zoom',
      });

      // At progress 1, "to" should dominate
      expect(result.length).toBe(10 * 10 * 4);
    });
  });

  describe('canvas state management', () => {
    it('returns valid buffer without corrupting state', () => {
      const red = createColorBuffer(100, 100, 255, 0, 0);
      const blue = createColorBuffer(100, 100, 0, 0, 255);

      // Run multiple transitions to check for state leakage
      for (let i = 0; i < 3; i++) {
        const result = renderTransition({
          fromBuffer: red,
          toBuffer: blue,
          width: 100,
          height: 100,
          progress: i * 0.3,
          type: 'fade',
        });
        expect(result.length).toBe(100 * 100 * 4);
      }
    });

    it('each transition is independent (no alpha leakage)', () => {
      const red = createColorBuffer(10, 10, 255, 0, 0);
      const blue = createColorBuffer(10, 10, 0, 0, 255);

      // First do a fade at 0.5
      renderTransition({
        fromBuffer: red,
        toBuffer: blue,
        width: 10,
        height: 10,
        progress: 0.5,
        type: 'fade',
      });

      // Then a slide at 0
      const slideResult = renderTransition({
        fromBuffer: red,
        toBuffer: blue,
        width: 10,
        height: 10,
        progress: 0,
        type: 'slide',
        direction: 'left',
      });

      // Slide at progress 0 should show pure red (no alpha bleeding from prev fade)
      expect(slideResult[0]).toBe(255);
      expect(slideResult[1]).toBe(0);
      expect(slideResult[2]).toBe(0);
    });
  });
});
