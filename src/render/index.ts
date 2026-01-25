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

// Factory functions
export { createRenderer, type CreateRendererOptions, type RendererInstance } from './create-renderer.js';
export {
  AnimatedFrameGenerator,
  createAnimatedRenderer,
  type AnimatedElement,
  type AnimatedScene,
  type AnimatedFrameGeneratorConfig,
  type AnimationPresetConfig,
  type AnimationProps,
  type SceneTransition,
} from './animated-frame-generator.js';

// Element renderers
export { TextRenderer, ImageRenderer, ShapeRenderer } from './renderers/index.js';
