import { createCanvas, type Canvas, type CanvasRenderingContext2D } from '@napi-rs/canvas';
import { RendererRegistry, type BaseElement } from './renderer-registry.js';
import { AssetManager } from './asset-manager.js';
import type { TransformProps } from './transforms.js';

/**
 * Configuration for the frame generator.
 */
export interface FrameGeneratorConfig {
  width: number;
  height: number;
}

/**
 * Generates video frames by rendering elements to a canvas.
 * CRITICAL: Reuses a single canvas instance to avoid memory leaks.
 */
export class FrameGenerator {
  private canvas: Canvas;
  private ctx: CanvasRenderingContext2D;
  private registry: RendererRegistry;
  private assets: AssetManager;

  constructor(
    config: FrameGeneratorConfig,
    registry: RendererRegistry,
    assets: AssetManager
  ) {
    // Create canvas ONCE - reuse for all frames
    this.canvas = createCanvas(config.width, config.height);
    this.ctx = this.canvas.getContext('2d');
    this.registry = registry;
    this.assets = assets;
  }

  /**
   * Get the canvas width.
   */
  get width(): number {
    return this.canvas.width;
  }

  /**
   * Get the canvas height.
   */
  get height(): number {
    return this.canvas.height;
  }

  /**
   * Generate a single frame by rendering all elements.
   * @param elements - Elements to render, in z-order (first = back, last = front)
   * @param background - Background color (CSS color string)
   * @returns Raw frame buffer (RGBA pixels)
   */
  generateFrame(elements: BaseElement[], background: string): Buffer {
    // Clear and fill background
    this.ctx.fillStyle = background;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Render elements in order (z-index)
    for (const element of elements) {
      this.renderElement(element);
    }

    // Use data() for raw RGBA pixel access - sync method avoids memory leak
    // Returns Uint8ClampedArray, convert to Buffer for consistency
    const rawData = this.canvas.data();
    return Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength);
  }

  /**
   * Render a single element with state isolation.
   */
  private renderElement(element: BaseElement): void {
    // Save context state before rendering
    this.ctx.save();
    try {
      // Apply element transforms if present
      const transformProps: TransformProps = {
        x: 0, // Position handled by renderer
        y: 0,
        rotation: (element as TransformProps).rotation,
        scaleX: (element as TransformProps).scaleX,
        scaleY: (element as TransformProps).scaleY,
        opacity: (element as TransformProps).opacity,
      };

      // Only apply rotation/scale/opacity transforms, not position
      if (transformProps.rotation || transformProps.scaleX !== undefined ||
          transformProps.scaleY !== undefined || transformProps.opacity !== undefined) {
        // For rotation/scale, translate to element center, apply, translate back
        // Position is handled by the element renderer
        const hasRotationOrScale = transformProps.rotation ||
          (transformProps.scaleX && transformProps.scaleX !== 1) ||
          (transformProps.scaleY && transformProps.scaleY !== 1);

        if (hasRotationOrScale) {
          // For now, apply at element position
          this.ctx.translate(element.x, element.y);
          if (transformProps.rotation) {
            this.ctx.rotate((transformProps.rotation * Math.PI) / 180);
          }
          if (transformProps.scaleX !== undefined || transformProps.scaleY !== undefined) {
            this.ctx.scale(transformProps.scaleX ?? 1, transformProps.scaleY ?? 1);
          }
          this.ctx.translate(-element.x, -element.y);
        }

        if (transformProps.opacity !== undefined && transformProps.opacity !== 1) {
          this.ctx.globalAlpha = transformProps.opacity;
        }
      }

      // Delegate to the appropriate renderer
      this.registry.render(this.ctx, element, this.assets);
    } finally {
      // ALWAYS restore context state, even if rendering fails
      this.ctx.restore();
    }
  }

  /**
   * Get direct access to the canvas context for testing.
   * Not intended for production use.
   */
  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /**
   * Get direct access to the canvas for testing.
   * Not intended for production use.
   */
  getCanvas(): Canvas {
    return this.canvas;
  }
}
