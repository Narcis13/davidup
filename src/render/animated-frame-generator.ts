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

  /**
   * Render a single scene frame (not in transition).
   */
  private renderSceneFrame(sceneInfo: SceneInfo): Buffer {
    const scene = sceneInfo.scene as unknown as AnimatedScene;
    const { localFrame } = sceneInfo;

    // Fill background
    this.ctx.fillStyle = scene.background ?? '#000000';
    this.ctx.fillRect(0, 0, this.config.width, this.config.height);

    // Render each element with animations applied
    for (const element of scene.elements) {
      const animatedElement = this.resolveAnimatedElement(
        element,
        localFrame,
        this.config.fps
      );
      if (animatedElement) {
        this.renderElement(animatedElement);
      }
    }

    return Buffer.from(this.canvas.data());
  }

  /**
   * Render a transition frame between two scenes.
   */
  private renderTransitionFrame(sceneInfo: SceneInfo): Buffer {
    const { transition } = sceneInfo;
    if (!transition) {
      return this.renderSceneFrame(sceneInfo);
    }

    // Render "from" scene (current scene without transition flag)
    const fromSceneInfo: SceneInfo = {
      ...sceneInfo,
      inTransition: false,
      transition: undefined,
    };
    const fromBuffer = this.renderSceneFrame(fromSceneInfo);

    // Render "to" scene (next scene at frame 0)
    const toSceneInfo: SceneInfo = {
      scene: transition.to,
      sceneIndex: sceneInfo.sceneIndex + 1,
      localFrame: 0,
      globalFrame: sceneInfo.globalFrame,
      inTransition: false,
    };
    const toBuffer = this.renderSceneFrame(toSceneInfo);

    // Composite using transition effect
    return renderTransition({
      fromBuffer,
      toBuffer,
      width: this.config.width,
      height: this.config.height,
      progress: transition.easedProgress,
      type: transition.type,
      direction: transition.direction,
    });
  }

  /**
   * Resolve an animated element's properties for a specific frame.
   * Returns null if the element is not visible at this frame.
   *
   * CRITICAL: Converts schema time (seconds) to frame numbers.
   */
  private resolveAnimatedElement(
    element: AnimatedElement,
    localFrame: number,
    fps: number
  ): BaseElement | null {
    const localTime = localFrame / fps;
    const startTime = element.startTime ?? 0;
    const endTime = element.endTime ?? Infinity;

    // Check visibility bounds
    if (localTime < startTime || localTime > endTime) {
      return null;
    }

    // Calculate element-local frame (time since element appeared)
    const elementLocalFrame = localFrame - Math.round(startTime * fps);

    // Collect all animations (converted to frame-based)
    const allAnimations = this.collectAnimations(element, fps);

    // Create a copy of the element to modify
    const resolved: Record<string, unknown> = { ...element };

    // Apply each animation
    for (const anim of allAnimations) {
      if (anim.keyframes.length > 0) {
        const value = getAnimatedValue(elementLocalFrame, anim.keyframes);
        // Apply constraints for certain properties
        if (anim.property === 'opacity') {
          resolved[anim.property] = Math.max(0, Math.min(1, value));
        } else if (anim.property === 'scaleX' || anim.property === 'scaleY') {
          resolved[anim.property] = Math.max(0, value);
        } else {
          resolved[anim.property] = value;
        }
      }
    }

    return resolved as unknown as BaseElement;
  }

  /**
   * Collect all animations for an element, including converted schema keyframes
   * and generated preset keyframes.
   *
   * CRITICAL: Schema keyframes use `time` (seconds), runtime uses `frame` numbers.
   * Convert time to frames using: frame = Math.round(time * fps)
   */
  private collectAnimations(
    element: AnimatedElement,
    fps: number
  ): PropertyAnimation[] {
    const animations: PropertyAnimation[] = [];

    // Convert time-based keyframes from schema to frame-based for runtime
    if (element.animations) {
      for (const anim of element.animations) {
        animations.push({
          property: anim.property,
          keyframes: anim.keyframes.map((kf) => ({
            // Schema may use `time` in seconds, convert to frame number
            frame:
              (kf as { time?: number }).time !== undefined
                ? Math.round((kf as { time?: number }).time! * fps)
                : kf.frame,
            value: kf.value,
            easing: kf.easing,
          })),
        });
      }
    }

    // Add enter preset animations (duration in seconds, convert to frames)
    if (element.enter) {
      const enterDurationFrames = Math.round(element.enter.duration * fps);
      const enterAnims = generateEnterKeyframes(
        {
          type: element.enter.type,
          duration: enterDurationFrames,
          direction: element.enter.direction,
          distance: element.enter.distance,
          easing: element.enter.easing,
        },
        0, // Start at frame 0 of element's local timeline
        (element.x as number) ?? 0,
        (element.y as number) ?? 0
      );
      animations.push(...enterAnims);
    }

    // Add exit preset animations
    if (element.exit && element.endTime !== undefined) {
      const exitDurationFrames = Math.round(element.exit.duration * fps);
      const startTime = element.startTime ?? 0;
      const visibleDurationFrames = Math.round((element.endTime - startTime) * fps);
      const exitStartFrame = visibleDurationFrames - exitDurationFrames;

      const exitAnims = generateExitKeyframes(
        {
          type: element.exit.type,
          duration: exitDurationFrames,
          direction: element.exit.direction,
          distance: element.exit.distance,
          easing: element.exit.easing,
        },
        exitStartFrame,
        (element.x as number) ?? 0,
        (element.y as number) ?? 0
      );
      animations.push(...exitAnims);
    }

    return animations;
  }

  /**
   * Render a single element with transforms applied.
   *
   * NOTE: Position (x, y) is NOT applied via transform - renderers handle their own positioning.
   * Transforms only apply rotation, scale, and opacity.
   *
   * For scale/rotation around element center: translate(-cx,-cy), transform, translate(cx,cy)
   * This ensures the element's position (cx, cy) maps to screen (cx, cy) regardless of scale.
   */
  private renderElement(element: BaseElement): void {
    this.ctx.save();
    try {
      const x = (element as { x?: number }).x ?? 0;
      const y = (element as { y?: number }).y ?? 0;
      const rotation = (element as { rotation?: number }).rotation ?? 0;
      const scaleX = (element as { scaleX?: number }).scaleX ?? 1;
      const scaleY = (element as { scaleY?: number }).scaleY ?? 1;
      const opacity = (element as { opacity?: number }).opacity ?? 1;

      // Apply opacity globally
      if (opacity !== 1) {
        this.ctx.globalAlpha = opacity;
      }

      // For rotation and scale, transform around the element's center position.
      // Canvas transforms compose in reverse order (last set = first applied).
      // To transform around (x, y): move to origin → scale/rotate → move back.
      // In canvas API order: translate(x,y), rotate, scale, translate(-x,-y)
      if (rotation !== 0 || scaleX !== 1 || scaleY !== 1) {
        // Step 4 (applied last): Move back to original position
        this.ctx.translate(x, y);
        // Step 3: Apply rotation around origin
        if (rotation !== 0) {
          this.ctx.rotate((rotation * Math.PI) / 180);
        }
        // Step 2: Apply scale around origin
        if (scaleX !== 1 || scaleY !== 1) {
          this.ctx.scale(scaleX, scaleY);
        }
        // Step 1 (applied first): Move element center to canvas origin
        this.ctx.translate(-x, -y);
      }

      // Delegate to the appropriate renderer (which handles its own x, y positioning)
      this.registry.render(this.ctx, element, this.assets);
    } finally {
      this.ctx.restore();
    }
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
