import { describe, it, expect } from 'vitest';
import {
  TextElementSchema,
  ImageElementSchema,
  ShapeElementSchema,
  ElementSchema,
  GradientFillSchema,
} from '../../src/schemas/elements.js';

describe('TextElementSchema', () => {
  it('validates minimal text element', () => {
    const result = TextElementSchema.safeParse({
      type: 'text',
      text: 'Hello',
      x: 100,
      y: 200,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fontFamily).toBe('Inter'); // default
      expect(result.data.fontSize).toBe(32); // default
      expect(result.data.color).toBe('#ffffff'); // default
    }
  });

  it('validates text with all styling options', () => {
    const result = TextElementSchema.safeParse({
      type: 'text',
      text: 'Styled',
      x: 0,
      y: 0,
      fontFamily: 'Roboto',
      fontSize: 48,
      fontWeight: 700,
      fontStyle: 'italic',
      color: '#ff0000',
      textAlign: 'center',
      lineHeight: 1.5,
      shadow: { color: '#000000', blur: 4, offsetX: 2, offsetY: 2 },
      stroke: { color: '#ffffff', width: 2 },
      backgroundColor: '#00ff00',
      padding: 10,
      borderRadius: 5,
      maxWidth: 400,
    });

    expect(result.success).toBe(true);
  });

  it('rejects empty text', () => {
    const result = TextElementSchema.safeParse({
      type: 'text',
      text: '',
      x: 0,
      y: 0,
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid font size', () => {
    const result = TextElementSchema.safeParse({
      type: 'text',
      text: 'Test',
      x: 0,
      y: 0,
      fontSize: 0,
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid font weight', () => {
    const result = TextElementSchema.safeParse({
      type: 'text',
      text: 'Test',
      x: 0,
      y: 0,
      fontWeight: 1000,
    });

    expect(result.success).toBe(false);
  });
});

describe('ImageElementSchema', () => {
  it('validates minimal image element', () => {
    const result = ImageElementSchema.safeParse({
      type: 'image',
      src: 'https://example.com/image.png',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fit).toBe('cover'); // default
      expect(result.data.borderRadius).toBe(0); // default
    }
  });

  it('validates image with all options', () => {
    const result = ImageElementSchema.safeParse({
      type: 'image',
      src: 'asset:12345',
      x: 50,
      y: 50,
      width: 200,
      height: 150,
      fit: 'contain',
      borderRadius: 10,
      opacity: 0.8,
    });

    expect(result.success).toBe(true);
  });

  it('rejects empty src', () => {
    const result = ImageElementSchema.safeParse({
      type: 'image',
      src: '',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid dimensions', () => {
    const result = ImageElementSchema.safeParse({
      type: 'image',
      src: 'test.png',
      x: 0,
      y: 0,
      width: 0,
      height: 100,
    });

    expect(result.success).toBe(false);
  });
});

describe('ShapeElementSchema', () => {
  it('validates rectangle', () => {
    const result = ShapeElementSchema.safeParse({
      type: 'shape',
      shape: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      fill: '#ff0000',
    });

    expect(result.success).toBe(true);
  });

  it('validates circle', () => {
    const result = ShapeElementSchema.safeParse({
      type: 'shape',
      shape: 'circle',
      x: 50,
      y: 50,
      radius: 25,
      fill: '#0000ff',
    });

    expect(result.success).toBe(true);
  });

  it('validates ellipse', () => {
    const result = ShapeElementSchema.safeParse({
      type: 'shape',
      shape: 'ellipse',
      x: 100,
      y: 100,
      width: 80,
      height: 40,
      fill: '#00ff00',
    });

    expect(result.success).toBe(true);
  });

  it('validates line', () => {
    const result = ShapeElementSchema.safeParse({
      type: 'shape',
      shape: 'line',
      x: 0,
      y: 0,
      width: 100, // dx
      height: 50, // dy
      stroke: { color: '#ffffff', width: 2 },
    });

    expect(result.success).toBe(true);
  });

  it('validates linear gradient fill', () => {
    const result = ShapeElementSchema.safeParse({
      type: 'shape',
      shape: 'rectangle',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      fill: {
        type: 'linear',
        angle: 45,
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it('validates radial gradient fill', () => {
    const result = ShapeElementSchema.safeParse({
      type: 'shape',
      shape: 'circle',
      x: 100,
      y: 100,
      radius: 50,
      fill: {
        type: 'radial',
        stops: [
          { offset: 0, color: '#ffffff' },
          { offset: 0.5, color: '#888888' },
          { offset: 1, color: '#000000' },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects circle without radius', () => {
    const result = ShapeElementSchema.safeParse({
      type: 'shape',
      shape: 'circle',
      x: 0,
      y: 0,
    });

    expect(result.success).toBe(false);
  });

  it('rejects rectangle without dimensions', () => {
    const result = ShapeElementSchema.safeParse({
      type: 'shape',
      shape: 'rectangle',
      x: 0,
      y: 0,
    });

    expect(result.success).toBe(false);
  });

  it('rejects gradient with less than 2 stops', () => {
    const result = GradientFillSchema.safeParse({
      type: 'linear',
      stops: [{ offset: 0, color: '#ff0000' }],
    });

    expect(result.success).toBe(false);
  });
});

describe('ElementSchema (discriminated union)', () => {
  it('correctly identifies text element', () => {
    const result = ElementSchema.safeParse({
      type: 'text',
      text: 'Hello',
      x: 0,
      y: 0,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('text');
    }
  });

  it('correctly identifies image element', () => {
    const result = ElementSchema.safeParse({
      type: 'image',
      src: 'test.png',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('image');
    }
  });

  it('correctly identifies shape element', () => {
    const result = ElementSchema.safeParse({
      type: 'shape',
      shape: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('shape');
    }
  });

  it('rejects unknown element type', () => {
    const result = ElementSchema.safeParse({
      type: 'unknown',
      x: 0,
      y: 0,
    });

    expect(result.success).toBe(false);
  });
});
