import type { CanvasRenderingContext2D } from '@napi-rs/canvas';
import type { AssetManager } from './asset-manager.js';

/**
 * Element types that can be rendered.
 * Extended as new element types are added.
 */
export type ElementType = 'text' | 'image' | 'shape';

/**
 * Base element structure shared by all elements.
 */
export interface BaseElement {
  type: ElementType;
  x: number;
  y: number;
}

/**
 * Interface for element renderers.
 * Each element type (text, image, shape) implements this interface.
 */
export interface ElementRenderer<T extends BaseElement = BaseElement> {
  readonly type: ElementType;
  render(
    ctx: CanvasRenderingContext2D,
    element: T,
    assets: AssetManager
  ): void;
}

/**
 * Registry for element renderers.
 * Maps element types to their renderer implementations.
 */
export class RendererRegistry {
  private renderers = new Map<ElementType, ElementRenderer>();

  /**
   * Register a renderer for an element type.
   */
  register<T extends BaseElement>(renderer: ElementRenderer<T>): void {
    this.renderers.set(renderer.type, renderer as ElementRenderer);
  }

  /**
   * Check if a renderer is registered for an element type.
   */
  has(type: ElementType): boolean {
    return this.renderers.has(type);
  }

  /**
   * Render an element using the appropriate renderer.
   * @throws Error if no renderer is registered for the element type.
   */
  render(
    ctx: CanvasRenderingContext2D,
    element: BaseElement,
    assets: AssetManager
  ): void {
    const renderer = this.renderers.get(element.type);
    if (!renderer) {
      throw new Error(`No renderer registered for element type: ${element.type}`);
    }
    renderer.render(ctx, element, assets);
  }

  /**
   * Get all registered element types.
   */
  getRegisteredTypes(): ElementType[] {
    return Array.from(this.renderers.keys());
  }
}
