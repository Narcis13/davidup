# Phase 3: Animation & Timeline - Research

**Researched:** 2026-01-25
**Domain:** Frame-based animation system with keyframes, easing functions, and scene transitions
**Confidence:** HIGH (verified against established patterns, Remotion, D3-ease, and Robert Penner's equations)

## Summary

Phase 3 transforms static frame rendering from Phase 2 into an animated video system. The core challenge is interpolating element properties across frames using keyframes and easing functions, while also managing scene transitions. Unlike browser-based animation (CSS/requestAnimationFrame), this is frame-by-frame rendering where each frame is computed independently based on the current time.

The recommended approach uses a **Timeline** abstraction that manages scenes and their durations, an **AnimationEngine** that computes interpolated property values for any given frame, and **Easing functions** based on Robert Penner's equations. Animation presets (fade, slide, scale, bounce) are syntactic sugar over keyframe animations with preset values.

**Key architectural decisions for this phase:**
1. **Frame-driven computation** - All animations are pure functions of frame number, not time-based events
2. **Keyframe interpolation** - Linear interpolation between keyframes, modified by easing functions
3. **Hand-rolled easing functions** - Implement 12 easing functions based on Penner's equations (no external dependency)
4. **Animation presets as keyframe factories** - Presets generate standard keyframe configurations
5. **Scene-level transitions** - Transitions are two-scene compositions rendered to a single output frame

**Primary recommendation:** Build a pure functional animation engine where `getAnimatedValue(frame, keyframes, easing)` returns the interpolated value. Presets and transitions are composed from this primitive.

---

## Standard Stack

### Core (Hand-Rolled)

| Component | Purpose | Why Hand-Roll |
|-----------|---------|---------------|
| EasingFunctions | 12 easing function implementations | <100 LOC, no external deps, Penner's formulas are simple |
| AnimationEngine | Keyframe interpolation engine | Core business logic, needs tight integration |
| Timeline | Scene/duration management | Simple calculation, no library needed |
| TransitionRenderer | Scene transition effects | Composition of existing rendering |

### Supporting (Already in Project)

| Library | Version | Purpose | From Phase |
|---------|---------|---------|------------|
| @napi-rs/canvas | ^0.1.88 | Frame rendering | Phase 2 |
| zod | ^3.25 | Schema validation | Phase 1 |
| vitest | ^3.0 | Testing | Phase 1 |

### Alternatives Considered

| Instead of | Could Use | Why Not |
|------------|-----------|---------|
| Hand-rolled easing | d3-ease | Adds dependency for ~100 LOC of pure math |
| Hand-rolled easing | js-easing-functions | Old package, Robert Penner signature differs from our needs |
| Hand-rolled interpolation | Remotion interpolate() | React dependency, designed for different use case |
| Hand-rolled timeline | Rekapi | Overkill for scene/duration management |

**Installation:**
```bash
# No new dependencies required
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── animation/
│   ├── index.ts                 # Re-exports
│   ├── easing.ts                # 12 easing functions
│   ├── interpolate.ts           # Value interpolation utilities
│   ├── animation-engine.ts      # Keyframe processing
│   ├── presets.ts               # Enter/exit animation presets
│   └── types.ts                 # Animation type definitions
├── timeline/
│   ├── index.ts                 # Re-exports
│   ├── timeline.ts              # Scene sequencing
│   ├── transitions.ts           # Scene transition effects
│   └── types.ts                 # Timeline type definitions
├── schemas/
│   ├── animation.ts             # Keyframe/easing schemas (new)
│   └── scene.ts                 # Extended with transitions (modify)
└── render/
    └── frame-generator.ts       # Extended for animations (modify)
```

### Pattern 1: Pure Functional Interpolation

**What:** Easing and interpolation as pure functions of normalized time (0-1)
**When to use:** All animation calculations
**Why:** Deterministic, testable, no side effects

```typescript
// src/animation/interpolate.ts
// Source: Standard animation math, Remotion-inspired API

/**
 * Interpolate a value between input/output ranges with optional easing.
 *
 * @param frame - Current frame number
 * @param inputRange - [startFrame, endFrame]
 * @param outputRange - [startValue, endValue]
 * @param options - Easing and extrapolation options
 */
export function interpolate(
  frame: number,
  inputRange: [number, number],
  outputRange: [number, number],
  options?: {
    easing?: EasingFunction;
    extrapolateLeft?: 'clamp' | 'extend';
    extrapolateRight?: 'clamp' | 'extend';
  }
): number {
  const [inputStart, inputEnd] = inputRange;
  const [outputStart, outputEnd] = outputRange;
  const {
    easing = linear,
    extrapolateLeft = 'clamp',
    extrapolateRight = 'clamp'
  } = options ?? {};

  // Calculate progress (0-1)
  let progress = (frame - inputStart) / (inputEnd - inputStart);

  // Handle extrapolation
  if (progress < 0) {
    progress = extrapolateLeft === 'clamp' ? 0 : progress;
  } else if (progress > 1) {
    progress = extrapolateRight === 'clamp' ? 1 : progress;
  }

  // Apply easing
  const easedProgress = easing(Math.max(0, Math.min(1, progress)));

  // Interpolate output
  return outputStart + (outputEnd - outputStart) * easedProgress;
}
```

### Pattern 2: Easing Functions as Normalized Functions

**What:** All easing functions take t (0-1) and return t' (0-1, may exceed bounds for elastic/bounce)
**When to use:** All easing implementations
**Why:** Standard convention, composable, easy to test

```typescript
// src/animation/easing.ts
// Source: Robert Penner's equations, D3-ease patterns

/**
 * Easing function type: takes normalized time (0-1), returns eased time.
 */
export type EasingFunction = (t: number) => number;

// Basic easing functions
export const linear: EasingFunction = (t) => t;

export const easeIn: EasingFunction = (t) => t * t;
export const easeOut: EasingFunction = (t) => t * (2 - t);
export const easeInOut: EasingFunction = (t) =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

// Cubic (default "ease" family)
export const easeInCubic: EasingFunction = (t) => t * t * t;
export const easeOutCubic: EasingFunction = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic: EasingFunction = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Bounce (complex - see full implementation below)
export const easeOutBounce: EasingFunction = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) {
    return n1 * t * t;
  } else if (t < 2 / d1) {
    return n1 * (t -= 1.5 / d1) * t + 0.75;
  } else if (t < 2.5 / d1) {
    return n1 * (t -= 2.25 / d1) * t + 0.9375;
  } else {
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
};

export const easeInBounce: EasingFunction = (t) =>
  1 - easeOutBounce(1 - t);

// Elastic (spring-like oscillation)
export const easeOutElastic: EasingFunction = (t) => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 :
    Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

export const easeInElastic: EasingFunction = (t) => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 :
    -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
};
```

### Pattern 3: Keyframe Animation Model

**What:** Animations defined as arrays of keyframes with time, value, and optional easing
**When to use:** ANIM-01 property animations
**Why:** Industry-standard model, matches user mental model from video editors

```typescript
// src/animation/types.ts

/**
 * A keyframe defines a property value at a specific time.
 */
export interface Keyframe<T = number> {
  /** Frame number when this keyframe occurs */
  frame: number;
  /** Value at this keyframe */
  value: T;
  /** Easing function to use when interpolating TO this keyframe */
  easing?: EasingName;
}

/**
 * Animation definition for a single property.
 */
export interface PropertyAnimation<T = number> {
  /** Property path (e.g., "x", "opacity", "scale.x") */
  property: string;
  /** Keyframes in chronological order */
  keyframes: Keyframe<T>[];
}

/**
 * Element with animations attached.
 */
export interface AnimatedElement extends BaseElement {
  /** Animations for this element */
  animations?: PropertyAnimation[];
  /** Enter animation preset */
  enter?: AnimationPreset;
  /** Exit animation preset */
  exit?: AnimationPreset;
  /** When element starts being visible (frame number) */
  startFrame?: number;
  /** When element stops being visible (frame number) */
  endFrame?: number;
}
```

### Pattern 4: Animation Engine with Keyframe Processing

**What:** Engine that processes keyframes and returns animated values for any frame
**When to use:** Frame generation loop
**Why:** Centralizes animation logic, easy to extend

```typescript
// src/animation/animation-engine.ts

/**
 * Process keyframes and return the interpolated value for a given frame.
 */
export function getAnimatedValue(
  frame: number,
  keyframes: Keyframe<number>[],
  defaultEasing: EasingFunction = linear
): number {
  if (keyframes.length === 0) {
    throw new Error('At least one keyframe required');
  }

  // Sort keyframes by frame (should already be sorted, but ensure)
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);

  // Before first keyframe: return first value
  if (frame <= sorted[0].frame) {
    return sorted[0].value;
  }

  // After last keyframe: return last value
  if (frame >= sorted[sorted.length - 1].frame) {
    return sorted[sorted.length - 1].value;
  }

  // Find the two keyframes we're between
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1].frame < frame) {
    i++;
  }

  const from = sorted[i];
  const to = sorted[i + 1];
  const easing = to.easing ? getEasingFunction(to.easing) : defaultEasing;

  return interpolate(
    frame,
    [from.frame, to.frame],
    [from.value, to.value],
    { easing }
  );
}
```

### Pattern 5: Animation Presets as Keyframe Factories

**What:** Presets like "fade", "slide", "scale", "bounce" generate keyframe arrays
**When to use:** ANIM-03, ANIM-04 enter/exit animations
**Why:** DRY - presets are composed from the same primitives

```typescript
// src/animation/presets.ts

export type PresetType = 'fade' | 'slide' | 'scale' | 'bounce';
export type SlideDirection = 'left' | 'right' | 'top' | 'bottom';

export interface PresetConfig {
  type: PresetType;
  duration: number;  // in frames
  direction?: SlideDirection;  // for slide preset
  distance?: number;  // pixels for slide
  easing?: EasingName;
}

/**
 * Generate keyframes for an enter animation preset.
 */
export function generateEnterKeyframes(
  config: PresetConfig,
  startFrame: number,
  elementX: number,
  elementY: number
): PropertyAnimation[] {
  const { type, duration, direction = 'left', distance = 100, easing = 'easeOut' } = config;
  const endFrame = startFrame + duration;

  switch (type) {
    case 'fade':
      return [{
        property: 'opacity',
        keyframes: [
          { frame: startFrame, value: 0 },
          { frame: endFrame, value: 1, easing },
        ],
      }];

    case 'slide':
      const [offsetX, offsetY] = getSlideOffset(direction, distance);
      return [
        {
          property: 'x',
          keyframes: [
            { frame: startFrame, value: elementX + offsetX },
            { frame: endFrame, value: elementX, easing },
          ],
        },
        {
          property: 'y',
          keyframes: [
            { frame: startFrame, value: elementY + offsetY },
            { frame: endFrame, value: elementY, easing },
          ],
        },
        {
          property: 'opacity',
          keyframes: [
            { frame: startFrame, value: 0 },
            { frame: endFrame, value: 1, easing },
          ],
        },
      ];

    case 'scale':
      return [
        {
          property: 'scaleX',
          keyframes: [
            { frame: startFrame, value: 0 },
            { frame: endFrame, value: 1, easing },
          ],
        },
        {
          property: 'scaleY',
          keyframes: [
            { frame: startFrame, value: 0 },
            { frame: endFrame, value: 1, easing },
          ],
        },
        {
          property: 'opacity',
          keyframes: [
            { frame: startFrame, value: 0 },
            { frame: endFrame, value: 1, easing },
          ],
        },
      ];

    case 'bounce':
      return [
        {
          property: 'scaleX',
          keyframes: [
            { frame: startFrame, value: 0 },
            { frame: endFrame, value: 1, easing: 'easeOutBounce' },
          ],
        },
        {
          property: 'scaleY',
          keyframes: [
            { frame: startFrame, value: 0 },
            { frame: endFrame, value: 1, easing: 'easeOutBounce' },
          ],
        },
        {
          property: 'opacity',
          keyframes: [
            { frame: startFrame, value: 0 },
            { frame: Math.min(startFrame + duration * 0.3, endFrame), value: 1 },
          ],
        },
      ];
  }
}

function getSlideOffset(direction: SlideDirection, distance: number): [number, number] {
  switch (direction) {
    case 'left': return [-distance, 0];
    case 'right': return [distance, 0];
    case 'top': return [0, -distance];
    case 'bottom': return [0, distance];
  }
}
```

### Pattern 6: Timeline for Scene Sequencing

**What:** Timeline calculates which scene is active at any frame and handles transitions
**When to use:** Multi-scene videos (SCEN-01 through SCEN-04)
**Why:** Centralizes scene timing logic

```typescript
// src/timeline/timeline.ts

export interface SceneInfo {
  scene: Scene;
  sceneIndex: number;
  /** Frame within this scene (0-indexed from scene start) */
  localFrame: number;
  /** Whether this frame is in a transition */
  inTransition: boolean;
  /** If in transition, info about the transition */
  transition?: {
    from: Scene;
    to: Scene;
    progress: number;  // 0-1
    type: TransitionType;
    easing: EasingFunction;
  };
}

export class Timeline {
  private scenes: Scene[];
  private fps: number;

  constructor(scenes: Scene[], fps: number) {
    this.scenes = scenes;
    this.fps = fps;
  }

  /**
   * Get total duration in frames.
   */
  getTotalFrames(): number {
    return this.scenes.reduce(
      (total, scene) => total + Math.round(scene.duration * this.fps),
      0
    );
  }

  /**
   * Get scene info for a specific frame.
   */
  getSceneAtFrame(frame: number): SceneInfo {
    let accumulatedFrames = 0;

    for (let i = 0; i < this.scenes.length; i++) {
      const scene = this.scenes[i];
      const sceneFrames = Math.round(scene.duration * this.fps);
      const nextScene = this.scenes[i + 1];

      // Check if we're in a transition
      if (nextScene && scene.transition) {
        const transitionFrames = Math.round(
          (scene.transition.duration ?? 0.5) * this.fps
        );
        const transitionStart = accumulatedFrames + sceneFrames - transitionFrames;

        if (frame >= transitionStart && frame < accumulatedFrames + sceneFrames) {
          const transitionProgress = (frame - transitionStart) / transitionFrames;
          return {
            scene,
            sceneIndex: i,
            localFrame: frame - accumulatedFrames,
            inTransition: true,
            transition: {
              from: scene,
              to: nextScene,
              progress: transitionProgress,
              type: scene.transition.type,
              easing: getEasingFunction(scene.transition.easing ?? 'easeInOut'),
            },
          };
        }
      }

      if (frame < accumulatedFrames + sceneFrames) {
        return {
          scene,
          sceneIndex: i,
          localFrame: frame - accumulatedFrames,
          inTransition: false,
        };
      }

      accumulatedFrames += sceneFrames;
    }

    // Return last scene for frames beyond duration
    const lastScene = this.scenes[this.scenes.length - 1];
    return {
      scene: lastScene,
      sceneIndex: this.scenes.length - 1,
      localFrame: Math.round(lastScene.duration * this.fps) - 1,
      inTransition: false,
    };
  }
}
```

### Pattern 7: Scene Transitions as Composited Renders

**What:** Transitions render both scenes and composite them
**When to use:** SCEN-03, SCEN-04 scene transitions
**Why:** Clean separation, transitions are just blending two rendered frames

```typescript
// src/timeline/transitions.ts

export type TransitionType = 'fade' | 'slide' | 'zoom';

/**
 * Render a transition frame by compositing two scene renders.
 */
export function renderTransition(
  ctx: CanvasRenderingContext2D,
  fromBuffer: Buffer,
  toBuffer: Buffer,
  width: number,
  height: number,
  progress: number,  // 0-1, eased
  type: TransitionType,
  direction?: 'left' | 'right' | 'up' | 'down'
): void {
  switch (type) {
    case 'fade':
      renderFadeTransition(ctx, fromBuffer, toBuffer, width, height, progress);
      break;

    case 'slide':
      renderSlideTransition(ctx, fromBuffer, toBuffer, width, height, progress, direction ?? 'left');
      break;

    case 'zoom':
      renderZoomTransition(ctx, fromBuffer, toBuffer, width, height, progress);
      break;
  }
}

function renderFadeTransition(
  ctx: CanvasRenderingContext2D,
  fromBuffer: Buffer,
  toBuffer: Buffer,
  width: number,
  height: number,
  progress: number
): void {
  // Draw "from" scene at full opacity
  const fromImageData = new ImageData(
    new Uint8ClampedArray(fromBuffer),
    width,
    height
  );
  ctx.putImageData(fromImageData, 0, 0);

  // Draw "to" scene with increasing opacity
  ctx.globalAlpha = progress;
  const toImageData = new ImageData(
    new Uint8ClampedArray(toBuffer),
    width,
    height
  );
  ctx.putImageData(toImageData, 0, 0);
  ctx.globalAlpha = 1;
}

function renderSlideTransition(
  ctx: CanvasRenderingContext2D,
  fromBuffer: Buffer,
  toBuffer: Buffer,
  width: number,
  height: number,
  progress: number,
  direction: 'left' | 'right' | 'up' | 'down'
): void {
  const fromImageData = new ImageData(
    new Uint8ClampedArray(fromBuffer),
    width,
    height
  );
  const toImageData = new ImageData(
    new Uint8ClampedArray(toBuffer),
    width,
    height
  );

  // Calculate offsets based on direction
  let fromX = 0, fromY = 0, toX = 0, toY = 0;

  switch (direction) {
    case 'left':
      fromX = -width * progress;
      toX = width * (1 - progress);
      break;
    case 'right':
      fromX = width * progress;
      toX = -width * (1 - progress);
      break;
    case 'up':
      fromY = -height * progress;
      toY = height * (1 - progress);
      break;
    case 'down':
      fromY = height * progress;
      toY = -height * (1 - progress);
      break;
  }

  ctx.putImageData(fromImageData, fromX, fromY);
  ctx.putImageData(toImageData, toX, toY);
}
```

### Anti-Patterns to Avoid

- **Time-based animation in render loop:** Never use `Date.now()` or `performance.now()`. Always compute from frame number.
- **Mutable animation state:** Animation calculations should be pure functions, not stateful objects.
- **CSS-style animation:** No transition events or "animation frames" - compute values directly.
- **Complex inheritance:** Use composition of animations, not class hierarchies.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Easing formulas | Custom math | Robert Penner's equations | Battle-tested, expected behavior |
| Color interpolation | RGB lerp | HSL or Lab interpolation | RGB interpolation looks wrong (muddy midpoints) |
| Frame timing | Manual fps math | `Math.round(duration * fps)` | Avoid floating point drift |
| Buffer compositing | Manual pixel copy | ImageData + putImageData | Browser-native, handles alpha correctly |

**Key insight:** Animation math is well-established. The innovation is in API design and integration, not the underlying formulas.

---

## Common Pitfalls

### Pitfall 1: Floating Point Frame Drift

**What goes wrong:** Accumulating frame times leads to drift (e.g., scene ends at frame 299.9999 instead of 300)
**Why it happens:** Repeated floating point math accumulates errors
**How to avoid:** Always use `Math.round(duration * fps)` for frame counts, never accumulate
**Warning signs:** Scenes ending 1 frame early/late, animation stutters at scene boundaries

### Pitfall 2: Easing Outside [0,1] for Elastic/Bounce

**What goes wrong:** Elastic and bounce easing return values outside 0-1, which breaks assumptions
**Why it happens:** These easing functions intentionally overshoot
**How to avoid:** Clamp final property values where needed (e.g., opacity must be 0-1)
**Warning signs:** Negative opacity, scale > expected, visual glitches

### Pitfall 3: Scene Transition Overlap Calculation

**What goes wrong:** Transitions cut scenes short or overlap incorrectly
**Why it happens:** Transition duration is deducted from current scene, not added between scenes
**How to avoid:** Explicitly model: `sceneEnd = sceneStart + sceneDuration - transitionDuration`
**Warning signs:** Elements disappearing before expected, jumpy transitions

### Pitfall 4: Keyframe Ordering Assumptions

**What goes wrong:** Keyframes processed out of order produce wrong interpolation
**Why it happens:** User may define keyframes in non-chronological order in JSON
**How to avoid:** Always sort keyframes by frame before processing
**Warning signs:** Animations jumping backwards, wrong intermediate values

### Pitfall 5: Missing Default Values for Optional Animations

**What goes wrong:** Element with no animations specified gets undefined values
**Why it happens:** Animation system expects explicit values, element has none
**How to avoid:** When no animation exists for a property, use element's static value
**Warning signs:** Elements disappearing, NaN values in rendering

### Pitfall 6: Canvas State Leak During Transitions

**What goes wrong:** Compositing transitions corrupts canvas state
**Why it happens:** globalAlpha or transforms not reset after transition render
**How to avoid:** Wrap all transition rendering in save/restore
**Warning signs:** Next frame has wrong opacity, transforms are off

---

## Code Examples

### Complete Easing Function Set (12 functions)

```typescript
// src/animation/easing.ts
// Source: Robert Penner's equations (http://robertpenner.com/easing/)
// Verified against D3-ease implementation patterns

export type EasingFunction = (t: number) => number;

// Linear (no easing)
export const linear: EasingFunction = (t) => t;

// Quadratic (ease family - default)
export const easeIn: EasingFunction = (t) => t * t;
export const easeOut: EasingFunction = (t) => t * (2 - t);
export const easeInOut: EasingFunction = (t) =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

// Cubic
export const easeInCubic: EasingFunction = (t) => t * t * t;
export const easeOutCubic: EasingFunction = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic: EasingFunction = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Bounce
export const easeOutBounce: EasingFunction = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) {
    return n1 * t * t;
  } else if (t < 2 / d1) {
    return n1 * (t -= 1.5 / d1) * t + 0.75;
  } else if (t < 2.5 / d1) {
    return n1 * (t -= 2.25 / d1) * t + 0.9375;
  } else {
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
};

export const easeInBounce: EasingFunction = (t) => 1 - easeOutBounce(1 - t);

export const easeInOutBounce: EasingFunction = (t) =>
  t < 0.5
    ? (1 - easeOutBounce(1 - 2 * t)) / 2
    : (1 + easeOutBounce(2 * t - 1)) / 2;

// Elastic
export const easeOutElastic: EasingFunction = (t) => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 :
    Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

export const easeInElastic: EasingFunction = (t) => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 :
    -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
};

export const easeInOutElastic: EasingFunction = (t) => {
  const c5 = (2 * Math.PI) / 4.5;
  return t === 0 ? 0 : t === 1 ? 1 : t < 0.5
    ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
    : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
};

// Easing name lookup
export type EasingName =
  | 'linear'
  | 'easeIn' | 'easeOut' | 'easeInOut'
  | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic'
  | 'easeInBounce' | 'easeOutBounce' | 'easeInOutBounce'
  | 'easeInElastic' | 'easeOutElastic' | 'easeInOutElastic';

const EASING_FUNCTIONS: Record<EasingName, EasingFunction> = {
  linear,
  easeIn, easeOut, easeInOut,
  easeInCubic, easeOutCubic, easeInOutCubic,
  easeInBounce, easeOutBounce, easeInOutBounce,
  easeInElastic, easeOutElastic, easeInOutElastic,
};

export function getEasingFunction(name: EasingName): EasingFunction {
  return EASING_FUNCTIONS[name] ?? linear;
}
```

### Animation Schema Extensions

```typescript
// src/schemas/animation.ts
import { z } from 'zod';

export const EasingNameSchema = z.enum([
  'linear',
  'easeIn', 'easeOut', 'easeInOut',
  'easeInCubic', 'easeOutCubic', 'easeInOutCubic',
  'easeInBounce', 'easeOutBounce', 'easeInOutBounce',
  'easeInElastic', 'easeOutElastic', 'easeInOutElastic',
]);

export const KeyframeSchema = z.object({
  /** Time in seconds from element start */
  time: z.number().min(0),
  /** Value at this keyframe */
  value: z.number(),
  /** Easing to use when interpolating TO this keyframe */
  easing: EasingNameSchema.optional(),
});

export const PropertyAnimationSchema = z.object({
  /** Property to animate: x, y, rotation, scaleX, scaleY, opacity */
  property: z.enum(['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity']),
  /** Keyframes defining the animation */
  keyframes: z.array(KeyframeSchema).min(1),
});

export const AnimationPresetSchema = z.object({
  /** Preset type */
  type: z.enum(['fade', 'slide', 'scale', 'bounce']),
  /** Duration in seconds */
  duration: z.number().positive().default(0.5),
  /** Direction for slide preset */
  direction: z.enum(['left', 'right', 'top', 'bottom']).optional(),
  /** Distance in pixels for slide preset */
  distance: z.number().positive().optional(),
  /** Easing function */
  easing: EasingNameSchema.optional(),
});

export const TransitionSchema = z.object({
  /** Transition type */
  type: z.enum(['fade', 'slide', 'zoom']),
  /** Duration in seconds */
  duration: z.number().positive().default(0.5),
  /** Direction for slide transition */
  direction: z.enum(['left', 'right', 'up', 'down']).optional(),
  /** Easing function */
  easing: EasingNameSchema.optional(),
});
```

### Extended Scene Schema

```typescript
// src/schemas/scene.ts (extended)
import { z } from 'zod';
import { TransitionSchema } from './animation.js';

export const SceneSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  duration: z.number().positive({ message: 'Scene duration must be positive' }),
  background: ColorSchema.default('#000000'),
  elements: z.array(ElementSchema).default([]),
  /** Transition to next scene */
  transition: TransitionSchema.optional(),
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CSS animations | Frame-computed values | Always for video | Deterministic, reproducible |
| requestAnimationFrame | Pure frame functions | Always for video | No timing dependency |
| Spring physics libs | Simple elastic easing | For presets | Simpler, predictable |

**Current best practice for video rendering:**
- Remotion (React-based): Uses `interpolate()` and `spring()` functions
- FFmpeg-based tools: Pre-compute all values before render
- Video editors: Keyframe model with easing curves

---

## Open Questions

### Q1: Keyframe time vs frame specification

**Context:** Should users specify keyframe times in seconds or frames?
**Options:**
1. Seconds (user-friendly, fps-independent)
2. Frames (precise, matches internal model)
**Recommendation:** Seconds in schema, convert to frames internally using video fps. This matches user expectations from video editing software.

### Q2: Animation inheritance for grouped elements

**Context:** Should a parent animation (like a group fade) affect children?
**Options:**
1. No inheritance - each element animated independently
2. Full inheritance - parent opacity multiplies child opacity
**Recommendation:** Start with no inheritance (Phase 3). Add group animations in future if needed.

### Q3: Element timing: start/end vs in/out points

**Context:** How to specify when elements appear/disappear?
**Options:**
1. `startTime` / `endTime` in seconds
2. `startFrame` / `endFrame`
3. `inPoint` / `outPoint` (video editor terminology)
**Recommendation:** Use `startTime` / `endTime` in seconds for consistency with keyframe times. Convert to frames internally.

---

## Sources

### Primary (HIGH confidence)

- [Remotion Documentation](https://www.remotion.dev/docs/animating-properties) - Frame-based animation patterns, interpolate API
- [D3-ease](https://d3js.org/d3-ease) - Authoritative easing function definitions and behaviors
- [Robert Penner's Easing Equations](http://robertpenner.com/easing/) - Original easing math (via gist references)
- [easings.net](https://easings.net/) - Visual reference for all standard easing functions

### Secondary (MEDIUM confidence)

- [Rekapi](https://github.com/jeremyckahn/rekapi) - Keyframe animation model patterns
- [js-easing-functions](https://github.com/bameyrick/js-easing-functions) - TypeScript easing implementations
- [component/ease](https://github.com/component/ease) - Canvas-focused easing library
- [tailwindcss-animate](https://github.com/jamiebuilds/tailwindcss-animate) - Enter/exit animation preset patterns

### Tertiary (Project Context)

- Phase 2 RESEARCH.md - Established patterns for canvas rendering
- Existing codebase: FrameGenerator, RendererRegistry, transforms.ts

---

## Metadata

**Confidence breakdown:**
- Easing functions: HIGH - Robert Penner's equations are industry standard, verified against D3-ease
- Keyframe interpolation: HIGH - Well-established pattern (Remotion, Rekapi, After Effects)
- Animation presets: HIGH - Standard enter/exit patterns from CSS/motion libraries
- Scene transitions: HIGH - Standard video editor patterns (fade, slide, zoom)
- Timeline management: MEDIUM - Implementation details may need adjustment

**Research date:** 2026-01-25
**Valid until:** 2026-03-25 (animation patterns are stable)
