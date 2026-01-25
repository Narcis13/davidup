import type { CanvasRenderingContext2D } from '@napi-rs/canvas';

/**
 * Transform properties for positioning and styling elements.
 */
export interface TransformProps {
  x: number;
  y: number;
  rotation?: number;  // degrees
  scaleX?: number;
  scaleY?: number;
  opacity?: number;   // 0-1
}

/**
 * Apply transforms to the canvas context.
 * Should be called within a save/restore block.
 */
export function applyTransforms(
  ctx: CanvasRenderingContext2D,
  props: TransformProps
): void {
  const {
    x,
    y,
    rotation = 0,
    scaleX = 1,
    scaleY = 1,
    opacity = 1,
  } = props;

  // Translate to position
  ctx.translate(x, y);

  // Apply rotation (convert degrees to radians)
  if (rotation !== 0) {
    ctx.rotate((rotation * Math.PI) / 180);
  }

  // Apply scale
  if (scaleX !== 1 || scaleY !== 1) {
    ctx.scale(scaleX, scaleY);
  }

  // Apply opacity
  if (opacity !== 1) {
    ctx.globalAlpha = opacity;
  }
}
