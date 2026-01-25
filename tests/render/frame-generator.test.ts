import { describe, it, expect, beforeEach } from 'vitest';
import { FrameGenerator } from '../../src/render/frame-generator.js';
import { RendererRegistry, type ElementRenderer } from '../../src/render/renderer-registry.js';
import { AssetManager } from '../../src/render/asset-manager.js';

describe('FrameGenerator', () => {
  let generator: FrameGenerator;
  let registry: RendererRegistry;
  let assets: AssetManager;

  beforeEach(() => {
    registry = new RendererRegistry();
    assets = new AssetManager();
    generator = new FrameGenerator(
      { width: 1920, height: 1080 },
      registry,
      assets
    );
  });

  it('should create canvas with correct dimensions', () => {
    expect(generator.width).toBe(1920);
    expect(generator.height).toBe(1080);
  });

  it('should reuse same canvas instance', () => {
    const canvas1 = generator.getCanvas();
    const canvas2 = generator.getCanvas();

    expect(canvas1).toBe(canvas2);
  });

  it('should generate frame buffer', () => {
    const buffer = generator.generateFrame([], '#000000');

    expect(buffer).toBeInstanceOf(Buffer);
    // Raw RGBA buffer size = width * height * 4 bytes
    expect(buffer.length).toBe(1920 * 1080 * 4);
  });

  it('should fill background color', () => {
    const buffer = generator.generateFrame([], '#ff0000');

    // First pixel should be red (RGBA: 255, 0, 0, 255)
    expect(buffer[0]).toBe(255); // R
    expect(buffer[1]).toBe(0);   // G
    expect(buffer[2]).toBe(0);   // B
    expect(buffer[3]).toBe(255); // A
  });

  it('should render elements through registry', () => {
    let renderCalled = false;
    const mockRenderer: ElementRenderer = {
      type: 'text',
      render: () => { renderCalled = true; },
    };
    registry.register(mockRenderer);

    generator.generateFrame([{ type: 'text', x: 100, y: 100 }], '#000000');

    expect(renderCalled).toBe(true);
  });

  it('should render elements in z-order', () => {
    const renderOrder: string[] = [];

    registry.register({
      type: 'text',
      render: () => { renderOrder.push('text'); },
    });
    registry.register({
      type: 'shape',
      render: () => { renderOrder.push('shape'); },
    });

    generator.generateFrame([
      { type: 'text', x: 0, y: 0 },
      { type: 'shape', x: 0, y: 0 },
      { type: 'text', x: 0, y: 0 },
    ], '#000000');

    expect(renderOrder).toEqual(['text', 'shape', 'text']);
  });

  it('should isolate transform state between elements', () => {
    // Track transform matrix state via getTransform()
    let firstTransform: DOMMatrix | undefined;
    let secondTransform: DOMMatrix | undefined;

    registry.register({
      type: 'text',
      render: (ctx) => {
        firstTransform = ctx.getTransform();
        // Apply a transform that should be isolated
        ctx.translate(100, 100);
        ctx.rotate(Math.PI / 4);
      },
    });
    registry.register({
      type: 'shape',
      render: (ctx) => {
        secondTransform = ctx.getTransform();
      },
    });

    generator.generateFrame([
      { type: 'text', x: 0, y: 0 },
      { type: 'shape', x: 0, y: 0 },
    ], '#000000');

    // Both should see identity transform (restored after each element)
    // First element sees identity (no prior transforms applied by FrameGenerator for x:0, y:0)
    expect(firstTransform?.a).toBeCloseTo(1);
    expect(firstTransform?.d).toBeCloseTo(1);
    expect(firstTransform?.e).toBeCloseTo(0);
    expect(firstTransform?.f).toBeCloseTo(0);

    // Second element should also see identity (transforms from first element restored)
    expect(secondTransform?.a).toBeCloseTo(1);
    expect(secondTransform?.d).toBeCloseTo(1);
    expect(secondTransform?.e).toBeCloseTo(0);
    expect(secondTransform?.f).toBeCloseTo(0);
  });
});
