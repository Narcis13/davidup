import { describe, it, expect, vi } from 'vitest';
import {
  createRenderer,
  FrameGenerator,
  RendererRegistry,
  AssetManager,
  TextRenderer,
  ImageRenderer,
  ShapeRenderer,
} from '../../src/render/index.js';
import type { TextElement, ImageElement, ShapeElement, Element } from '../../src/types/index.js';

describe('Integration: createRenderer factory', () => {
  it('should create renderer with default dimensions', () => {
    const { generator, assets, registry } = createRenderer();

    expect(generator).toBeInstanceOf(FrameGenerator);
    expect(assets).toBeInstanceOf(AssetManager);
    expect(registry).toBeInstanceOf(RendererRegistry);
    expect(generator.width).toBe(1920);
    expect(generator.height).toBe(1080);
  });

  it('should create renderer with custom dimensions', () => {
    const { generator } = createRenderer({ width: 1280, height: 720 });

    expect(generator.width).toBe(1280);
    expect(generator.height).toBe(720);
  });

  it('should register all element renderers', () => {
    const { registry } = createRenderer();

    expect(registry.has('text')).toBe(true);
    expect(registry.has('image')).toBe(true);
    expect(registry.has('shape')).toBe(true);
    expect(registry.getRegisteredTypes()).toEqual(['text', 'image', 'shape']);
  });

  it('should return same generator/assets/registry on each call', () => {
    // Each call creates new instances (not singleton)
    const first = createRenderer();
    const second = createRenderer();

    expect(first.generator).not.toBe(second.generator);
    expect(first.assets).not.toBe(second.assets);
    expect(first.registry).not.toBe(second.registry);
  });
});

describe('Integration: Multi-element rendering', () => {
  it('should render text elements', () => {
    const { generator } = createRenderer({ width: 200, height: 100 });

    const textElement: TextElement = {
      type: 'text',
      text: 'Hello',
      x: 10,
      y: 10,
      fontSize: 24,
      color: '#ffffff',
    };

    const frame = generator.generateFrame([textElement], '#000000');

    expect(frame).toBeInstanceOf(Buffer);
    expect(frame.length).toBe(200 * 100 * 4);
  });

  it('should render shape elements', () => {
    const { generator } = createRenderer({ width: 200, height: 100 });

    const shapeElement: ShapeElement = {
      type: 'shape',
      shape: 'rectangle',
      x: 10,
      y: 10,
      width: 50,
      height: 30,
      fill: '#ff0000',
    };

    const frame = generator.generateFrame([shapeElement], '#000000');

    expect(frame).toBeInstanceOf(Buffer);
    // Verify red pixels exist in the rendered area
    // Sample pixel at (20, 20) - should be red
    const pixelIndex = (20 * 200 + 20) * 4;
    expect(frame[pixelIndex]).toBe(255);     // R
    expect(frame[pixelIndex + 1]).toBe(0);   // G
    expect(frame[pixelIndex + 2]).toBe(0);   // B
    expect(frame[pixelIndex + 3]).toBe(255); // A
  });

  it('should render mixed element types in single frame', () => {
    const { generator } = createRenderer({ width: 300, height: 200 });

    const elements: Element[] = [
      {
        type: 'shape',
        shape: 'rectangle',
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        fill: '#0000ff',
      } as ShapeElement,
      {
        type: 'shape',
        shape: 'circle',
        x: 150,
        y: 100,
        radius: 50,
        fill: '#00ff00',
      } as ShapeElement,
      {
        type: 'text',
        text: 'Overlay',
        x: 100,
        y: 90,
        fontSize: 20,
        color: '#ffffff',
      } as TextElement,
    ];

    const frame = generator.generateFrame(elements, '#000000');

    expect(frame).toBeInstanceOf(Buffer);
    expect(frame.length).toBe(300 * 200 * 4);
  });

  it('should render multiple elements of same type', () => {
    const { generator } = createRenderer({ width: 300, height: 100 });

    const elements: ShapeElement[] = [
      {
        type: 'shape',
        shape: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fill: '#ff0000',
      },
      {
        type: 'shape',
        shape: 'rectangle',
        x: 100,
        y: 0,
        width: 100,
        height: 100,
        fill: '#00ff00',
      },
      {
        type: 'shape',
        shape: 'rectangle',
        x: 200,
        y: 0,
        width: 100,
        height: 100,
        fill: '#0000ff',
      },
    ];

    const frame = generator.generateFrame(elements, '#000000');

    // Verify three distinct colored regions
    // Red region at x=50
    const redIdx = (50 * 300 + 50) * 4;
    expect(frame[redIdx]).toBe(255);
    expect(frame[redIdx + 1]).toBe(0);
    expect(frame[redIdx + 2]).toBe(0);

    // Green region at x=150
    const greenIdx = (50 * 300 + 150) * 4;
    expect(frame[greenIdx]).toBe(0);
    expect(frame[greenIdx + 1]).toBeGreaterThan(250); // Allow slight variation
    expect(frame[greenIdx + 2]).toBe(0);

    // Blue region at x=250
    const blueIdx = (50 * 300 + 250) * 4;
    expect(frame[blueIdx]).toBe(0);
    expect(frame[blueIdx + 1]).toBe(0);
    expect(frame[blueIdx + 2]).toBe(255);
  });
});

describe('Integration: Z-order verification', () => {
  it('should render elements in array order (back to front)', () => {
    const { generator } = createRenderer({ width: 100, height: 100 });

    // Red rectangle at back, blue rectangle overlapping in front
    const elements: ShapeElement[] = [
      {
        type: 'shape',
        shape: 'rectangle',
        x: 0,
        y: 0,
        width: 80,
        height: 80,
        fill: '#ff0000',
      },
      {
        type: 'shape',
        shape: 'rectangle',
        x: 20,
        y: 20,
        width: 80,
        height: 80,
        fill: '#0000ff',
      },
    ];

    const frame = generator.generateFrame(elements, '#000000');

    // Point (10, 10) - only red rectangle covers this
    const redOnlyIdx = (10 * 100 + 10) * 4;
    expect(frame[redOnlyIdx]).toBe(255);     // R
    expect(frame[redOnlyIdx + 2]).toBe(0);   // B

    // Point (50, 50) - blue rectangle overlaps red, should be blue
    const overlapIdx = (50 * 100 + 50) * 4;
    expect(frame[overlapIdx]).toBe(0);       // R
    expect(frame[overlapIdx + 2]).toBe(255); // B

    // Point (90, 90) - only blue rectangle covers this
    const blueOnlyIdx = (90 * 100 + 90) * 4;
    expect(frame[blueOnlyIdx]).toBe(0);      // R
    expect(frame[blueOnlyIdx + 2]).toBe(255); // B
  });

  it('should respect render order for text over shapes', () => {
    const { generator, registry } = createRenderer({ width: 100, height: 100 });

    // Track render order
    const renderOrder: string[] = [];
    const originalTextRender = TextRenderer.prototype.render;
    const originalShapeRender = ShapeRenderer.prototype.render;

    // Spy on render methods to track order
    vi.spyOn(TextRenderer.prototype, 'render').mockImplementation(function(this: TextRenderer, ...args) {
      renderOrder.push('text');
      return originalTextRender.apply(this, args);
    });

    vi.spyOn(ShapeRenderer.prototype, 'render').mockImplementation(function(this: ShapeRenderer, ...args) {
      renderOrder.push('shape');
      return originalShapeRender.apply(this, args);
    });

    const elements: Element[] = [
      {
        type: 'shape',
        shape: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fill: '#333333',
      } as ShapeElement,
      {
        type: 'text',
        text: 'Front',
        x: 10,
        y: 40,
        fontSize: 20,
        color: '#ffffff',
      } as TextElement,
    ];

    generator.generateFrame(elements, '#000000');

    expect(renderOrder).toEqual(['shape', 'text']);

    // Restore
    vi.restoreAllMocks();
  });
});

describe('Integration: Frame generation', () => {
  it('should generate consistent frame size', () => {
    const { generator } = createRenderer({ width: 640, height: 480 });

    const frame1 = generator.generateFrame([], '#000000');
    const frame2 = generator.generateFrame([], '#ffffff');

    const expectedSize = 640 * 480 * 4;
    expect(frame1.length).toBe(expectedSize);
    expect(frame2.length).toBe(expectedSize);
  });

  it('should clear previous frame content', () => {
    const { generator } = createRenderer({ width: 100, height: 100 });

    // First frame: red shape
    generator.generateFrame([{
      type: 'shape',
      shape: 'rectangle',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fill: '#ff0000',
    } as ShapeElement], '#000000');

    // Second frame: no elements, black background
    const frame = generator.generateFrame([], '#000000');

    // Point (25, 25) should be black, not red from previous frame
    const idx = (25 * 100 + 25) * 4;
    expect(frame[idx]).toBe(0);     // R
    expect(frame[idx + 1]).toBe(0); // G
    expect(frame[idx + 2]).toBe(0); // B
  });

  it('should apply background color correctly', () => {
    const { generator } = createRenderer({ width: 100, height: 100 });

    const frame = generator.generateFrame([], '#ff8800');

    // Sample any pixel - should be orange
    const idx = 0;
    expect(frame[idx]).toBe(255);     // R
    expect(frame[idx + 1]).toBe(136); // G (0x88)
    expect(frame[idx + 2]).toBe(0);   // B
    expect(frame[idx + 3]).toBe(255); // A
  });

  it('should support named colors for background', () => {
    const { generator } = createRenderer({ width: 100, height: 100 });

    const frame = generator.generateFrame([], 'red');

    const idx = 0;
    expect(frame[idx]).toBe(255);     // R
    expect(frame[idx + 1]).toBe(0);   // G
    expect(frame[idx + 2]).toBe(0);   // B
  });
});

describe('Integration: Context isolation', () => {
  it('should isolate transform state between elements', () => {
    const { generator } = createRenderer({ width: 200, height: 200 });

    // First element applies rotation
    const elements: ShapeElement[] = [
      {
        type: 'shape',
        shape: 'rectangle',
        x: 10,
        y: 10,
        width: 80,
        height: 80,
        fill: '#ff0000',
        rotation: 45, // 45 degree rotation
      },
      {
        type: 'shape',
        shape: 'rectangle',
        x: 110,
        y: 10,
        width: 80,
        height: 80,
        fill: '#00ff00',
        // No rotation - should not be affected by first element's rotation
      },
    ];

    const frame = generator.generateFrame(elements, '#000000');

    // Second element at (150, 50) should be green (not rotated away)
    const idx = (50 * 200 + 150) * 4;
    expect(frame[idx]).toBe(0);       // R
    expect(frame[idx + 1]).toBeGreaterThan(250); // G
    expect(frame[idx + 2]).toBe(0);   // B
  });

  it('should isolate opacity between elements', () => {
    const { generator } = createRenderer({ width: 200, height: 100 });

    const elements: ShapeElement[] = [
      {
        type: 'shape',
        shape: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fill: '#ff0000',
        opacity: 0.5,
      },
      {
        type: 'shape',
        shape: 'rectangle',
        x: 100,
        y: 0,
        width: 100,
        height: 100,
        fill: '#00ff00',
        // Full opacity (default)
      },
    ];

    const frame = generator.generateFrame(elements, '#000000');

    // First element should be semi-transparent red over black = darker red
    const redIdx = (50 * 200 + 50) * 4;
    expect(frame[redIdx]).toBeLessThan(255);
    expect(frame[redIdx]).toBeGreaterThan(100);

    // Second element should be full green
    const greenIdx = (50 * 200 + 150) * 4;
    expect(frame[greenIdx + 1]).toBeGreaterThan(250);
  });

  it('should not leak shadow settings between elements', () => {
    const { generator } = createRenderer({ width: 300, height: 100 });

    const elements: Element[] = [
      {
        type: 'text',
        text: 'Shadow',
        x: 10,
        y: 40,
        fontSize: 24,
        color: '#ffffff',
        shadow: {
          color: '#000000',
          blur: 10,
          offsetX: 5,
          offsetY: 5,
        },
      } as TextElement,
      {
        type: 'shape',
        shape: 'rectangle',
        x: 150,
        y: 20,
        width: 100,
        height: 60,
        fill: '#00ff00',
        // No shadow - should not have shadow from text element
      } as ShapeElement,
    ];

    // This shouldn't throw and shadow shouldn't affect second element
    const frame = generator.generateFrame(elements, '#ffffff');

    expect(frame).toBeInstanceOf(Buffer);
  });
});

describe('Integration: Success Criteria Verification', () => {
  /**
   * SC1: Frame with text, image, shape renders without error
   * (Skipping image for this test as it requires preloaded asset)
   */
  it('SC1: should render frame with text and shape elements', () => {
    const { generator } = createRenderer({ width: 400, height: 300 });

    const elements: Element[] = [
      {
        type: 'shape',
        shape: 'rectangle',
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        fill: '#1a1a2e',
      } as ShapeElement,
      {
        type: 'shape',
        shape: 'circle',
        x: 200,
        y: 150,
        radius: 80,
        fill: {
          type: 'radial',
          stops: [
            { offset: 0, color: '#e94560' },
            { offset: 1, color: '#16213e' },
          ],
        },
      } as ShapeElement,
      {
        type: 'text',
        text: 'GameMotion',
        x: 200,
        y: 240,
        fontSize: 32,
        fontWeight: 700,
        color: '#ffffff',
        textAlign: 'center',
        shadow: {
          color: '#e94560',
          blur: 15,
          offsetX: 0,
          offsetY: 0,
        },
      } as TextElement,
    ];

    expect(() => {
      const frame = generator.generateFrame(elements, '#000000');
      expect(frame.length).toBe(400 * 300 * 4);
    }).not.toThrow();
  });

  /**
   * SC2: Z-order is respected (element 0 behind element N)
   */
  it('SC2: should respect z-order (first element is back, last is front)', () => {
    const { generator } = createRenderer({ width: 100, height: 100 });

    // Stack of overlapping squares
    const elements: ShapeElement[] = [
      { type: 'shape', shape: 'rectangle', x: 0, y: 0, width: 60, height: 60, fill: '#ff0000' },
      { type: 'shape', shape: 'rectangle', x: 20, y: 20, width: 60, height: 60, fill: '#00ff00' },
      { type: 'shape', shape: 'rectangle', x: 40, y: 40, width: 60, height: 60, fill: '#0000ff' },
    ];

    const frame = generator.generateFrame(elements, '#000000');

    // Center overlap at (50, 50) - should be blue (last element)
    const centerIdx = (50 * 100 + 50) * 4;
    expect(frame[centerIdx]).toBe(0);       // R
    expect(frame[centerIdx + 1]).toBe(0);   // G
    expect(frame[centerIdx + 2]).toBe(255); // B

    // Top-left at (10, 10) - only red
    const topLeftIdx = (10 * 100 + 10) * 4;
    expect(frame[topLeftIdx]).toBe(255);     // R
    expect(frame[topLeftIdx + 1]).toBe(0);   // G
    expect(frame[topLeftIdx + 2]).toBe(0);   // B

    // Bottom-right at (90, 90) - only blue
    const bottomRightIdx = (90 * 100 + 90) * 4;
    expect(frame[bottomRightIdx]).toBe(0);       // R
    expect(frame[bottomRightIdx + 1]).toBe(0);   // G
    expect(frame[bottomRightIdx + 2]).toBe(255); // B
  });

  /**
   * SC3: Context isolation prevents render state leakage
   */
  it('SC3: should prevent render state leakage between elements', () => {
    const { generator } = createRenderer({ width: 200, height: 100 });

    const elements: Element[] = [
      // First element with many style properties
      {
        type: 'text',
        text: 'Styled',
        x: 10,
        y: 20,
        fontSize: 20,
        color: '#ff0000',
        fontWeight: 700,
        fontStyle: 'italic',
        shadow: { color: '#000', blur: 5, offsetX: 2, offsetY: 2 },
        stroke: { color: '#ffffff', width: 2 },
      } as TextElement,
      // Second element - simple, should not inherit styles
      {
        type: 'shape',
        shape: 'rectangle',
        x: 120,
        y: 10,
        width: 60,
        height: 60,
        fill: '#00ff00',
      } as ShapeElement,
    ];

    const frame = generator.generateFrame(elements, '#333333');

    // Verify green rectangle rendered correctly
    const greenIdx = (40 * 200 + 150) * 4;
    expect(frame[greenIdx]).toBe(0);
    expect(frame[greenIdx + 1]).toBeGreaterThan(250);
    expect(frame[greenIdx + 2]).toBe(0);
  });

  /**
   * SC4: Factory provides ready-to-use renderer
   */
  it('SC4: factory should provide ready-to-use renderer', () => {
    const { generator, assets, registry } = createRenderer();

    // Registry has all renderers
    expect(registry.has('text')).toBe(true);
    expect(registry.has('image')).toBe(true);
    expect(registry.has('shape')).toBe(true);

    // Can generate frames immediately
    const frame = generator.generateFrame([
      { type: 'text', text: 'Ready', x: 100, y: 100 } as TextElement,
    ], '#000000');

    expect(frame).toBeInstanceOf(Buffer);

    // Assets manager is connected and ready
    expect(assets.getLoadedImages()).toEqual([]);
    expect(assets.getLoadedFonts()).toEqual([]);
  });
});

describe('Integration: Image element rendering', () => {
  it('should throw error for non-preloaded image', () => {
    const { generator } = createRenderer({ width: 100, height: 100 });

    const imageElement: ImageElement = {
      type: 'image',
      src: '/path/to/nonexistent.png',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    };

    expect(() => {
      generator.generateFrame([imageElement], '#000000');
    }).toThrow('Image not preloaded');
  });
});

describe('Integration: Edge cases', () => {
  it('should handle empty elements array', () => {
    const { generator } = createRenderer({ width: 100, height: 100 });

    const frame = generator.generateFrame([], '#ffffff');

    expect(frame.length).toBe(100 * 100 * 4);
    // All pixels should be white
    expect(frame[0]).toBe(255);
    expect(frame[1]).toBe(255);
    expect(frame[2]).toBe(255);
  });

  it('should handle many elements', () => {
    const { generator } = createRenderer({ width: 500, height: 500 });

    const elements: ShapeElement[] = [];
    for (let i = 0; i < 100; i++) {
      elements.push({
        type: 'shape',
        shape: 'circle',
        x: Math.random() * 500,
        y: Math.random() * 500,
        radius: 10 + Math.random() * 20,
        fill: `hsl(${i * 3.6}, 70%, 50%)`,
      });
    }

    expect(() => {
      const frame = generator.generateFrame(elements, '#000000');
      expect(frame.length).toBe(500 * 500 * 4);
    }).not.toThrow();
  });

  it('should handle elements with all optional properties', () => {
    const { generator } = createRenderer({ width: 200, height: 200 });

    const elements: Element[] = [
      {
        type: 'text',
        text: 'Full',
        x: 100,
        y: 50,
        fontFamily: 'serif',
        fontSize: 48,
        fontWeight: 700,
        fontStyle: 'italic',
        color: '#e94560',
        textAlign: 'center',
        lineHeight: 1.5,
        shadow: { color: '#000', blur: 10, offsetX: 3, offsetY: 3 },
        stroke: { color: '#fff', width: 2 },
        backgroundColor: '#16213e',
        padding: 15,
        borderRadius: 8,
        opacity: 0.9,
        rotation: 5,
        scaleX: 1.1,
        scaleY: 1.0,
      } as TextElement,
      {
        type: 'shape',
        shape: 'rectangle',
        x: 20,
        y: 120,
        width: 160,
        height: 60,
        fill: {
          type: 'linear',
          angle: 45,
          stops: [
            { offset: 0, color: '#e94560' },
            { offset: 0.5, color: '#0f3460' },
            { offset: 1, color: '#16213e' },
          ],
        },
        stroke: { color: '#ffffff', width: 2 },
        borderRadius: 10,
        opacity: 0.8,
      } as ShapeElement,
    ];

    expect(() => {
      const frame = generator.generateFrame(elements, '#1a1a2e');
      expect(frame.length).toBe(200 * 200 * 4);
    }).not.toThrow();
  });
});
