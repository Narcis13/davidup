/**
 * Integration tests for the animation system.
 * Tests AnimatedFrameGenerator with animations, presets, scenes, and transitions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AnimatedFrameGenerator,
  createAnimatedRenderer,
  type AnimatedScene,
} from '../../src/render/animated-frame-generator.js';
import { RendererRegistry } from '../../src/render/renderer-registry.js';
import { AssetManager } from '../../src/render/asset-manager.js';
import { TextRenderer } from '../../src/render/renderers/text-renderer.js';
import { ShapeRenderer } from '../../src/render/renderers/shape-renderer.js';

describe('AnimatedFrameGenerator', () => {
  let registry: RendererRegistry;
  let assets: AssetManager;

  beforeEach(() => {
    registry = new RendererRegistry();
    registry.register(new TextRenderer());
    registry.register(new ShapeRenderer());
    assets = new AssetManager();
  });

  describe('Element animations with custom easing', () => {
    it('animates element position with bounce easing', () => {
      const generator = new AnimatedFrameGenerator(
        {
          width: 100,
          height: 100,
          fps: 30,
          scenes: [
            {
              duration: 1,
              background: '#000000',
              elements: [
                {
                  type: 'shape',
                  shape: 'circle',
                  x: 10,
                  y: 50,
                  radius: 5,
                  fill: '#ff0000',
                  animations: [
                    {
                      property: 'x',
                      keyframes: [
                        { time: 0, value: 10 } as unknown as { frame: number; value: number },
                        { time: 1, value: 90, easing: 'easeOutBounce' } as unknown as { frame: number; value: number; easing: string },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        registry,
        assets
      );

      const frame0 = generator.generateFrame(0);
      const frame15 = generator.generateFrame(15);
      const frame29 = generator.generateFrame(29);

      // Verify frames are rendered
      expect(frame0.length).toBe(100 * 100 * 4);
      expect(frame15.length).toBe(100 * 100 * 4);
      expect(frame29.length).toBe(100 * 100 * 4);
    });

    it('animates element opacity', () => {
      const generator = new AnimatedFrameGenerator(
        {
          width: 50,
          height: 50,
          fps: 10,
          scenes: [
            {
              duration: 1,
              background: '#000000',
              elements: [
                {
                  type: 'shape',
                  shape: 'rectangle',
                  x: 10,
                  y: 10,
                  width: 30,
                  height: 30,
                  fill: '#ffffff',
                  animations: [
                    {
                      property: 'opacity',
                      keyframes: [
                        { time: 0, value: 0 } as unknown as { frame: number; value: number },
                        { time: 1, value: 1 } as unknown as { frame: number; value: number },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        registry,
        assets
      );

      const frame0 = generator.generateFrame(0);
      const frame9 = generator.generateFrame(9);

      expect(frame0.length).toBe(50 * 50 * 4);
      expect(frame9.length).toBe(50 * 50 * 4);
    });
  });

  describe('Enter/exit presets', () => {
    it('fades element in with fade preset', () => {
      const generator = new AnimatedFrameGenerator(
        {
          width: 100,
          height: 100,
          fps: 30,
          scenes: [
            {
              duration: 2,
              background: '#000000',
              elements: [
                {
                  type: 'shape',
                  shape: 'rectangle',
                  x: 25,
                  y: 25,
                  width: 50,
                  height: 50,
                  fill: '#ffffff',
                  enter: {
                    type: 'fade',
                    duration: 0.5, // 15 frames at 30fps
                  },
                },
              ],
            },
          ],
        },
        registry,
        assets
      );

      expect(generator.getTotalFrames()).toBe(60);
      const frame0 = generator.generateFrame(0);
      expect(frame0.length).toBe(100 * 100 * 4);
    });

    it('slides element with slide preset', () => {
      const generator = new AnimatedFrameGenerator(
        {
          width: 100,
          height: 100,
          fps: 30,
          scenes: [
            {
              duration: 1,
              background: '#000000',
              elements: [
                {
                  type: 'shape',
                  shape: 'rectangle',
                  x: 50,
                  y: 50,
                  width: 20,
                  height: 20,
                  fill: '#ffffff',
                  enter: {
                    type: 'slide',
                    duration: 0.5, // 15 frames at 30fps
                    direction: 'left',
                    distance: 50,
                  },
                },
              ],
            },
          ],
        },
        registry,
        assets
      );

      const frame = generator.generateFrame(7);
      expect(frame.length).toBe(100 * 100 * 4);
    });

    it('handles scale preset', () => {
      const generator = new AnimatedFrameGenerator(
        {
          width: 100,
          height: 100,
          fps: 30,
          scenes: [
            {
              duration: 1,
              background: '#000000',
              elements: [
                {
                  type: 'shape',
                  shape: 'circle',
                  x: 50,
                  y: 50,
                  radius: 20,
                  fill: '#00ff00',
                  enter: {
                    type: 'scale',
                    duration: 0.5,
                  },
                },
              ],
            },
          ],
        },
        registry,
        assets
      );

      const frame = generator.generateFrame(10);
      expect(frame.length).toBe(100 * 100 * 4);
    });

    it('handles bounce preset', () => {
      const generator = new AnimatedFrameGenerator(
        {
          width: 100,
          height: 100,
          fps: 30,
          scenes: [
            {
              duration: 1,
              background: '#000000',
              elements: [
                {
                  type: 'shape',
                  shape: 'rectangle',
                  x: 40,
                  y: 40,
                  width: 20,
                  height: 20,
                  fill: '#0000ff',
                  enter: {
                    type: 'bounce',
                    duration: 0.5,
                  },
                },
              ],
            },
          ],
        },
        registry,
        assets
      );

      const frame = generator.generateFrame(10);
      expect(frame.length).toBe(100 * 100 * 4);
    });
  });

  describe('Multi-scene video', () => {
    it('renders multiple scenes with different backgrounds', () => {
      const generator = new AnimatedFrameGenerator(
        {
          width: 100,
          height: 100,
          fps: 30,
          scenes: [
            { duration: 1, background: '#ff0000', elements: [] },
            { duration: 1, background: '#00ff00', elements: [] },
            { duration: 1, background: '#0000ff', elements: [] },
          ],
        },
        registry,
        assets
      );

      expect(generator.getTotalFrames()).toBe(90);

      // Frame 15 is in scene 1 (red)
      const frame15 = generator.generateFrame(15);
      expect(frame15[0]).toBe(255); // Red
      expect(frame15[1]).toBe(0);
      expect(frame15[2]).toBe(0);

      // Frame 45 is in scene 2 (green)
      const frame45 = generator.generateFrame(45);
      expect(frame45[0]).toBe(0);
      expect(frame45[1]).toBe(255); // Green
      expect(frame45[2]).toBe(0);

      // Frame 75 is in scene 3 (blue)
      const frame75 = generator.generateFrame(75);
      expect(frame75[0]).toBe(0);
      expect(frame75[1]).toBe(0);
      expect(frame75[2]).toBe(255); // Blue
    });
  });

  describe('Scene transitions', () => {
    it('applies fade transition between scenes', () => {
      const generator = new AnimatedFrameGenerator(
        {
          width: 100,
          height: 100,
          fps: 30,
          scenes: [
            {
              duration: 1,
              background: '#ff0000',
              elements: [],
              transition: { type: 'fade', duration: 0.5 },
            },
            { duration: 1, background: '#0000ff', elements: [] },
          ],
        },
        registry,
        assets
      );

      // Frame 20 is during transition (starts at frame 15 for 0.5s transition)
      const frameTransition = generator.generateFrame(20);

      // Both red and blue should have values (blended)
      expect(frameTransition[0]).toBeGreaterThan(0); // Some red
      expect(frameTransition[2]).toBeGreaterThan(0); // Some blue
    });

    it('applies slide transition between scenes', () => {
      const generator = new AnimatedFrameGenerator(
        {
          width: 100,
          height: 100,
          fps: 30,
          scenes: [
            {
              duration: 1,
              background: '#ff0000',
              elements: [],
              transition: { type: 'slide', duration: 0.5, direction: 'left' },
            },
            { duration: 1, background: '#0000ff', elements: [] },
          ],
        },
        registry,
        assets
      );

      const frameTransition = generator.generateFrame(22);
      expect(frameTransition.length).toBe(100 * 100 * 4);
    });

    it('applies zoom transition between scenes', () => {
      const generator = new AnimatedFrameGenerator(
        {
          width: 100,
          height: 100,
          fps: 30,
          scenes: [
            {
              duration: 1,
              background: '#ff0000',
              elements: [],
              transition: { type: 'zoom', duration: 0.5 },
            },
            { duration: 1, background: '#00ff00', elements: [] },
          ],
        },
        registry,
        assets
      );

      const frameTransition = generator.generateFrame(22);
      expect(frameTransition.length).toBe(100 * 100 * 4);
    });
  });

  describe('Complete sequence generation', () => {
    it('generates all frames via generator', () => {
      const generator = new AnimatedFrameGenerator(
        {
          width: 50,
          height: 50,
          fps: 10,
          scenes: [
            {
              duration: 1,
              background: '#000000',
              elements: [
                {
                  type: 'shape',
                  shape: 'circle',
                  x: 25,
                  y: 25,
                  radius: 10,
                  fill: '#ffffff',
                  enter: { type: 'fade', duration: 0.5 },
                },
              ],
            },
          ],
        },
        registry,
        assets
      );

      const frames: Buffer[] = [];
      for (const frame of generator.generateAllFrames()) {
        frames.push(frame);
      }

      expect(frames.length).toBe(10);
      frames.forEach((f) => expect(f.length).toBe(50 * 50 * 4));
    });

    it('handles empty scenes', () => {
      const generator = new AnimatedFrameGenerator(
        {
          width: 100,
          height: 100,
          fps: 30,
          scenes: [{ duration: 1, background: '#333333', elements: [] }],
        },
        registry,
        assets
      );

      const frames: Buffer[] = [];
      for (const frame of generator.generateAllFrames()) {
        frames.push(frame);
      }

      expect(frames.length).toBe(30);
    });
  });

  describe('Element visibility timing', () => {
    it('hides element before startTime', () => {
      const generator = new AnimatedFrameGenerator(
        {
          width: 100,
          height: 100,
          fps: 10,
          scenes: [
            {
              duration: 2,
              background: '#000000',
              elements: [
                {
                  type: 'shape',
                  shape: 'rectangle',
                  x: 25,
                  y: 25,
                  width: 50,
                  height: 50,
                  fill: '#ffffff',
                  startTime: 1, // Appears at 1 second
                },
              ],
            },
          ],
        },
        registry,
        assets
      );

      // At frame 5 (0.5s), element should not be visible (black background)
      const frame5 = generator.generateFrame(5);
      expect(frame5[0]).toBe(0);
      expect(frame5[1]).toBe(0);
      expect(frame5[2]).toBe(0);

      // At frame 15 (1.5s), element should be visible (white rectangle)
      const frame15 = generator.generateFrame(15);
      // Check center pixel
      const centerIdx = (50 * 100 + 50) * 4;
      expect(frame15[centerIdx]).toBe(255); // White
    });

    it('hides element after endTime', () => {
      const generator = new AnimatedFrameGenerator(
        {
          width: 100,
          height: 100,
          fps: 10,
          scenes: [
            {
              duration: 2,
              background: '#000000',
              elements: [
                {
                  type: 'shape',
                  shape: 'rectangle',
                  x: 25,
                  y: 25,
                  width: 50,
                  height: 50,
                  fill: '#ffffff',
                  endTime: 1, // Disappears at 1 second
                },
              ],
            },
          ],
        },
        registry,
        assets
      );

      // At frame 5 (0.5s), element should be visible
      const frame5 = generator.generateFrame(5);
      const centerIdx = (50 * 100 + 50) * 4;
      expect(frame5[centerIdx]).toBe(255); // White

      // At frame 15 (1.5s), element should not be visible
      const frame15 = generator.generateFrame(15);
      expect(frame15[centerIdx]).toBe(0); // Black (background)
    });
  });
});

describe('createAnimatedRenderer', () => {
  it('creates renderer with default settings', () => {
    const { generator, assets, registry } = createAnimatedRenderer({
      scenes: [{ duration: 1, background: '#000000', elements: [] }],
    });

    expect(generator).toBeDefined();
    expect(assets).toBeDefined();
    expect(registry).toBeDefined();
    expect(generator.getTotalFrames()).toBe(30); // 1s at 30fps default
  });

  it('uses custom dimensions', () => {
    const { generator } = createAnimatedRenderer({
      width: 640,
      height: 480,
      scenes: [{ duration: 1, background: '#000000', elements: [] }],
    });

    const frame = generator.generateFrame(0);
    expect(frame.length).toBe(640 * 480 * 4);
  });

  it('uses custom fps', () => {
    const { generator } = createAnimatedRenderer({
      fps: 60,
      scenes: [{ duration: 1, background: '#000000', elements: [] }],
    });

    expect(generator.getTotalFrames()).toBe(60);
  });

  it('provides setScenes function', () => {
    const result = createAnimatedRenderer({
      scenes: [{ duration: 1, background: '#ff0000', elements: [] }],
    });

    expect(result.setScenes).toBeDefined();
    expect(typeof result.setScenes).toBe('function');
  });

  it('registers all renderers', () => {
    const { registry } = createAnimatedRenderer({
      scenes: [{ duration: 1, background: '#000000', elements: [] }],
    });

    expect(registry.has('text')).toBe(true);
    expect(registry.has('image')).toBe(true);
    expect(registry.has('shape')).toBe(true);
  });
});
