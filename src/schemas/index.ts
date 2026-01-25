// Video specification schemas
export { OutputConfigSchema } from './output.js';
export { VideoSpecSchema } from './video-spec.js';

// Scene and element schemas
export { SceneSchema, ScenesSchema } from './scene.js';
export {
  // Element schemas
  TextElementSchema,
  ImageElementSchema,
  ShapeElementSchema,
  ElementSchema,
  // Shared schemas
  ShadowSchema,
  StrokeSchema,
  ColorSchema,
  HexColorSchema,
  FillSchema,
  GradientFillSchema,
  GradientStopSchema,
} from './elements.js';

// Animation schemas
export {
  EasingNameSchema,
  KeyframeSchema,
  PropertyAnimationSchema,
  AnimationPresetSchema,
  TransitionSchema,
  type EasingName,
  type Keyframe,
  type PropertyAnimation,
  type AnimationPreset,
  type Transition,
} from './animation.js';

// Audio schemas
export { AudioConfigSchema, type AudioConfig } from './audio.js';
