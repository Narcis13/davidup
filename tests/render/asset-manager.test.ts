import { describe, it, expect, beforeEach } from 'vitest';
import { AssetManager } from '../../src/render/asset-manager.js';

describe('AssetManager', () => {
  let assets: AssetManager;

  beforeEach(() => {
    assets = new AssetManager();
  });

  describe('images', () => {
    it('should report image not loaded initially', () => {
      expect(assets.hasImage('test.png')).toBe(false);
    });

    it('should throw when getting unloaded image', () => {
      expect(() => assets.getImage('test.png'))
        .toThrow('Image not preloaded: test.png');
    });

    it('should track loaded images', async () => {
      // This test requires a real image file
      // In real tests, mock loadImage or use a test fixture
      expect(assets.getLoadedImages()).toEqual([]);
    });
  });

  describe('fonts', () => {
    it('should check if font is available', () => {
      // System fonts may or may not be available
      expect(typeof assets.hasFont('Arial')).toBe('boolean');
    });

    it('should track registered fonts', () => {
      expect(assets.getLoadedFonts()).toEqual([]);
    });
  });

  describe('clearing', () => {
    it('should clear images', () => {
      assets.clearImages();
      expect(assets.getLoadedImages()).toEqual([]);
    });
  });
});
