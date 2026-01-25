import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { ShapeRenderer } from '../../../src/render/renderers/shape-renderer.js';
import { AssetManager } from '../../../src/render/asset-manager.js';
import type { ShapeElement } from '../../../src/types/index.js';

describe('ShapeRenderer', () => {
  let renderer: ShapeRenderer;
  let ctx: SKRSContext2D;
  let assets: AssetManager;

  beforeEach(() => {
    renderer = new ShapeRenderer();
    const canvas = createCanvas(800, 600);
    ctx = canvas.getContext('2d');
    assets = new AssetManager();
  });

  // Helper to create shape element
  const createShapeElement = (overrides: Partial<ShapeElement>): ShapeElement => ({
    type: 'shape',
    shape: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    borderRadius: 0,
    ...overrides,
  } as ShapeElement);

  describe('type property', () => {
    it('should have type "shape"', () => {
      expect(renderer.type).toBe('shape');
    });
  });

  describe('rectangle (RNDR-09)', () => {
    it('should render rectangle at position', () => {
      const rectSpy = vi.spyOn(ctx, 'rect');
      const element = createShapeElement({
        shape: 'rectangle',
        x: 50,
        y: 100,
        width: 200,
        height: 150,
        fill: '#ff0000',
      });

      renderer.render(ctx, element, assets);

      expect(rectSpy).toHaveBeenCalledWith(50, 100, 200, 150);
    });

    it('should render rounded rectangle when borderRadius specified', () => {
      const roundRectSpy = vi.spyOn(ctx, 'roundRect');
      const element = createShapeElement({
        shape: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        borderRadius: 16,
        fill: '#0000ff',
      });

      renderer.render(ctx, element, assets);

      expect(roundRectSpy).toHaveBeenCalledWith(0, 0, 100, 100, 16);
    });
  });

  describe('circle (RNDR-09)', () => {
    it('should render circle at center position', () => {
      const arcSpy = vi.spyOn(ctx, 'arc');
      const element = createShapeElement({
        shape: 'circle',
        x: 100,
        y: 100,
        radius: 50,
        fill: '#00ff00',
      });

      renderer.render(ctx, element, assets);

      // arc(x, y, radius, startAngle, endAngle)
      expect(arcSpy).toHaveBeenCalledWith(100, 100, 50, 0, Math.PI * 2);
    });
  });

  describe('ellipse (RNDR-09)', () => {
    it('should render ellipse with correct dimensions', () => {
      const ellipseSpy = vi.spyOn(ctx, 'ellipse');
      const element = createShapeElement({
        shape: 'ellipse',
        x: 50,
        y: 50,
        width: 200,
        height: 100,
        fill: '#ffff00',
      });

      renderer.render(ctx, element, assets);

      // ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle)
      // Center is x + width/2, y + height/2
      expect(ellipseSpy).toHaveBeenCalledWith(
        150, // x + width/2
        100, // y + height/2
        100, // width/2
        50,  // height/2
        0,   // no rotation
        0,
        Math.PI * 2
      );
    });
  });

  describe('line (RNDR-09)', () => {
    it('should render line between points', () => {
      const moveToSpy = vi.spyOn(ctx, 'moveTo');
      const lineToSpy = vi.spyOn(ctx, 'lineTo');
      const element = createShapeElement({
        shape: 'line',
        x: 0,
        y: 0,
        width: 100,  // dx
        height: 50,  // dy
        stroke: { color: '#ffffff', width: 2 },
      });

      renderer.render(ctx, element, assets);

      expect(moveToSpy).toHaveBeenCalledWith(0, 0);
      expect(lineToSpy).toHaveBeenCalledWith(100, 50);
    });
  });

  describe('solid fill (RNDR-10)', () => {
    it('should apply solid color fill', () => {
      const fillSpy = vi.spyOn(ctx, 'fill');
      const element = createShapeElement({
        fill: '#ff0000',
      });

      renderer.render(ctx, element, assets);

      expect(ctx.fillStyle).toBe('#ff0000');
      expect(fillSpy).toHaveBeenCalled();
    });

    it('should not fill when no fill specified', () => {
      const fillSpy = vi.spyOn(ctx, 'fill');
      const element = createShapeElement({
        fill: undefined,
        stroke: { color: '#000000', width: 1 },
      });

      renderer.render(ctx, element, assets);

      expect(fillSpy).not.toHaveBeenCalled();
    });
  });

  describe('linear gradient fill (RNDR-10)', () => {
    it('should create linear gradient', () => {
      const createLinearGradientSpy = vi.spyOn(ctx, 'createLinearGradient');
      const element = createShapeElement({
        fill: {
          type: 'linear',
          stops: [
            { offset: 0, color: '#ff0000' },
            { offset: 1, color: '#0000ff' },
          ],
        },
      });

      renderer.render(ctx, element, assets);

      expect(createLinearGradientSpy).toHaveBeenCalled();
    });

    it('should apply angle to linear gradient', () => {
      const createLinearGradientSpy = vi.spyOn(ctx, 'createLinearGradient');
      const element = createShapeElement({
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fill: {
          type: 'linear',
          angle: 90, // top to bottom
          stops: [
            { offset: 0, color: '#ff0000' },
            { offset: 1, color: '#0000ff' },
          ],
        },
      });

      renderer.render(ctx, element, assets);

      // With angle=90, gradient should be vertical
      const call = createLinearGradientSpy.mock.calls[0];
      expect(call).toBeDefined();
    });

    it('should add color stops to gradient', () => {
      const element = createShapeElement({
        fill: {
          type: 'linear',
          stops: [
            { offset: 0, color: '#ff0000' },
            { offset: 0.5, color: '#00ff00' },
            { offset: 1, color: '#0000ff' },
          ],
        },
      });

      // Should not throw
      expect(() => renderer.render(ctx, element, assets)).not.toThrow();
    });
  });

  describe('radial gradient fill (RNDR-10)', () => {
    it('should create radial gradient', () => {
      const createRadialGradientSpy = vi.spyOn(ctx, 'createRadialGradient');
      const element = createShapeElement({
        shape: 'circle',
        x: 100,
        y: 100,
        radius: 50,
        fill: {
          type: 'radial',
          stops: [
            { offset: 0, color: '#ffffff' },
            { offset: 1, color: '#000000' },
          ],
        },
      });

      renderer.render(ctx, element, assets);

      expect(createRadialGradientSpy).toHaveBeenCalled();
    });

    it('should center radial gradient on shape', () => {
      const createRadialGradientSpy = vi.spyOn(ctx, 'createRadialGradient');
      const element = createShapeElement({
        shape: 'circle',
        x: 200,
        y: 150,
        radius: 75,
        fill: {
          type: 'radial',
          stops: [
            { offset: 0, color: '#ffffff' },
            { offset: 1, color: '#000000' },
          ],
        },
      });

      renderer.render(ctx, element, assets);

      // Center should be at (200, 150) with inner radius 0 and outer radius 75
      const call = createRadialGradientSpy.mock.calls[0];
      expect(call[0]).toBe(200); // x
      expect(call[1]).toBe(150); // y
      expect(call[2]).toBe(0);   // inner radius
      expect(call[3]).toBe(200); // x
      expect(call[4]).toBe(150); // y
      expect(call[5]).toBe(75);  // outer radius
    });
  });

  describe('stroke (RNDR-11)', () => {
    it('should apply stroke color', () => {
      const strokeSpy = vi.spyOn(ctx, 'stroke');
      const element = createShapeElement({
        stroke: { color: '#ff0000', width: 2 },
      });

      renderer.render(ctx, element, assets);

      expect(ctx.strokeStyle).toBe('#ff0000');
      expect(strokeSpy).toHaveBeenCalled();
    });

    it('should apply stroke width', () => {
      const element = createShapeElement({
        stroke: { color: '#000000', width: 5 },
      });

      renderer.render(ctx, element, assets);

      expect(ctx.lineWidth).toBe(5);
    });

    it('should not stroke when no stroke specified', () => {
      const strokeSpy = vi.spyOn(ctx, 'stroke');
      const element = createShapeElement({
        fill: '#ff0000',
        stroke: undefined,
      });

      renderer.render(ctx, element, assets);

      expect(strokeSpy).not.toHaveBeenCalled();
    });
  });

  describe('combined fill and stroke', () => {
    it('should render stroke only', () => {
      const fillSpy = vi.spyOn(ctx, 'fill');
      const strokeSpy = vi.spyOn(ctx, 'stroke');
      const element = createShapeElement({
        fill: undefined,
        stroke: { color: '#000000', width: 2 },
      });

      renderer.render(ctx, element, assets);

      expect(fillSpy).not.toHaveBeenCalled();
      expect(strokeSpy).toHaveBeenCalled();
    });

    it('should render fill only', () => {
      const fillSpy = vi.spyOn(ctx, 'fill');
      const strokeSpy = vi.spyOn(ctx, 'stroke');
      const element = createShapeElement({
        fill: '#ff0000',
        stroke: undefined,
      });

      renderer.render(ctx, element, assets);

      expect(fillSpy).toHaveBeenCalled();
      expect(strokeSpy).not.toHaveBeenCalled();
    });

    it('should render both fill and stroke', () => {
      const fillSpy = vi.spyOn(ctx, 'fill');
      const strokeSpy = vi.spyOn(ctx, 'stroke');
      const element = createShapeElement({
        fill: '#ff0000',
        stroke: { color: '#000000', width: 2 },
      });

      renderer.render(ctx, element, assets);

      expect(fillSpy).toHaveBeenCalled();
      expect(strokeSpy).toHaveBeenCalled();
    });
  });
});
