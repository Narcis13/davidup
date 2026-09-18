import type { z } from "zod";
import type {
  AssetSchema,
  AudioAssetSchema,
  AudioTrackSchema,
  BlendModeSchema,
  CompositionMetaSchema,
  CompositionSchema,
  EffectSchema,
  FontAssetSchema,
  GroupItemSchema,
  ImageAssetSchema,
  ItemSchema,
  LayerSchema,
  ShapeItemSchema,
  SpriteItemSchema,
  TextItemSchema,
  TextShadowSchema,
  TransformSchema,
  TweenSchema,
  VideoAssetSchema,
  VideoFitSchema,
  VideoItemSchema,
} from "./zod.js";

export type BlendMode = z.infer<typeof BlendModeSchema>;

export type Composition = z.infer<typeof CompositionSchema>;
export type CompositionMeta = z.infer<typeof CompositionMetaSchema>;
export type AudioMaster = NonNullable<CompositionMeta["audioMaster"]>;

export type Asset = z.infer<typeof AssetSchema>;
export type ImageAsset = z.infer<typeof ImageAssetSchema>;
export type FontAsset = z.infer<typeof FontAssetSchema>;
export type AudioAsset = z.infer<typeof AudioAssetSchema>;
export type VideoAsset = z.infer<typeof VideoAssetSchema>;

export type Transform = z.infer<typeof TransformSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type EffectType = Effect["type"];

export type Item = z.infer<typeof ItemSchema>;
export type SpriteItem = z.infer<typeof SpriteItemSchema>;
export type TextItem = z.infer<typeof TextItemSchema>;
export type TextShadow = z.infer<typeof TextShadowSchema>;
export type ShapeItem = z.infer<typeof ShapeItemSchema>;
export type GroupItem = z.infer<typeof GroupItemSchema>;
export type VideoItem = z.infer<typeof VideoItemSchema>;
export type VideoFit = z.infer<typeof VideoFitSchema>;

export type ItemType = Item["type"];

export type Layer = z.infer<typeof LayerSchema>;
export type Tween = z.infer<typeof TweenSchema>;
export type AudioTrack = z.infer<typeof AudioTrackSchema>;
