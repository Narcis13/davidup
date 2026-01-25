import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCanvas, type CanvasRenderingContext2D } from '@napi-rs/canvas';
import { TextRenderer } from '../../../src/render/renderers/text-renderer.js';
import { AssetManager } from '../../../src/render/asset-manager.js';
import type { TextElement } from '../../../src/types/index.js';

describe('TextRenderer', () => {
  let renderer: TextRenderer;
  let ctx: CanvasRenderingContext2D;
  let assets: AssetManager;

  beforeEach(() => {
    renderer = new TextRenderer();
    const canvas = createCanvas(800, 600);
    ctx = canvas.getContext('2d');
    assets = new AssetManager();
  });

  // Helper to create minimal text element
  const createTextElement = (overrides: Partial<TextElement> = {}): TextElement => ({
    type: 'text',
    text: 'Test',
    x: 100,
    y: 100,
    fontFamily: 'Inter',
    fontSize: 32,
    fontWeight: 400,
    fontStyle: 'normal',
    color: '#ffffff',
    textAlign: 'left',
    lineHeight: 1.2,
    padding: 0,
    borderRadius: 0,
    ...overrides,
  });

  describe('type property', () => {
    it('should have type "text"', () => {
      expect(renderer.type).toBe('text');
    });
  });

  describe('basic rendering', () => {
    it('should render text at position', () => {
      const element = createTextElement({ text: 'Hello', x: 50, y: 75 });
      const fillTextSpy = vi.spyOn(ctx, 'fillText');

      renderer.render(ctx, element, assets);

      expect(fillTextSpy).toHaveBeenCalled();
      // Verify text content
      const call = fillTextSpy.mock.calls[0];
      expect(call[0]).toBe('Hello');
    });

    it('should set textBaseline to top', () => {
      const element = createTextElement();

      renderer.render(ctx, element, assets);

      expect(ctx.textBaseline).toBe('top');
    });
  });

  describe('font styling (RNDR-01)', () => {
    it('should apply font family', () => {
      const element = createTextElement({ fontFamily: 'Roboto' });

      renderer.render(ctx, element, assets);

      expect(ctx.font).toContain('Roboto');
    });

    it('should apply font size', () => {
      const element = createTextElement({ fontSize: 48 });

      renderer.render(ctx, element, assets);

      expect(ctx.font).toContain('48px');
    });

    it('should apply font weight', () => {
      const element = createTextElement({ fontWeight: 700 });

      renderer.render(ctx, element, assets);

      expect(ctx.font).toContain('700');
    });

    it('should apply font style italic', () => {
      const element = createTextElement({ fontStyle: 'italic' });

      renderer.render(ctx, element, assets);

      expect(ctx.font).toContain('italic');
    });

    it('should apply fill color', () => {
      const element = createTextElement({ color: '#ff0000' });

      renderer.render(ctx, element, assets);

      // fillStyle should be set before fillText
      expect(ctx.fillStyle).toBe('#ff0000');
    });

    it('should apply text alignment left', () => {
      const element = createTextElement({ textAlign: 'left' });

      renderer.render(ctx, element, assets);

      expect(ctx.textAlign).toBe('left');
    });

    it('should apply text alignment center', () => {
      const element = createTextElement({ textAlign: 'center' });

      renderer.render(ctx, element, assets);

      expect(ctx.textAlign).toBe('center');
    });

    it('should apply text alignment right', () => {
      const element = createTextElement({ textAlign: 'right' });

      renderer.render(ctx, element, assets);

      expect(ctx.textAlign).toBe('right');
    });

    it('should build correct font string', () => {
      const element = createTextElement({
        fontStyle: 'italic',
        fontWeight: 700,
        fontSize: 24,
        fontFamily: 'Arial',
      });

      renderer.render(ctx, element, assets);

      expect(ctx.font).toBe('italic 700 24px Arial');
    });
  });

  describe('shadow effect (RNDR-02)', () => {
    it('should apply shadow when specified', () => {
      const element = createTextElement({
        shadow: { color: '#000000', blur: 4, offsetX: 2, offsetY: 2 },
      });
      // Track shadow property changes
      const shadowColorSpy = vi.spyOn(ctx, 'shadowColor', 'set');
      const shadowBlurSpy = vi.spyOn(ctx, 'shadowBlur', 'set');
      const shadowOffsetXSpy = vi.spyOn(ctx, 'shadowOffsetX', 'set');
      const shadowOffsetYSpy = vi.spyOn(ctx, 'shadowOffsetY', 'set');

      renderer.render(ctx, element, assets);

      // Shadow should be applied before text (color is set)
      expect(shadowColorSpy).toHaveBeenCalledWith('#000000');
      expect(shadowBlurSpy).toHaveBeenCalledWith(4);
      expect(shadowOffsetXSpy).toHaveBeenCalledWith(2);
      expect(shadowOffsetYSpy).toHaveBeenCalledWith(2);
    });

    it('should not apply shadow when not specified', () => {
      const element = createTextElement({ shadow: undefined });
      const shadowColorSpy = vi.spyOn(ctx, 'shadowColor', 'set');

      renderer.render(ctx, element, assets);

      // Shadow should not be set to a non-transparent color
      const calls = shadowColorSpy.mock.calls;
      const nonTransparentCalls = calls.filter(
        (c) => c[0] !== 'transparent' && c[0] !== ''
      );
      expect(nonTransparentCalls.length).toBe(0);
    });

    it('should reset shadow after rendering to prevent bleeding', () => {
      const element = createTextElement({
        shadow: { color: '#000000', blur: 4, offsetX: 2, offsetY: 2 },
      });
      const shadowColorSpy = vi.spyOn(ctx, 'shadowColor', 'set');

      renderer.render(ctx, element, assets);

      // Last call should reset shadow to transparent
      const lastCall = shadowColorSpy.mock.calls[shadowColorSpy.mock.calls.length - 1];
      expect(lastCall[0]).toBe('transparent');
    });
  });

  describe('stroke effect (RNDR-02)', () => {
    it('should apply stroke when specified', () => {
      const element = createTextElement({
        stroke: { color: '#000000', width: 2 },
      });
      const strokeTextSpy = vi.spyOn(ctx, 'strokeText');

      renderer.render(ctx, element, assets);

      expect(strokeTextSpy).toHaveBeenCalled();
    });

    it('should set stroke color and width', () => {
      const element = createTextElement({
        stroke: { color: '#ff0000', width: 3 },
      });

      renderer.render(ctx, element, assets);

      expect(ctx.strokeStyle).toBe('#ff0000');
      expect(ctx.lineWidth).toBe(3);
    });

    it('should render stroke before fill (stroke appears as outline)', () => {
      const element = createTextElement({
        stroke: { color: '#000000', width: 2 },
      });
      const callOrder: string[] = [];
      vi.spyOn(ctx, 'strokeText').mockImplementation(() => callOrder.push('stroke'));
      vi.spyOn(ctx, 'fillText').mockImplementation(() => callOrder.push('fill'));

      renderer.render(ctx, element, assets);

      expect(callOrder).toEqual(['stroke', 'fill']);
    });

    it('should not stroke when not specified', () => {
      const element = createTextElement({ stroke: undefined });
      const strokeTextSpy = vi.spyOn(ctx, 'strokeText');

      renderer.render(ctx, element, assets);

      expect(strokeTextSpy).not.toHaveBeenCalled();
    });
  });

  describe('background (RNDR-03)', () => {
    it('should render background when specified', () => {
      const element = createTextElement({
        backgroundColor: '#000000',
      });
      const fillRectSpy = vi.spyOn(ctx, 'fillRect');

      renderer.render(ctx, element, assets);

      // fillRect called for background (before text)
      expect(fillRectSpy).toHaveBeenCalled();
    });

    it('should apply background padding', () => {
      const element = createTextElement({
        backgroundColor: '#000000',
        padding: 10,
      });
      const fillRectSpy = vi.spyOn(ctx, 'fillRect');

      renderer.render(ctx, element, assets);

      // Background should be rendered
      const call = fillRectSpy.mock.calls[0];
      expect(call).toBeDefined();
      // Width and height should be greater than 0 (including padding)
      expect(call[2]).toBeGreaterThan(0); // width
      expect(call[3]).toBeGreaterThan(0); // height
    });

    it('should render rounded background when borderRadius specified', () => {
      const element = createTextElement({
        backgroundColor: '#000000',
        borderRadius: 8,
      });
      const roundRectSpy = vi.spyOn(ctx, 'roundRect');

      renderer.render(ctx, element, assets);

      expect(roundRectSpy).toHaveBeenCalled();
    });

    it('should not render background when not specified', () => {
      const element = createTextElement({ backgroundColor: undefined });
      const fillRectSpy = vi.spyOn(ctx, 'fillRect');

      renderer.render(ctx, element, assets);

      // fillRect should not be called for background
      expect(fillRectSpy).not.toHaveBeenCalled();
    });

    it('should render background before text', () => {
      const element = createTextElement({
        backgroundColor: '#000000',
      });
      const callOrder: string[] = [];
      vi.spyOn(ctx, 'fillRect').mockImplementation(() => callOrder.push('fillRect'));
      vi.spyOn(ctx, 'fillText').mockImplementation(() => callOrder.push('fillText'));

      renderer.render(ctx, element, assets);

      expect(callOrder[0]).toBe('fillRect');
      expect(callOrder[callOrder.length - 1]).toBe('fillText');
    });
  });

  describe('text wrapping (RNDR-04)', () => {
    it('should wrap text when maxWidth specified', () => {
      const element = createTextElement({
        text: 'This is a long text that should wrap',
        maxWidth: 100,
      });
      const fillTextSpy = vi.spyOn(ctx, 'fillText');

      renderer.render(ctx, element, assets);

      // Should call fillText multiple times for wrapped lines
      expect(fillTextSpy.mock.calls.length).toBeGreaterThan(1);
    });

    it('should not wrap when maxWidth not specified', () => {
      const element = createTextElement({
        text: 'This is a long text that should not wrap',
        maxWidth: undefined,
      });
      const fillTextSpy = vi.spyOn(ctx, 'fillText');

      renderer.render(ctx, element, assets);

      // Should call fillText only once
      expect(fillTextSpy.mock.calls.length).toBe(1);
    });

    it('should wrap at word boundaries', () => {
      const element = createTextElement({
        text: 'Hello World Test',
        maxWidth: 80, // Narrow enough to force wrap
      });
      const fillTextSpy = vi.spyOn(ctx, 'fillText');

      renderer.render(ctx, element, assets);

      // Should have multiple lines
      expect(fillTextSpy.mock.calls.length).toBeGreaterThan(1);
      // Each call should contain text (no empty strings from bad word breaks)
      fillTextSpy.mock.calls.forEach((call) => {
        expect((call[0] as string).trim().length).toBeGreaterThan(0);
      });
    });

    it('should handle single word longer than maxWidth', () => {
      const element = createTextElement({
        text: 'Supercalifragilisticexpialidocious',
        maxWidth: 50, // Very narrow
      });

      // Should not throw
      expect(() => renderer.render(ctx, element, assets)).not.toThrow();
    });

    it('should position wrapped lines with lineHeight', () => {
      const element = createTextElement({
        text: 'Line one Line two Line three',
        maxWidth: 50, // Force wrap
        fontSize: 20,
        lineHeight: 1.5,
      });
      const fillTextSpy = vi.spyOn(ctx, 'fillText');

      renderer.render(ctx, element, assets);

      if (fillTextSpy.mock.calls.length >= 2) {
        const y1 = fillTextSpy.mock.calls[0][2] as number;
        const y2 = fillTextSpy.mock.calls[1][2] as number;
        // Second line should be fontSize * lineHeight below first
        expect(y2 - y1).toBeCloseTo(20 * 1.5, 0);
      }
    });
  });

  describe('multiline text', () => {
    it('should handle explicit newlines', () => {
      const element = createTextElement({
        text: 'Line 1\nLine 2',
      });
      const fillTextSpy = vi.spyOn(ctx, 'fillText');

      renderer.render(ctx, element, assets);

      // Should render two lines
      expect(fillTextSpy.mock.calls.length).toBe(2);
      expect(fillTextSpy.mock.calls[0][0]).toBe('Line 1');
      expect(fillTextSpy.mock.calls[1][0]).toBe('Line 2');
    });

    it('should handle multiple newlines', () => {
      const element = createTextElement({
        text: 'Line 1\nLine 2\nLine 3',
      });
      const fillTextSpy = vi.spyOn(ctx, 'fillText');

      renderer.render(ctx, element, assets);

      expect(fillTextSpy.mock.calls.length).toBe(3);
    });

    it('should position newline-separated lines with lineHeight', () => {
      const element = createTextElement({
        text: 'Line 1\nLine 2',
        fontSize: 24,
        lineHeight: 1.5,
      });
      const fillTextSpy = vi.spyOn(ctx, 'fillText');

      renderer.render(ctx, element, assets);

      if (fillTextSpy.mock.calls.length >= 2) {
        const y1 = fillTextSpy.mock.calls[0][2] as number;
        const y2 = fillTextSpy.mock.calls[1][2] as number;
        expect(y2 - y1).toBeCloseTo(24 * 1.5, 0);
      }
    });
  });

  describe('ElementRenderer interface', () => {
    it('should implement ElementRenderer interface with render method', () => {
      expect(typeof renderer.render).toBe('function');
      expect(renderer.type).toBe('text');
    });

    it('should accept AssetManager parameter', () => {
      const element = createTextElement();
      // Should not throw when called with assets
      expect(() => renderer.render(ctx, element, assets)).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle empty text gracefully', () => {
      // Note: Schema requires non-empty text, but renderer should still be safe
      const element = createTextElement({ text: ' ' }); // Space is allowed
      expect(() => renderer.render(ctx, element, assets)).not.toThrow();
    });

    it('should handle very large font sizes', () => {
      const element = createTextElement({ fontSize: 200 });
      expect(() => renderer.render(ctx, element, assets)).not.toThrow();
    });

    it('should handle negative coordinates', () => {
      const element = createTextElement({ x: -50, y: -50 });
      expect(() => renderer.render(ctx, element, assets)).not.toThrow();
    });

    it('should handle combined effects (shadow, stroke, background)', () => {
      const element = createTextElement({
        text: 'Complex',
        shadow: { color: '#000000', blur: 4, offsetX: 2, offsetY: 2 },
        stroke: { color: '#ffffff', width: 2 },
        backgroundColor: '#333333',
        padding: 12,
        borderRadius: 8,
      });
      expect(() => renderer.render(ctx, element, assets)).not.toThrow();
    });
  });
});
