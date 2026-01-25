import { FrameGenerator, type FrameGeneratorConfig } from './frame-generator.js';
import { RendererRegistry } from './renderer-registry.js';
import { AssetManager } from './asset-manager.js';
import { TextRenderer, ImageRenderer, ShapeRenderer } from './renderers/index.js';

/**
 * Options for creating a renderer instance.
 */
export interface CreateRendererOptions {
  /** Canvas width in pixels (default: 1920) */
  width?: number;
  /** Canvas height in pixels (default: 1080) */
  height?: number;
}

/**
 * Result of createRenderer factory function.
 */
export interface RendererInstance {
  /** Frame generator for rendering elements to canvas */
  generator: FrameGenerator;
  /** Asset manager for preloading images and fonts */
  assets: AssetManager;
  /** Registry with all element renderers registered */
  registry: RendererRegistry;
}

/**
 * Factory function to create a fully configured renderer instance.
 *
 * Creates a RendererRegistry with all element renderers (text, image, shape)
 * registered, an AssetManager for asset preloading, and a FrameGenerator
 * configured with the specified dimensions.
 *
 * @example
 * ```typescript
 * const { generator, assets } = createRenderer({ width: 1920, height: 1080 });
 *
 * // Preload assets
 * await assets.loadImage('/path/to/image.png');
 *
 * // Generate frames
 * const frame = generator.generateFrame(elements, '#000000');
 * ```
 */
export function createRenderer(options: CreateRendererOptions = {}): RendererInstance {
  const { width = 1920, height = 1080 } = options;

  // Create registry with all renderers registered
  const registry = new RendererRegistry();
  registry.register(new TextRenderer());
  registry.register(new ImageRenderer());
  registry.register(new ShapeRenderer());

  // Create asset manager
  const assets = new AssetManager();

  // Create frame generator with config
  const config: FrameGeneratorConfig = { width, height };
  const generator = new FrameGenerator(config, registry, assets);

  return { generator, assets, registry };
}
