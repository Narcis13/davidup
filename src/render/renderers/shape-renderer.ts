import type { SKRSContext2D, CanvasGradient } from '@napi-rs/canvas';
import type { ElementRenderer } from '../renderer-registry.js';
import type { AssetManager } from '../asset-manager.js';
import type { ShapeElement, GradientFill } from '../../types/index.js';

/**
 * Renders shape elements with solid colors, gradients, and strokes.
 *
 * Implements:
 * - RNDR-09: Shape elements (rectangle, circle, ellipse, line)
 * - RNDR-10: Fill color including linear/radial gradients
 * - RNDR-11: Stroke color and width
 */
export class ShapeRenderer implements ElementRenderer<ShapeElement> {
  readonly type = 'shape' as const;

  render(
    ctx: SKRSContext2D,
    element: ShapeElement,
    _assets: AssetManager
  ): void {
    const {
      shape,
      x,
      y,
      width = 0,
      height = 0,
      radius = 0,
      fill,
      stroke,
      borderRadius = 0,
    } = element;

    // Create the path
    ctx.beginPath();
    this.createPath(ctx, shape, x, y, width, height, radius, borderRadius);

    // Apply fill if specified (RNDR-10)
    if (fill) {
      ctx.fillStyle = this.resolveFill(ctx, fill, element);
      ctx.fill();
    }

    // Apply stroke if specified (RNDR-11)
    if (stroke) {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.stroke();
    }
  }

  /**
   * Create the path for the shape.
   */
  private createPath(
    ctx: SKRSContext2D,
    shape: 'rectangle' | 'circle' | 'ellipse' | 'line',
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    borderRadius: number
  ): void {
    switch (shape) {
      case 'rectangle':
        if (borderRadius > 0) {
          ctx.roundRect(x, y, width, height, borderRadius);
        } else {
          ctx.rect(x, y, width, height);
        }
        break;

      case 'circle':
        // x, y is the center point
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        break;

      case 'ellipse': {
        // x, y is top-left, calculate center
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const radiusX = width / 2;
        const radiusY = height / 2;
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
        break;
      }

      case 'line':
        // x, y is start point, width/height is offset to end
        ctx.moveTo(x, y);
        ctx.lineTo(x + width, y + height);
        break;
    }
  }

  /**
   * Resolve fill to a color string or gradient.
   */
  private resolveFill(
    ctx: SKRSContext2D,
    fill: string | GradientFill,
    element: ShapeElement
  ): string | CanvasGradient {
    if (typeof fill === 'string') {
      return fill;
    }

    // Gradient fill
    return this.createGradient(ctx, fill, element);
  }

  /**
   * Create a canvas gradient from the gradient definition.
   */
  private createGradient(
    ctx: SKRSContext2D,
    fill: GradientFill,
    element: ShapeElement
  ): CanvasGradient {
    const { type, angle = 0, stops } = fill;
    const { x, y, width = 100, height = 100, radius = 50, shape } = element;

    let gradient: CanvasGradient;

    if (type === 'linear') {
      gradient = this.createLinearGradient(ctx, x, y, width, height, angle);
    } else {
      gradient = this.createRadialGradient(ctx, x, y, width, height, radius, shape);
    }

    // Add color stops
    for (const stop of stops) {
      gradient.addColorStop(stop.offset, stop.color);
    }

    return gradient;
  }

  /**
   * Create a linear gradient with the specified angle.
   */
  private createLinearGradient(
    ctx: SKRSContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    angle: number
  ): CanvasGradient {
    // Convert angle to radians
    const radians = (angle * Math.PI) / 180;

    // Calculate gradient line based on angle and element bounds
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    // Length should span the diagonal to ensure full coverage
    const length = Math.sqrt(width * width + height * height) / 2;

    const x1 = centerX - Math.cos(radians) * length;
    const y1 = centerY - Math.sin(radians) * length;
    const x2 = centerX + Math.cos(radians) * length;
    const y2 = centerY + Math.sin(radians) * length;

    return ctx.createLinearGradient(x1, y1, x2, y2);
  }

  /**
   * Create a radial gradient centered on the shape.
   */
  private createRadialGradient(
    ctx: SKRSContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    shape: 'rectangle' | 'circle' | 'ellipse' | 'line'
  ): CanvasGradient {
    let centerX: number;
    let centerY: number;
    let outerRadius: number;

    if (shape === 'circle') {
      // For circles, x/y is the center
      centerX = x;
      centerY = y;
      outerRadius = radius;
    } else {
      // For other shapes, calculate center from bounds
      centerX = x + width / 2;
      centerY = y + height / 2;
      outerRadius = Math.max(width, height) / 2;
    }

    return ctx.createRadialGradient(
      centerX,
      centerY,
      0, // inner radius
      centerX,
      centerY,
      outerRadius
    );
  }
}
