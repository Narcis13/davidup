import type { SKRSContext2D, Image } from '@napi-rs/canvas';
import type { ElementRenderer } from '../renderer-registry.js';
import type { AssetManager } from '../asset-manager.js';
import type { ImageElement } from '../../types/index.js';

/**
 * Result of fit mode calculation.
 */
interface FitResult {
  sx: number;  // source x
  sy: number;  // source y
  sw: number;  // source width
  sh: number;  // source height
  dx: number;  // destination x
  dy: number;  // destination y
  dw: number;  // destination width
  dh: number;  // destination height
}

/**
 * Renders image elements with fit modes and border radius.
 *
 * Implements:
 * - RNDR-06: Image elements from URLs or uploaded assets
 * - RNDR-07: Fit mode (cover, contain, fill)
 * - RNDR-08: Border radius
 */
export class ImageRenderer implements ElementRenderer<ImageElement> {
  readonly type = 'image' as const;

  render(
    ctx: SKRSContext2D,
    element: ImageElement,
    assets: AssetManager
  ): void {
    const {
      src,
      x,
      y,
      width,
      height,
      fit = 'cover',
      borderRadius = 0,
    } = element;

    // Get preloaded image from asset manager
    const image = assets.getImage(src);

    // Calculate fit parameters
    const fitParams = this.calculateFit(image, width, height, fit);

    // Apply border radius clipping if specified (RNDR-08)
    if (borderRadius > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, borderRadius);
      ctx.clip();
    }

    // Draw the image
    ctx.drawImage(
      image,
      fitParams.sx,
      fitParams.sy,
      fitParams.sw,
      fitParams.sh,
      x + fitParams.dx,
      y + fitParams.dy,
      fitParams.dw,
      fitParams.dh
    );

    // Restore context if we clipped
    if (borderRadius > 0) {
      ctx.restore();
    }
  }

  /**
   * Calculate source and destination rectangles based on fit mode.
   */
  private calculateFit(
    image: Image,
    targetWidth: number,
    targetHeight: number,
    fit: 'cover' | 'contain' | 'fill'
  ): FitResult {
    const imgAspect = image.width / image.height;
    const targetAspect = targetWidth / targetHeight;

    switch (fit) {
      case 'fill':
        // Stretch to fill (may distort)
        return {
          sx: 0,
          sy: 0,
          sw: image.width,
          sh: image.height,
          dx: 0,
          dy: 0,
          dw: targetWidth,
          dh: targetHeight,
        };

      case 'contain':
        // Fit within bounds, may have letterboxing
        return this.calculateContain(image, targetWidth, targetHeight, imgAspect, targetAspect);

      case 'cover':
      default:
        // Fill bounds, crop overflow (centered)
        return this.calculateCover(image, targetWidth, targetHeight, imgAspect, targetAspect);
    }
  }

  /**
   * Calculate contain fit (fit within bounds with letterboxing).
   */
  private calculateContain(
    image: Image,
    targetWidth: number,
    targetHeight: number,
    imgAspect: number,
    targetAspect: number
  ): FitResult {
    if (imgAspect > targetAspect) {
      // Image is wider - fit to width, letterbox vertically
      const scaledHeight = targetWidth / imgAspect;
      const offsetY = (targetHeight - scaledHeight) / 2;
      return {
        sx: 0,
        sy: 0,
        sw: image.width,
        sh: image.height,
        dx: 0,
        dy: offsetY,
        dw: targetWidth,
        dh: scaledHeight,
      };
    } else {
      // Image is taller - fit to height, pillarbox horizontally
      const scaledWidth = targetHeight * imgAspect;
      const offsetX = (targetWidth - scaledWidth) / 2;
      return {
        sx: 0,
        sy: 0,
        sw: image.width,
        sh: image.height,
        dx: offsetX,
        dy: 0,
        dw: scaledWidth,
        dh: targetHeight,
      };
    }
  }

  /**
   * Calculate cover fit (fill bounds, crop overflow).
   */
  private calculateCover(
    image: Image,
    targetWidth: number,
    targetHeight: number,
    imgAspect: number,
    targetAspect: number
  ): FitResult {
    if (imgAspect > targetAspect) {
      // Image is wider than target - crop sides
      const scaledWidth = image.height * targetAspect;
      const cropX = (image.width - scaledWidth) / 2;
      return {
        sx: cropX,
        sy: 0,
        sw: scaledWidth,
        sh: image.height,
        dx: 0,
        dy: 0,
        dw: targetWidth,
        dh: targetHeight,
      };
    } else {
      // Image is taller than target - crop top/bottom
      const scaledHeight = image.width / targetAspect;
      const cropY = (image.height - scaledHeight) / 2;
      return {
        sx: 0,
        sy: cropY,
        sw: image.width,
        sh: scaledHeight,
        dx: 0,
        dy: 0,
        dw: targetWidth,
        dh: targetHeight,
      };
    }
  }
}
