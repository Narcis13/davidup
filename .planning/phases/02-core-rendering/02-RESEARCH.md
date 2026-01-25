# Phase 02: Core Rendering - Research

**Researched:** 2026-01-25
**Domain:** Canvas-based 2D rendering for video frame generation
**Confidence:** HIGH (verified against @napi-rs/canvas docs, Skia patterns, and competitor implementations)

## Executive Summary

Phase 02 implements the static frame rendering foundation: text elements with full styling, images with fit modes and clipping, and shapes with gradient fills. This is the heart of the rendering engine - every video frame will flow through these element renderers.

The recommended approach uses **@napi-rs/canvas** (a high-performance Skia binding) with a **registry pattern** for element renderers. Each element type (text, image, shape) gets its own renderer class that implements a common interface. The frame generator orchestrates rendering by querying which elements are visible at each frame and delegating to the appropriate renderer.

**Key architectural decisions for this phase:**
1. **Canvas reuse** - Create one canvas instance, reuse for all frames (critical for memory)
2. **Renderer registry** - Extensible pattern for adding new element types
3. **Asset preloading** - Load all images/fonts before render loop starts
4. **Synchronous buffer export** - Use `toBufferSync('raw')` to avoid memory leak in async methods

---

## Standard Stack

### Core Libraries

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @napi-rs/canvas | ^0.1.88 | 2D canvas rendering | 44% faster than skia-canvas, zero system deps, Skia-based |
| sharp | ^0.33 | Image preprocessing (optional) | If need resize/format conversion before canvas |

### Supporting Patterns

| Pattern | Purpose | When to Use |
|---------|---------|-------------|
| Registry pattern | Element renderer dispatch | All element types |
| Strategy pattern | Fit mode calculations | Image cover/contain/fill |
| Builder pattern | Complex text styling | Multi-property text elements |

### Already in Project (from Phase 01)

| Library | Purpose |
|---------|---------|
| zod | Schema validation (extend for elements) |
| typescript | Type safety |

---

## Architecture Patterns

### Pattern 1: Element Renderer Registry

**What:** Central registry that maps element types to their renderers
**When to use:** Always - enables extensibility and clean separation

```typescript
// src/render/renderer-registry.ts
import type { CanvasRenderingContext2D } from '@napi-rs/canvas';

interface ElementRenderer<T extends ElementType = ElementType> {
  readonly type: T;
  render(
    ctx: CanvasRenderingContext2D,
    element: Element & { type: T },
    assets: AssetManager
  ): void;
}

class RendererRegistry {
  private renderers = new Map<ElementType, ElementRenderer>();

  register<T extends ElementType>(renderer: ElementRenderer<T>): void {
    this.renderers.set(renderer.type, renderer);
  }

  render(
    ctx: CanvasRenderingContext2D,
    element: Element,
    assets: AssetManager
  ): void {
    const renderer = this.renderers.get(element.type);
    if (!renderer) {
      throw new Error(`No renderer for element type: ${element.type}`);
    }
    renderer.render(ctx, element, assets);
  }
}

// Usage
const registry = new RendererRegistry();
registry.register(new TextRenderer());
registry.register(new ImageRenderer());
registry.register(new ShapeRenderer());
```

### Pattern 2: Canvas Context State Management

**What:** Save/restore context state around each element render
**When to use:** Every element render - prevents style bleeding

```typescript
// CRITICAL: Always wrap element rendering in save/restore
function renderElement(
  ctx: CanvasRenderingContext2D,
  element: Element,
  assets: AssetManager
): void {
  ctx.save();
  try {
    // Apply transforms (position, rotation, scale, opacity)
    applyTransforms(ctx, element);

    // Render the element
    registry.render(ctx, element, assets);
  } finally {
    ctx.restore(); // ALWAYS restore, even on error
  }
}
```

### Pattern 3: Frame Generator with Canvas Reuse

**What:** Single canvas instance reused for all frames
**When to use:** Always - prevents memory leaks

```typescript
// src/render/frame-generator.ts
import { createCanvas, Canvas } from '@napi-rs/canvas';

class FrameGenerator {
  private canvas: Canvas;
  private ctx: CanvasRenderingContext2D;

  constructor(width: number, height: number) {
    // Create ONCE, reuse for all frames
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
  }

  generateFrame(elements: Element[], background: string): Buffer {
    // Clear canvas
    this.ctx.fillStyle = background;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Render elements in order (z-index)
    for (const element of elements) {
      renderElement(this.ctx, element, this.assets);
    }

    // IMPORTANT: Use sync method to avoid memory leak
    return this.canvas.toBufferSync('raw');
  }

  dispose(): void {
    // Explicit cleanup if needed
    this.canvas = null;
    this.ctx = null;
  }
}
```

### Pattern 4: Asset Preloading

**What:** Load all assets before render loop starts
**When to use:** Always - prevents I/O during frame generation

```typescript
// src/render/asset-manager.ts
import { loadImage, Image, GlobalFonts } from '@napi-rs/canvas';

class AssetManager {
  private images = new Map<string, Image>();
  private loadedFonts = new Set<string>();

  async preloadAll(spec: VideoSpec): Promise<void> {
    const imageUrls = this.extractImageUrls(spec);
    const fontFamilies = this.extractFontFamilies(spec);

    // Parallel load with timeout
    await Promise.all([
      ...imageUrls.map(url => this.loadImage(url)),
      ...fontFamilies.map(font => this.loadFont(font)),
    ]);
  }

  private async loadImage(url: string): Promise<void> {
    if (this.images.has(url)) return;

    const image = await loadImage(url);
    this.images.set(url, image);
  }

  private async loadFont(family: string): Promise<void> {
    if (this.loadedFonts.has(family) || GlobalFonts.has(family)) return;

    // Load from bundled fonts or Google Fonts
    const fontPath = `assets/fonts/${family}.ttf`;
    GlobalFonts.registerFromPath(fontPath, family);
    this.loadedFonts.add(family);
  }

  getImage(url: string): Image {
    const image = this.images.get(url);
    if (!image) throw new Error(`Image not preloaded: ${url}`);
    return image;
  }
}
```

---

## Element Renderer Implementations

### Text Renderer (RNDR-01 through RNDR-05)

**Requirements covered:**
- RNDR-01: Font family, size, weight, style, color, alignment
- RNDR-02: Text shadow and stroke/outline
- RNDR-03: Text background with padding and border radius
- RNDR-04: Max width for automatic wrapping
- RNDR-05: Word-by-word animation (schema support, animation in Phase 03)

```typescript
// src/render/renderers/text-renderer.ts
import type { CanvasRenderingContext2D } from '@napi-rs/canvas';

interface TextElement {
  type: 'text';
  text: string;
  x: number;
  y: number;
  // Styling (RNDR-01)
  fontFamily?: string;    // default: 'Inter'
  fontSize?: number;      // default: 32
  fontWeight?: number;    // 100-900, default: 400
  fontStyle?: 'normal' | 'italic'; // default: 'normal'
  color?: string;         // default: '#ffffff'
  textAlign?: 'left' | 'center' | 'right'; // default: 'left'
  lineHeight?: number;    // default: 1.2
  // Effects (RNDR-02)
  shadow?: {
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
  };
  stroke?: {
    color: string;
    width: number;
  };
  // Background (RNDR-03)
  backgroundColor?: string;
  padding?: number;
  borderRadius?: number;
  // Wrapping (RNDR-04)
  maxWidth?: number;
}

class TextRenderer implements ElementRenderer<'text'> {
  readonly type = 'text' as const;

  render(ctx: CanvasRenderingContext2D, element: TextElement): void {
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

    // Build font string
    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = 'top';

    // Calculate wrapped lines if maxWidth specified
    const lines = maxWidth
      ? this.wrapText(ctx, text, maxWidth)
      : [text];

    // Calculate total text bounds
    const textHeight = lines.length * fontSize * lineHeight;
    const textWidth = Math.max(...lines.map(line => ctx.measureText(line).width));

    // Draw background if specified (RNDR-03)
    if (backgroundColor) {
      this.drawBackground(ctx, x, y, textWidth, textHeight, {
        backgroundColor,
        padding,
        borderRadius,
        textAlign,
      });
    }

    // Apply shadow (RNDR-02)
    if (shadow) {
      ctx.shadowColor = shadow.color;
      ctx.shadowBlur = shadow.blur;
      ctx.shadowOffsetX = shadow.offsetX;
      ctx.shadowOffsetY = shadow.offsetY;
    }

    // Draw each line
    const startY = y + padding;
    const startX = this.getAlignedX(x, textWidth, textAlign, padding);

    for (let i = 0; i < lines.length; i++) {
      const lineY = startY + i * fontSize * lineHeight;

      // Draw stroke first (RNDR-02)
      if (stroke) {
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.strokeText(lines[i], startX, lineY);
      }

      // Draw fill
      ctx.fillStyle = color;
      ctx.fillText(lines[i], startX, lineY);
    }

    // Reset shadow
    if (shadow) {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  }

  private drawBackground(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    textWidth: number,
    textHeight: number,
    options: { backgroundColor: string; padding: number; borderRadius: number; textAlign: string }
  ): void {
    const { backgroundColor, padding, borderRadius, textAlign } = options;

    const bgWidth = textWidth + padding * 2;
    const bgHeight = textHeight + padding * 2;
    const bgX = this.getBackgroundX(x, bgWidth, textAlign);
    const bgY = y;

    ctx.fillStyle = backgroundColor;

    if (borderRadius > 0) {
      ctx.beginPath();
      ctx.roundRect(bgX, bgY, bgWidth, bgHeight, borderRadius);
      ctx.fill();
    } else {
      ctx.fillRect(bgX, bgY, bgWidth, bgHeight);
    }
  }

  private getAlignedX(x: number, textWidth: number, align: string, padding: number): number {
    switch (align) {
      case 'center': return x;
      case 'right': return x - padding;
      default: return x + padding;
    }
  }

  private getBackgroundX(x: number, bgWidth: number, align: string): number {
    switch (align) {
      case 'center': return x - bgWidth / 2;
      case 'right': return x - bgWidth;
      default: return x;
    }
  }
}
```

### Image Renderer (RNDR-06 through RNDR-08)

**Requirements covered:**
- RNDR-06: Image elements from URLs or uploaded assets
- RNDR-07: Fit mode (cover, contain, fill)
- RNDR-08: Border radius

```typescript
// src/render/renderers/image-renderer.ts
import type { CanvasRenderingContext2D, Image } from '@napi-rs/canvas';

interface ImageElement {
  type: 'image';
  src: string;           // URL or 'asset:{id}'
  x: number;
  y: number;
  width: number;
  height: number;
  fit?: 'cover' | 'contain' | 'fill'; // default: 'cover'
  borderRadius?: number;
}

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

class ImageRenderer implements ElementRenderer<'image'> {
  readonly type = 'image' as const;

  render(
    ctx: CanvasRenderingContext2D,
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

    const image = assets.getImage(src);
    const fitParams = this.calculateFit(image, width, height, fit);

    // Apply border radius clipping (RNDR-08)
    if (borderRadius > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, borderRadius);
      ctx.clip();
    }

    // Draw image with calculated fit
    ctx.drawImage(
      image,
      fitParams.sx, fitParams.sy, fitParams.sw, fitParams.sh,  // source
      x + fitParams.dx, y + fitParams.dy, fitParams.dw, fitParams.dh  // destination
    );

    if (borderRadius > 0) {
      ctx.restore();
    }
  }

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
          sx: 0, sy: 0, sw: image.width, sh: image.height,
          dx: 0, dy: 0, dw: targetWidth, dh: targetHeight,
        };

      case 'contain':
        // Fit within bounds, may have letterboxing
        if (imgAspect > targetAspect) {
          // Image is wider - fit to width
          const scaledHeight = targetWidth / imgAspect;
          const offsetY = (targetHeight - scaledHeight) / 2;
          return {
            sx: 0, sy: 0, sw: image.width, sh: image.height,
            dx: 0, dy: offsetY, dw: targetWidth, dh: scaledHeight,
          };
        } else {
          // Image is taller - fit to height
          const scaledWidth = targetHeight * imgAspect;
          const offsetX = (targetWidth - scaledWidth) / 2;
          return {
            sx: 0, sy: 0, sw: image.width, sh: image.height,
            dx: offsetX, dy: 0, dw: scaledWidth, dh: targetHeight,
          };
        }

      case 'cover':
      default:
        // Fill bounds, crop overflow (centered)
        if (imgAspect > targetAspect) {
          // Image is wider - crop sides
          const scaledWidth = image.height * targetAspect;
          const cropX = (image.width - scaledWidth) / 2;
          return {
            sx: cropX, sy: 0, sw: scaledWidth, sh: image.height,
            dx: 0, dy: 0, dw: targetWidth, dh: targetHeight,
          };
        } else {
          // Image is taller - crop top/bottom
          const scaledHeight = image.width / targetAspect;
          const cropY = (image.height - scaledHeight) / 2;
          return {
            sx: 0, sy: cropY, sw: image.width, sh: scaledHeight,
            dx: 0, dy: 0, dw: targetWidth, dh: targetHeight,
          };
        }
    }
  }
}
```

### Shape Renderer (RNDR-09 through RNDR-11)

**Requirements covered:**
- RNDR-09: Shape elements (rectangle, circle, ellipse, line)
- RNDR-10: Fill color including linear/radial gradients
- RNDR-11: Stroke color and width

```typescript
// src/render/renderers/shape-renderer.ts
import type { CanvasRenderingContext2D } from '@napi-rs/canvas';

type GradientStop = { offset: number; color: string };

interface GradientFill {
  type: 'linear' | 'radial';
  angle?: number;  // for linear, in degrees
  stops: GradientStop[];
}

type Fill = string | GradientFill;

interface ShapeElement {
  type: 'shape';
  shape: 'rectangle' | 'circle' | 'ellipse' | 'line';
  x: number;
  y: number;
  width?: number;   // for rectangle, ellipse, line endpoint
  height?: number;  // for rectangle, ellipse
  radius?: number;  // for circle
  fill?: Fill;
  stroke?: {
    color: string;
    width: number;
  };
  borderRadius?: number;  // for rectangle
}

class ShapeRenderer implements ElementRenderer<'shape'> {
  readonly type = 'shape' as const;

  render(ctx: CanvasRenderingContext2D, element: ShapeElement): void {
    const { shape, x, y, fill, stroke } = element;

    // Create the path
    ctx.beginPath();
    this.createPath(ctx, element);

    // Apply fill (RNDR-10)
    if (fill) {
      ctx.fillStyle = this.resolveFill(ctx, fill, element);
      ctx.fill();
    }

    // Apply stroke (RNDR-11)
    if (stroke) {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.stroke();
    }
  }

  private createPath(ctx: CanvasRenderingContext2D, element: ShapeElement): void {
    const { shape, x, y, width = 0, height = 0, radius = 0, borderRadius = 0 } = element;

    switch (shape) {
      case 'rectangle':
        if (borderRadius > 0) {
          ctx.roundRect(x, y, width, height, borderRadius);
        } else {
          ctx.rect(x, y, width, height);
        }
        break;

      case 'circle':
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        break;

      case 'ellipse':
        ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
        break;

      case 'line':
        ctx.moveTo(x, y);
        ctx.lineTo(x + width, y + height);
        break;
    }
  }

  private resolveFill(
    ctx: CanvasRenderingContext2D,
    fill: Fill,
    element: ShapeElement
  ): string | CanvasGradient {
    if (typeof fill === 'string') {
      return fill;
    }

    // Gradient fill
    const { type, angle = 0, stops } = fill;
    const { x, y, width = 100, height = 100, radius = 50 } = element;

    let gradient: CanvasGradient;

    if (type === 'linear') {
      // Calculate gradient line based on angle
      const radians = (angle * Math.PI) / 180;
      const length = Math.sqrt(width * width + height * height);
      const x1 = x + width / 2 - Math.cos(radians) * length / 2;
      const y1 = y + height / 2 - Math.sin(radians) * length / 2;
      const x2 = x + width / 2 + Math.cos(radians) * length / 2;
      const y2 = y + height / 2 + Math.sin(radians) * length / 2;

      gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    } else {
      // Radial gradient from center
      const centerX = x + (width || radius * 2) / 2;
      const centerY = y + (height || radius * 2) / 2;
      const r = radius || Math.max(width, height) / 2;

      gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, r);
    }

    for (const stop of stops) {
      gradient.addColorStop(stop.offset, stop.color);
    }

    return gradient;
  }
}
```

---

## Schema Extensions

Extend the VideoSpec schema from Phase 01 to include element definitions:

```typescript
// src/schemas/elements.ts
import { z } from 'zod';

// Color: hex string or gradient
const GradientStopSchema = z.object({
  offset: z.number().min(0).max(1),
  color: z.string(),
});

const GradientFillSchema = z.object({
  type: z.enum(['linear', 'radial']),
  angle: z.number().optional(),
  stops: z.array(GradientStopSchema).min(2),
});

const FillSchema = z.union([
  z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/),
  GradientFillSchema,
]);

// Shadow effect
const ShadowSchema = z.object({
  color: z.string(),
  blur: z.number().min(0),
  offsetX: z.number(),
  offsetY: z.number(),
});

// Stroke effect
const StrokeSchema = z.object({
  color: z.string(),
  width: z.number().min(0),
});

// Text element (RNDR-01 through RNDR-05)
export const TextElementSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  fontFamily: z.string().default('Inter'),
  fontSize: z.number().min(1).default(32),
  fontWeight: z.number().min(100).max(900).default(400),
  fontStyle: z.enum(['normal', 'italic']).default('normal'),
  color: z.string().default('#ffffff'),
  textAlign: z.enum(['left', 'center', 'right']).default('left'),
  lineHeight: z.number().min(0.5).max(3).default(1.2),
  shadow: ShadowSchema.optional(),
  stroke: StrokeSchema.optional(),
  backgroundColor: z.string().optional(),
  padding: z.number().min(0).default(0),
  borderRadius: z.number().min(0).default(0),
  maxWidth: z.number().min(1).optional(),
});

// Image element (RNDR-06 through RNDR-08)
export const ImageElementSchema = z.object({
  type: z.literal('image'),
  src: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().min(1),
  height: z.number().min(1),
  fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
  borderRadius: z.number().min(0).default(0),
});

// Shape element (RNDR-09 through RNDR-11)
export const ShapeElementSchema = z.object({
  type: z.literal('shape'),
  shape: z.enum(['rectangle', 'circle', 'ellipse', 'line']),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  radius: z.number().optional(),
  fill: FillSchema.optional(),
  stroke: StrokeSchema.optional(),
  borderRadius: z.number().min(0).default(0),
});

// Discriminated union for all elements
export const ElementSchema = z.discriminatedUnion('type', [
  TextElementSchema,
  ImageElementSchema,
  ShapeElementSchema,
]);

export type TextElement = z.infer<typeof TextElementSchema>;
export type ImageElement = z.infer<typeof ImageElementSchema>;
export type ShapeElement = z.infer<typeof ShapeElementSchema>;
export type Element = z.infer<typeof ElementSchema>;
```

---

## Common Pitfalls (Phase-Specific)

### Pitfall 1: Memory Leaks from Canvas Instance Creation

**What goes wrong:** Creating new canvas for each frame causes unbounded memory growth.
**Prevention:** Create canvas ONCE in FrameGenerator constructor, reuse for all frames.
**Verification:** Monitor `process.memoryUsage().external` - should stay stable.

### Pitfall 2: Async Buffer Export Memory Leak

**What goes wrong:** @napi-rs/canvas v1.0.1 has documented leak with async methods.
**Prevention:** Use `canvas.toBufferSync('raw')` instead of `canvas.toBuffer()`.
**Source:** GitHub Issue #145

### Pitfall 3: Font Not Found Fallback

**What goes wrong:** Font not registered, text renders in fallback font silently.
**Prevention:**
1. Preload and register all fonts before render
2. Use `GlobalFonts.has(family)` to verify
3. Bundle fallback fonts (Inter as default)

### Pitfall 4: Image Loading During Render Loop

**What goes wrong:** Loading images inside frame loop causes I/O wait, slow renders.
**Prevention:** Extract all image URLs from spec, preload ALL before first frame.

### Pitfall 5: Context State Bleeding

**What goes wrong:** Styles from one element affect subsequent elements.
**Prevention:** ALWAYS wrap element rendering in `ctx.save()` / `ctx.restore()`.

### Pitfall 6: Gradient Fill Calculation Errors

**What goes wrong:** Gradient appears wrong because coordinates are relative to canvas, not element.
**Prevention:** Calculate gradient start/end points relative to element bounds, not canvas origin.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Text wrapping | Character-by-character splitting | Word-based wrapping with `measureText()` |
| Font loading | Manual file I/O | `GlobalFonts.registerFromPath()` |
| Image fit calculations | Eyeballing ratios | Explicit cover/contain/fill formulas |
| Gradient creation | Manual color interpolation | Canvas `createLinearGradient()` / `createRadialGradient()` |
| Border radius clipping | Complex path math | Canvas `roundRect()` + `clip()` |

---

## File Structure

Recommended structure for Phase 02:

```
src/
├── render/
│   ├── index.ts                 # Re-exports
│   ├── frame-generator.ts       # Canvas management, frame loop
│   ├── renderer-registry.ts     # Element renderer dispatch
│   ├── asset-manager.ts         # Image/font preloading
│   ├── transforms.ts            # Position, rotation, scale, opacity
│   └── renderers/
│       ├── index.ts             # Re-exports
│       ├── text-renderer.ts     # RNDR-01 through RNDR-05
│       ├── image-renderer.ts    # RNDR-06 through RNDR-08
│       └── shape-renderer.ts    # RNDR-09 through RNDR-11
├── schemas/
│   ├── elements.ts              # Element Zod schemas (new)
│   ├── scene.ts                 # Scene schema (new)
│   ├── output.ts                # (existing from Phase 01)
│   └── video-spec.ts            # Extended with scenes/elements
└── types/
    └── index.ts                 # Extended with element types
```

---

## Testing Strategy

### Unit Tests (per renderer)

```typescript
// tests/render/text-renderer.test.ts
describe('TextRenderer', () => {
  it('renders text with default styling');
  it('applies font family, size, weight');
  it('applies text shadow');
  it('applies text stroke');
  it('renders background with padding');
  it('renders background with border radius');
  it('wraps text at maxWidth');
  it('handles multi-line text with lineHeight');
});

// tests/render/image-renderer.test.ts
describe('ImageRenderer', () => {
  it('renders image at position');
  it('applies cover fit mode (crops)');
  it('applies contain fit mode (letterbox)');
  it('applies fill fit mode (stretches)');
  it('clips with border radius');
});

// tests/render/shape-renderer.test.ts
describe('ShapeRenderer', () => {
  it('renders rectangle');
  it('renders rectangle with border radius');
  it('renders circle');
  it('renders ellipse');
  it('renders line');
  it('applies solid fill');
  it('applies linear gradient fill');
  it('applies radial gradient fill');
  it('applies stroke');
});
```

### Integration Tests

```typescript
// tests/render/frame-generator.test.ts
describe('FrameGenerator', () => {
  it('generates frame with multiple element types');
  it('applies z-order correctly');
  it('reuses canvas across frames (memory stability)');
});
```

### Visual Regression Tests

For rendering, pixel comparison is valuable:
1. Render test fixtures to PNG
2. Compare against golden images
3. Fail if pixel difference exceeds threshold

---

## Dependencies to Install

```bash
npm install @napi-rs/canvas@^0.1.88
```

No additional runtime dependencies needed. @napi-rs/canvas includes:
- Font loading (GlobalFonts)
- Image loading (loadImage)
- All canvas 2D context features

---

## Open Questions

### Q1: Word-by-word animation data structure

**Context:** RNDR-05 requires word-by-word animation for caption-style reveals.
**Question:** Should the schema include a `wordAnimation` config, or derive word timings in Phase 03?
**Recommendation:** Add `reveal: 'instant' | 'word-by-word'` to TextElement schema now. Phase 03 will implement the animation logic.

### Q2: Asset ID format

**Context:** Images can come from URLs or uploaded assets (`asset:{id}`).
**Question:** What's the format for asset IDs? UUID? Prefixed string?
**Recommendation:** Use `asset:{uuid}` format. AssetManager resolves to local path.

### Q3: Default font bundling

**Context:** Font rendering requires fonts to be registered.
**Question:** Which fonts to bundle by default?
**Recommendation:** Bundle Inter (all weights) as the default. It's open source and covers most use cases.

---

## Success Criteria Verification Plan

| Criterion | How to Verify |
|-----------|---------------|
| 1. Styled text (font, size, color, alignment, shadow, stroke, background) | Unit tests + visual test with all properties |
| 2. Images with fit modes and border radius | Unit tests for cover/contain/fill + visual test |
| 3. Shapes with gradient fills and strokes | Unit tests for each shape type + gradient combinations |
| 4. Wrapped text within max-width | Unit test wrapping algorithm + visual test |

---

## Sources

### Primary (HIGH confidence)
- [@napi-rs/canvas GitHub](https://github.com/Brooooooklyn/canvas) - API reference, examples
- [@napi-rs/canvas npm](https://www.npmjs.com/package/@napi-rs/canvas) - Installation, features
- [Canvas API MDN](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D) - Standard canvas methods

### Secondary (MEDIUM confidence)
- [skia-canvas Memory Leak Issue](https://github.com/samizdatco/skia-canvas/issues/145) - Memory management patterns
- PITFALLS.md from project research - Memory, FFmpeg, font pitfalls

### Project Context
- ARCHITECTURE.md - Overall system design
- FEATURES.md - Feature comparison with competitors
- PRD gamemotion-prd-v2.md - Full requirements specification

---

## Metadata

**Research confidence:** HIGH
**Research date:** 2026-01-25
**Valid until:** 2026-02-25

**Breakdown:**
- Element rendering patterns: HIGH - based on official @napi-rs/canvas docs
- Schema design: HIGH - follows established Zod patterns from Phase 01
- Memory management: HIGH - documented issues with known solutions
- Fit mode calculations: HIGH - standard algorithms
