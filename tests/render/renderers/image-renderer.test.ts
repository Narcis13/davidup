import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCanvas, type SKRSContext2D, type Image } from '@napi-rs/canvas';
import { ImageRenderer } from '../../../src/render/renderers/image-renderer.js';
import { AssetManager } from '../../../src/render/asset-manager.js';
import type { ImageElement } from '../../../src/types/index.js';

describe('ImageRenderer', () => {
  let renderer: ImageRenderer;
  let ctx: SKRSContext2D;
  let assets: AssetManager;
  let drawImageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    renderer = new ImageRenderer();
    const canvas = createCanvas(800, 600);
    ctx = canvas.getContext('2d');
    assets = new AssetManager();
    // Mock drawImage to prevent TypeError with mock images
    drawImageSpy = vi.spyOn(ctx, 'drawImage').mockImplementation(() => {});
  });

  // Helper to create minimal image element
  const createImageElement = (overrides: Partial<ImageElement> = {}): ImageElement => ({
    type: 'image',
    src: 'test.png',
    x: 0,
    y: 0,
    width: 200,
    height: 150,
    fit: 'cover',
    borderRadius: 0,
    ...overrides,
  });

  // Mock image with specific dimensions
  const createMockImage = (width: number, height: number): Image => ({
    width,
    height,
    naturalWidth: width,
    naturalHeight: height,
  } as Image);

  describe('type property', () => {
    it('should have type "image"', () => {
      expect(renderer.type).toBe('image');
    });
  });

  describe('basic rendering (RNDR-06)', () => {
    it('should get image from asset manager', () => {
      const mockImage = createMockImage(400, 300);
      vi.spyOn(assets, 'getImage').mockReturnValue(mockImage);
      const element = createImageElement();

      renderer.render(ctx, element, assets);

      expect(assets.getImage).toHaveBeenCalledWith('test.png');
    });

    it('should throw when image not preloaded', () => {
      const element = createImageElement({ src: 'missing.png' });

      expect(() => renderer.render(ctx, element, assets))
        .toThrow('Image not preloaded');
    });

    it('should call drawImage', () => {
      const mockImage = createMockImage(400, 300);
      vi.spyOn(assets, 'getImage').mockReturnValue(mockImage);
      const element = createImageElement();

      renderer.render(ctx, element, assets);

      expect(drawImageSpy).toHaveBeenCalled();
    });
  });

  describe('cover fit mode (RNDR-07)', () => {
    it('should crop wider image horizontally', () => {
      // Image is wider than target: 800x400 -> 200x200
      const mockImage = createMockImage(800, 400);
      vi.spyOn(assets, 'getImage').mockReturnValue(mockImage);

      const element = createImageElement({
        width: 200,
        height: 200,
        fit: 'cover',
      });

      renderer.render(ctx, element, assets);

      // Should use 9-argument drawImage (with source rect)
      expect(drawImageSpy).toHaveBeenCalled();
      const call = drawImageSpy.mock.calls[0];
      // Source width should be less than image width (cropped)
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = call;
      expect(sw).toBeLessThan(800); // Width is cropped
      expect(sh).toBe(400); // Full height used
      expect(dw).toBe(200); // Fills target width
      expect(dh).toBe(200); // Fills target height
    });

    it('should crop taller image vertically', () => {
      // Image is taller than target: 400x800 -> 200x200
      const mockImage = createMockImage(400, 800);
      vi.spyOn(assets, 'getImage').mockReturnValue(mockImage);

      const element = createImageElement({
        width: 200,
        height: 200,
        fit: 'cover',
      });

      renderer.render(ctx, element, assets);

      const call = drawImageSpy.mock.calls[0];
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = call;
      expect(sw).toBe(400); // Full width used
      expect(sh).toBeLessThan(800); // Height is cropped
    });

    it('should center the crop', () => {
      // Wide image: 1000x500 -> 200x200
      const mockImage = createMockImage(1000, 500);
      vi.spyOn(assets, 'getImage').mockReturnValue(mockImage);

      const element = createImageElement({
        width: 200,
        height: 200,
        fit: 'cover',
      });

      renderer.render(ctx, element, assets);

      const call = drawImageSpy.mock.calls[0];
      const [, sx, sy] = call;
      // Source x should be offset to center (crop from sides equally)
      expect(sx).toBeGreaterThan(0);
      expect(sy).toBe(0); // No vertical crop needed
    });
  });

  describe('contain fit mode (RNDR-07)', () => {
    it('should letterbox wider image', () => {
      // Wide image: 800x400 -> 200x200
      const mockImage = createMockImage(800, 400);
      vi.spyOn(assets, 'getImage').mockReturnValue(mockImage);

      const element = createImageElement({
        width: 200,
        height: 200,
        fit: 'contain',
      });

      renderer.render(ctx, element, assets);

      const call = drawImageSpy.mock.calls[0];
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = call;
      // Uses full source
      expect(sx).toBe(0);
      expect(sy).toBe(0);
      expect(sw).toBe(800);
      expect(sh).toBe(400);
      // Destination fits within target
      expect(dw).toBe(200); // Fits to width
      expect(dh).toBe(100); // Maintains aspect ratio
      expect(dy).toBe(50); // Centered vertically (letterbox)
    });

    it('should letterbox taller image', () => {
      // Tall image: 400x800 -> 200x200
      const mockImage = createMockImage(400, 800);
      vi.spyOn(assets, 'getImage').mockReturnValue(mockImage);

      const element = createImageElement({
        width: 200,
        height: 200,
        fit: 'contain',
      });

      renderer.render(ctx, element, assets);

      const call = drawImageSpy.mock.calls[0];
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = call;
      expect(dh).toBe(200); // Fits to height
      expect(dw).toBe(100); // Maintains aspect ratio
      expect(dx).toBe(50); // Centered horizontally (pillarbox)
    });
  });

  describe('fill fit mode (RNDR-07)', () => {
    it('should stretch to exact dimensions', () => {
      const mockImage = createMockImage(800, 400);
      vi.spyOn(assets, 'getImage').mockReturnValue(mockImage);

      const element = createImageElement({
        width: 200,
        height: 300,
        fit: 'fill',
      });

      renderer.render(ctx, element, assets);

      const call = drawImageSpy.mock.calls[0];
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = call;
      // Uses full source
      expect(sx).toBe(0);
      expect(sy).toBe(0);
      expect(sw).toBe(800);
      expect(sh).toBe(400);
      // Stretches to exact target
      expect(dx).toBe(0);
      expect(dy).toBe(0);
      expect(dw).toBe(200);
      expect(dh).toBe(300);
    });
  });

  describe('border radius (RNDR-08)', () => {
    it('should clip with border radius', () => {
      const mockImage = createMockImage(400, 300);
      vi.spyOn(assets, 'getImage').mockReturnValue(mockImage);
      const roundRectSpy = vi.spyOn(ctx, 'roundRect');
      const clipSpy = vi.spyOn(ctx, 'clip');

      const element = createImageElement({
        borderRadius: 20,
      });

      renderer.render(ctx, element, assets);

      expect(roundRectSpy).toHaveBeenCalled();
      expect(clipSpy).toHaveBeenCalled();
    });

    it('should not clip when borderRadius is 0', () => {
      const mockImage = createMockImage(400, 300);
      vi.spyOn(assets, 'getImage').mockReturnValue(mockImage);
      const clipSpy = vi.spyOn(ctx, 'clip');

      const element = createImageElement({
        borderRadius: 0,
      });

      renderer.render(ctx, element, assets);

      expect(clipSpy).not.toHaveBeenCalled();
    });

    it('should save and restore context for clipping', () => {
      const mockImage = createMockImage(400, 300);
      vi.spyOn(assets, 'getImage').mockReturnValue(mockImage);
      const saveSpy = vi.spyOn(ctx, 'save');
      const restoreSpy = vi.spyOn(ctx, 'restore');

      const element = createImageElement({
        borderRadius: 20,
      });

      renderer.render(ctx, element, assets);

      expect(saveSpy).toHaveBeenCalled();
      expect(restoreSpy).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle square image to square target', () => {
      const mockImage = createMockImage(500, 500);
      vi.spyOn(assets, 'getImage').mockReturnValue(mockImage);

      const element = createImageElement({
        width: 200,
        height: 200,
        fit: 'cover',
      });

      // Should not throw
      expect(() => renderer.render(ctx, element, assets)).not.toThrow();
    });

    it('should position image at element coordinates', () => {
      const mockImage = createMockImage(400, 300);
      vi.spyOn(assets, 'getImage').mockReturnValue(mockImage);

      const element = createImageElement({
        x: 50,
        y: 100,
        width: 200,
        height: 150,
        fit: 'fill',
      });

      renderer.render(ctx, element, assets);

      const call = drawImageSpy.mock.calls[0];
      const [, , , , , dx, dy] = call;
      expect(dx).toBe(50);
      expect(dy).toBe(100);
    });
  });
});
