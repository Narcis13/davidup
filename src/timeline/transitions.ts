/**
 * Scene transition rendering functions.
 * Provides fade, slide, and zoom transition effects for compositing two scene frames.
 *
 * @module timeline/transitions
 */

import { createCanvas, ImageData, type SKRSContext2D } from '@napi-rs/canvas';

/**
 * Available transition types.
 */
export type TransitionType = 'fade' | 'slide' | 'zoom';

/**
 * Direction for slide transitions.
 */
export type TransitionDirection = 'left' | 'right' | 'up' | 'down';

/**
 * Options for rendering a transition frame.
 */
export interface TransitionRenderOptions {
  /** The outgoing scene's frame buffer (raw RGBA) */
  fromBuffer: Buffer;
  /** The incoming scene's frame buffer (raw RGBA) */
  toBuffer: Buffer;
  /** Frame width */
  width: number;
  /** Frame height */
  height: number;
  /** Transition progress 0-1 (should be eased before calling) */
  progress: number;
  /** Transition type */
  type: TransitionType;
  /** Direction for slide transition */
  direction?: TransitionDirection;
}

/**
 * Render a transition frame by compositing two scene frames.
 *
 * IMPORTANT: Caller is responsible for easing the progress value.
 * This function expects progress to already have easing applied.
 *
 * @param options - Transition render options
 * @returns Raw RGBA buffer of the composited frame
 */
export function renderTransition(options: TransitionRenderOptions): Buffer {
  const { fromBuffer, toBuffer, width, height, progress, type, direction = 'left' } = options;

  // Create temporary canvas for compositing
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Convert buffers to ImageData
  const fromData = new ImageData(
    new Uint8ClampedArray(fromBuffer),
    width,
    height
  );
  const toData = new ImageData(
    new Uint8ClampedArray(toBuffer),
    width,
    height
  );

  switch (type) {
    case 'fade':
      renderFadeTransition(ctx, fromData, toData, progress);
      break;
    case 'slide':
      renderSlideTransition(ctx, fromData, toData, width, height, progress, direction);
      break;
    case 'zoom':
      renderZoomTransition(ctx, fromData, toData, width, height, progress);
      break;
  }

  // Return raw RGBA buffer
  return Buffer.from(canvas.data());
}

/**
 * Fade transition: cross-dissolve between frames.
 * Since putImageData doesn't respect globalAlpha, we create temporary canvases
 * and use drawImage with alpha blending.
 */
function renderFadeTransition(
  ctx: SKRSContext2D,
  fromData: ImageData,
  toData: ImageData,
  progress: number
): void {
  const width = fromData.width;
  const height = fromData.height;

  // Create temp canvas for "from" frame
  const fromCanvas = createCanvas(width, height);
  const fromCtx = fromCanvas.getContext('2d');
  fromCtx.putImageData(fromData, 0, 0);

  // Create temp canvas for "to" frame
  const toCanvas = createCanvas(width, height);
  const toCtx = toCanvas.getContext('2d');
  toCtx.putImageData(toData, 0, 0);

  // Composite: draw "from" at (1 - progress) alpha, then "to" at progress alpha
  ctx.globalAlpha = 1 - progress;
  ctx.drawImage(fromCanvas, 0, 0);
  ctx.globalAlpha = progress;
  ctx.drawImage(toCanvas, 0, 0);
  ctx.globalAlpha = 1; // Reset to prevent state leakage
}

/**
 * Slide transition: slide frames in the specified direction.
 */
function renderSlideTransition(
  ctx: SKRSContext2D,
  fromData: ImageData,
  toData: ImageData,
  width: number,
  height: number,
  progress: number,
  direction: TransitionDirection
): void {
  // Create temp canvases
  const fromCanvas = createCanvas(width, height);
  const fromCtx = fromCanvas.getContext('2d');
  fromCtx.putImageData(fromData, 0, 0);

  const toCanvas = createCanvas(width, height);
  const toCtx = toCanvas.getContext('2d');
  toCtx.putImageData(toData, 0, 0);

  // Calculate positions based on direction
  let fromX = 0, fromY = 0, toX = 0, toY = 0;

  switch (direction) {
    case 'left':
      // "From" slides out to the left, "to" slides in from the right
      fromX = -width * progress;
      toX = width * (1 - progress);
      break;
    case 'right':
      // "From" slides out to the right, "to" slides in from the left
      fromX = width * progress;
      toX = -width * (1 - progress);
      break;
    case 'up':
      // "From" slides out upward, "to" slides in from below
      fromY = -height * progress;
      toY = height * (1 - progress);
      break;
    case 'down':
      // "From" slides out downward, "to" slides in from above
      fromY = height * progress;
      toY = -height * (1 - progress);
      break;
  }

  // Draw both frames at their calculated positions
  ctx.drawImage(fromCanvas, fromX, fromY);
  ctx.drawImage(toCanvas, toX, toY);
}

/**
 * Zoom transition: outgoing frame zooms out while incoming zooms in with fade.
 */
function renderZoomTransition(
  ctx: SKRSContext2D,
  fromData: ImageData,
  toData: ImageData,
  width: number,
  height: number,
  progress: number
): void {
  // Create temp canvases
  const fromCanvas = createCanvas(width, height);
  const fromCtx = fromCanvas.getContext('2d');
  fromCtx.putImageData(fromData, 0, 0);

  const toCanvas = createCanvas(width, height);
  const toCtx = toCanvas.getContext('2d');
  toCtx.putImageData(toData, 0, 0);

  // "From" frame zooms out (scale decreases) and fades out
  const fromScale = 1 - (progress * 0.3); // Scale from 1 to 0.7
  const fromAlpha = 1 - progress;
  const fromOffsetX = (width - width * fromScale) / 2;
  const fromOffsetY = (height - height * fromScale) / 2;

  // "To" frame zooms in (scale increases) and fades in
  const toScale = 0.7 + (progress * 0.3); // Scale from 0.7 to 1
  const toAlpha = progress;
  const toOffsetX = (width - width * toScale) / 2;
  const toOffsetY = (height - height * toScale) / 2;

  // Draw "to" first (behind)
  ctx.globalAlpha = toAlpha;
  ctx.drawImage(
    toCanvas,
    toOffsetX,
    toOffsetY,
    width * toScale,
    height * toScale
  );

  // Draw "from" on top
  ctx.globalAlpha = fromAlpha;
  ctx.drawImage(
    fromCanvas,
    fromOffsetX,
    fromOffsetY,
    width * fromScale,
    height * fromScale
  );

  ctx.globalAlpha = 1; // Reset to prevent state leakage
}
