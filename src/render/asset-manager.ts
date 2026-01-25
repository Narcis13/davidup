import { loadImage, GlobalFonts, type Image } from '@napi-rs/canvas';

/**
 * Manages preloading of images and fonts for rendering.
 * Assets must be preloaded before the render loop to avoid I/O during frame generation.
 */
export class AssetManager {
  private images = new Map<string, Image>();
  private loadedFonts = new Set<string>();

  /**
   * Preload an image from a URL or file path.
   * @param src - URL or file path to the image
   * @returns The loaded image
   */
  async loadImage(src: string): Promise<Image> {
    if (this.images.has(src)) {
      return this.images.get(src)!;
    }

    const image = await loadImage(src);
    this.images.set(src, image);
    return image;
  }

  /**
   * Get a previously loaded image.
   * @throws Error if the image was not preloaded.
   */
  getImage(src: string): Image {
    const image = this.images.get(src);
    if (!image) {
      throw new Error(`Image not preloaded: ${src}. Call loadImage() first.`);
    }
    return image;
  }

  /**
   * Check if an image is already loaded.
   */
  hasImage(src: string): boolean {
    return this.images.has(src);
  }

  /**
   * Register a font from a file path.
   * @param fontPath - Path to the font file (.ttf, .otf)
   * @param family - Font family name to register as
   * @returns true if font was registered, false if already registered
   */
  registerFont(fontPath: string, family: string): boolean {
    if (this.loadedFonts.has(family) || GlobalFonts.has(family)) {
      return false;
    }

    GlobalFonts.registerFromPath(fontPath, family);
    this.loadedFonts.add(family);
    return true;
  }

  /**
   * Check if a font family is available.
   */
  hasFont(family: string): boolean {
    return this.loadedFonts.has(family) || GlobalFonts.has(family);
  }

  /**
   * Get all loaded image sources.
   */
  getLoadedImages(): string[] {
    return Array.from(this.images.keys());
  }

  /**
   * Get all registered font families.
   */
  getLoadedFonts(): string[] {
    return Array.from(this.loadedFonts);
  }

  /**
   * Clear all cached images (fonts remain registered globally).
   */
  clearImages(): void {
    this.images.clear();
  }
}
