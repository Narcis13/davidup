/**
 * Animated frame generator for multi-scene videos with animations.
 * Integrates animation engine, presets, timeline, and transitions into
 * a complete animated video renderer.
 *
 * @module render/animated-frame-generator
 */

import type { Canvas, SKRSContext2D } from '@napi-rs/canvas';
import { createCanvas } from '@napi-rs/canvas';
import { RendererRegistry, type BaseElement } from './renderer-registry.js';
import { AssetManager } from './asset-manager.js';
import { applyTransforms } from './transforms.js';
import { Timeline, type SceneInfo, type SceneWithTransition, renderTransition } from '../timeline/index.js';
import {
  getAnimatedValue,
  generateEnterKeyframes,
  generateExitKeyframes,
  type PropertyAnimation,
  type EasingName,
} from '../animation/index.js';
import { TextRenderer } from './renderers/text-renderer.js';
import { ImageRenderer } from './renderers/image-renderer.js';
import { ShapeRenderer } from './renderers/shape-renderer.js';

/**
 * Animation preset configuration for enter/exit effects.
 */
export interface AnimationPresetConfig {
  type: 'fade' | 'slide' | 'scale' | 'bounce';
  /** Duration in seconds */
  duration: number;
  direction?: 'left' | 'right' | 'top' | 'bottom';
  distance?: number;
  easing?: EasingName;
}

/**
 * Animation properties that can be added to any element.
 */
export interface AnimationProps {
  /** Property animations (keyframe-based) */
  animations?: PropertyAnimation[];
  /** Enter animation preset */
  enter?: AnimationPresetConfig;
  /** Exit animation preset */
  exit?: AnimationPresetConfig;
  /** Start time in seconds from scene start (default: 0) */
  startTime?: number;
  /** End time in seconds from scene start (default: scene duration) */
  endTime?: number;
}

/**
 * AnimatedElement is a base element with optional animation properties.
 * Uses intersection type to combine element and animation props.
 */
export type AnimatedElement = BaseElement & AnimationProps & {
  [key: string]: unknown;
};

/**
 * Transition definition for scene transitions.
 */
export interface SceneTransition {
  type: 'fade' | 'slide' | 'zoom';
  duration?: number;
  direction?: 'left' | 'right' | 'up' | 'down';
  easing?: EasingName;
}

/**
 * AnimatedScene contains animated elements and optional transition.
 * Self-contained type for the animated frame generator.
 */
export interface AnimatedScene {
  /** Scene duration in seconds */
  duration: number;
  /** Background color */
  background?: string;
  /** Elements in this scene */
  elements: AnimatedElement[];
  /** Optional transition to next scene */
  transition?: SceneTransition;
}

/**
 * Configuration for the AnimatedFrameGenerator.
 */
export interface AnimatedFrameGeneratorConfig {
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Frames per second */
  fps: number;
  /** Scenes to render */
  scenes: AnimatedScene[];
}

/**
 * AnimatedFrameGenerator renders frames with animation support.
 * Supports keyframe animations, enter/exit presets, multi-scene timelines,
 * and scene transitions.
 */
export class AnimatedFrameGenerator {
  private readonly canvas: Canvas;
  private readonly ctx: SKRSContext2D;
  private readonly config: AnimatedFrameGeneratorConfig;
  private readonly registry: RendererRegistry;
  private readonly assets: AssetManager;
  private readonly timeline: Timeline;

  constructor(
    config: AnimatedFrameGeneratorConfig,
    registry: RendererRegistry,
    assets: AssetManager
  ) {
    this.config = config;
    this.registry = registry;
    this.assets = assets;
    this.canvas = createCanvas(config.width, config.height);
    this.ctx = this.canvas.getContext('2d');
    // Type assertion: AnimatedScene is compatible with SceneWithTransition
    // at runtime but has a looser element type for animation support
    this.timeline = new Timeline({
      scenes: config.scenes as unknown as SceneWithTransition[],
      fps: config.fps,
    });
  }

  /**
   * Get the total number of frames in the video.
   */
  getTotalFrames(): number {
    return this.timeline.getTotalFrames();
  }

  /**
   * Generate a single frame at the specified frame number.
   * @param frameNumber - The global frame number (0-indexed)
   * @returns Raw RGBA buffer of the rendered frame
   */
  generateFrame(frameNumber: number): Buffer {
    const sceneInfo = this.timeline.getSceneAtFrame(frameNumber);
    if (sceneInfo.inTransition && sceneInfo.transition) {
      return this.renderTransitionFrame(sceneInfo);
    }
    return this.renderSceneFrame(sceneInfo);
  }

  /**
   * Generate all frames as a generator.
   * Yields each frame buffer in sequence.
   */
  *generateAllFrames(): Generator<Buffer, void, unknown> {
    const totalFrames = this.getTotalFrames();
    for (let frame = 0; frame < totalFrames; frame++) {
      yield this.generateFrame(frame);
    }
  }

  // Private methods implemented in Task 2...
  private renderSceneFrame(_sceneInfo: SceneInfo): Buffer {
    // Implemented in Task 2
    throw new Error('Not implemented');
  }

  private renderTransitionFrame(_sceneInfo: SceneInfo): Buffer {
    // Implemented in Task 2
    throw new Error('Not implemented');
  }

  private resolveAnimatedElement(
    _element: AnimatedElement,
    _localFrame: number,
    _fps: number
  ): BaseElement | null {
    // Implemented in Task 2
    throw new Error('Not implemented');
  }

  private collectAnimations(
    _element: AnimatedElement,
    _fps: number
  ): PropertyAnimation[] {
    // Implemented in Task 2
    throw new Error('Not implemented');
  }

  private renderElement(_element: BaseElement): void {
    // Implemented in Task 2
    throw new Error('Not implemented');
  }
}

/**
 * Factory function to create a configured animated renderer.
 * Registers all built-in renderers (text, image, shape).
 *
 * @param config - Renderer configuration
 * @returns Object with generator, assets, registry, and setScenes function
 */
export function createAnimatedRenderer(
  config: Omit<AnimatedFrameGeneratorConfig, 'fps' | 'scenes'> & {
    fps?: number;
    scenes?: AnimatedScene[];
  }
): {
  generator: AnimatedFrameGenerator;
  assets: AssetManager;
  registry: RendererRegistry;
  setScenes: (scenes: AnimatedScene[], fps?: number) => void;
} {
  const { width = 1920, height = 1080, fps = 30, scenes = [] } = config;

  const registry = new RendererRegistry();
  const assets = new AssetManager();

  // Register all renderers using ESM imports (not require)
  registry.register(new TextRenderer());
  registry.register(new ImageRenderer());
  registry.register(new ShapeRenderer());

  let generator = new AnimatedFrameGenerator(
    { width, height, fps, scenes },
    registry,
    assets
  );

  return {
    generator,
    assets,
    registry,
    setScenes: (newScenes: AnimatedScene[], newFps?: number) => {
      generator = new AnimatedFrameGenerator(
        { width, height, fps: newFps ?? fps, scenes: newScenes },
        registry,
        assets
      );
    },
  };
}
