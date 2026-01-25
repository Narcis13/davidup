import type { CanvasRenderingContext2D } from '@napi-rs/canvas';
import type { ElementRenderer } from '../renderer-registry.js';
import type { AssetManager } from '../asset-manager.js';
import type { TextElement } from '../../types/index.js';

/**
 * Renders text elements with full styling support.
 *
 * Implements:
 * - RNDR-01: Font family, size, weight, style, color, alignment
 * - RNDR-02: Text shadow and stroke/outline effects
 * - RNDR-03: Text background with padding and border radius
 * - RNDR-04: Max width for automatic wrapping
 */
export class TextRenderer implements ElementRenderer<TextElement> {
  readonly type = 'text' as const;

  render(
    ctx: CanvasRenderingContext2D,
    element: TextElement,
    _assets: AssetManager
  ): void {
    const {
      text,
      x,
      y,
      fontFamily = 'Inter',
      fontSize = 32,
      fontWeight = 400,
      fontStyle = 'normal',
      color = '#ffffff',
      textAlign = 'left',
      lineHeight = 1.2,
      shadow,
      stroke,
      backgroundColor,
      padding = 0,
      borderRadius = 0,
      maxWidth,
    } = element;

    // Build font string: [style] [weight] [size] [family]
    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = 'top';

    // Split text into lines (handle explicit newlines and wrapping)
    const lines = this.getLines(ctx, text, maxWidth);

    // Calculate text bounds for background
    const lineHeightPx = fontSize * lineHeight;
    const textHeight = lines.length * lineHeightPx;
    const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));

    // Calculate positions based on alignment
    const { textStartX, bgX } = this.calculatePositions(
      x,
      textWidth,
      textAlign,
      padding
    );

    // Draw background if specified (RNDR-03)
    if (backgroundColor) {
      this.drawBackground(ctx, bgX, y, textWidth, textHeight, {
        backgroundColor,
        padding,
        borderRadius,
      });
    }

    // Apply shadow if specified (RNDR-02)
    if (shadow) {
      ctx.shadowColor = shadow.color;
      ctx.shadowBlur = shadow.blur;
      ctx.shadowOffsetX = shadow.offsetX;
      ctx.shadowOffsetY = shadow.offsetY;
    }

    // Draw each line
    const textStartY = y + padding;

    for (let i = 0; i < lines.length; i++) {
      const lineY = textStartY + i * lineHeightPx;
      const lineX = textStartX;

      // Draw stroke first if specified (RNDR-02) - stroke before fill creates outline effect
      if (stroke) {
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.strokeText(lines[i], lineX, lineY);
      }

      // Draw fill text
      ctx.fillStyle = color;
      ctx.fillText(lines[i], lineX, lineY);
    }

    // Reset shadow to prevent bleeding to next element
    if (shadow) {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  }

  /**
   * Split text into lines, handling explicit newlines and optional wrapping.
   */
  private getLines(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth?: number
  ): string[] {
    // First split by explicit newlines
    const paragraphs = text.split('\n');

    if (!maxWidth) {
      return paragraphs;
    }

    // Wrap each paragraph
    const allLines: string[] = [];
    for (const paragraph of paragraphs) {
      const wrappedLines = this.wrapText(ctx, paragraph, maxWidth);
      allLines.push(...wrappedLines);
    }

    return allLines;
  }

  /**
   * Wrap text at word boundaries to fit within maxWidth.
   */
  private wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
  ): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        // Current line is full, start new line
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    // Add remaining text
    if (currentLine) {
      lines.push(currentLine);
    }

    // Handle edge case: empty text after split
    if (lines.length === 0) {
      lines.push('');
    }

    return lines;
  }

  /**
   * Calculate X positions based on text alignment.
   */
  private calculatePositions(
    x: number,
    textWidth: number,
    align: string,
    padding: number
  ): { textStartX: number; bgX: number } {
    const bgWidth = textWidth + padding * 2;

    switch (align) {
      case 'center':
        return {
          textStartX: x,
          bgX: x - bgWidth / 2,
        };
      case 'right':
        return {
          textStartX: x,
          bgX: x - bgWidth,
        };
      default:
        // left alignment
        return {
          textStartX: x + padding,
          bgX: x,
        };
    }
  }

  /**
   * Draw text background with optional border radius.
   */
  private drawBackground(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    textWidth: number,
    textHeight: number,
    options: {
      backgroundColor: string;
      padding: number;
      borderRadius: number;
    }
  ): void {
    const { backgroundColor, padding, borderRadius } = options;

    const bgWidth = textWidth + padding * 2;
    const bgHeight = textHeight + padding * 2;

    ctx.fillStyle = backgroundColor;

    if (borderRadius > 0) {
      ctx.beginPath();
      ctx.roundRect(x, y, bgWidth, bgHeight, borderRadius);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, bgWidth, bgHeight);
    }
  }
}
