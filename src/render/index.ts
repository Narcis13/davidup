// Core rendering infrastructure
export { FrameGenerator, type FrameGeneratorConfig } from './frame-generator.js';
export {
  RendererRegistry,
  type ElementRenderer,
  type ElementType,
  type BaseElement
} from './renderer-registry.js';
export { AssetManager } from './asset-manager.js';
export { applyTransforms, type TransformProps } from './transforms.js';

// Factory function
export { createRenderer, type CreateRendererOptions, type RendererInstance } from './create-renderer.js';

// Element renderers
export { TextRenderer, ImageRenderer, ShapeRenderer } from './renderers/index.js';
