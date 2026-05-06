import type { z } from "zod";
import type {
  AssetSchema,
  CompositionMetaSchema,
  CompositionSchema,
  FontAssetSchema,
  GroupItemSchema,
  ImageAssetSchema,
  ItemSchema,
  LayerSchema,
  ShapeItemSchema,
  SpriteItemSchema,
  TextItemSchema,
  TransformSchema,
  TweenSchema,
} from "./zod.js";

export type Composition = z.infer<typeof CompositionSchema>;
export type CompositionMeta = z.infer<typeof CompositionMetaSchema>;

export type Asset = z.infer<typeof AssetSchema>;
export type ImageAsset = z.infer<typeof ImageAssetSchema>;
export type FontAsset = z.infer<typeof FontAssetSchema>;

export type Transform = z.infer<typeof TransformSchema>;

export type Item = z.infer<typeof ItemSchema>;
export type SpriteItem = z.infer<typeof SpriteItemSchema>;
export type TextItem = z.infer<typeof TextItemSchema>;
export type ShapeItem = z.infer<typeof ShapeItemSchema>;
export type GroupItem = z.infer<typeof GroupItemSchema>;

export type ItemType = Item["type"];

export type Layer = z.infer<typeof LayerSchema>;
export type Tween = z.infer<typeof TweenSchema>;
