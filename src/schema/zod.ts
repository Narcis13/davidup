import { z } from "zod";
import { EASING_NAMES } from "../easings/index.js";

export const CompositionMetaSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  duration: z.number().nonnegative(),
  background: z.string(),
});

export const ImageAssetSchema = z.object({
  id: z.string().min(1),
  type: z.literal("image"),
  src: z.string().min(1),
});

export const FontAssetSchema = z.object({
  id: z.string().min(1),
  type: z.literal("font"),
  src: z.string().min(1),
  family: z.string().min(1),
});

export const AssetSchema = z.discriminatedUnion("type", [
  ImageAssetSchema,
  FontAssetSchema,
]);

export const TransformSchema = z.object({
  x: z.number(),
  y: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  rotation: z.number(),
  anchorX: z.number(),
  anchorY: z.number(),
  opacity: z.number().min(0).max(1),
});

export const SpriteItemSchema = z.object({
  type: z.literal("sprite"),
  asset: z.string().min(1),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  tint: z.string().optional(),
  transform: TransformSchema,
});

export const TextItemSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  font: z.string().min(1),
  fontSize: z.number().positive(),
  color: z.string(),
  align: z.enum(["left", "center", "right"]).optional(),
  transform: TransformSchema,
});

export const ShapeItemSchema = z.object({
  type: z.literal("shape"),
  kind: z.enum(["rect", "circle", "polygon"]),
  width: z.number().nonnegative().optional(),
  height: z.number().nonnegative().optional(),
  points: z.array(z.tuple([z.number(), z.number()])).optional(),
  fillColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().nonnegative().optional(),
  cornerRadius: z.number().nonnegative().optional(),
  transform: TransformSchema,
});

export const GroupItemSchema = z.object({
  type: z.literal("group"),
  items: z.array(z.string().min(1)),
  transform: TransformSchema,
});

export const ItemSchema = z.discriminatedUnion("type", [
  SpriteItemSchema,
  TextItemSchema,
  ShapeItemSchema,
  GroupItemSchema,
]);

export const LayerSchema = z.object({
  id: z.string().min(1),
  z: z.number(),
  opacity: z.number().min(0).max(1),
  blendMode: z.string(),
  items: z.array(z.string().min(1)),
});

export const TweenSchema = z.object({
  id: z.string().min(1),
  target: z.string().min(1),
  property: z.string().min(1),
  from: z.union([z.number(), z.string()]),
  to: z.union([z.number(), z.string()]),
  start: z.number().nonnegative(),
  duration: z.number().positive(),
  easing: z.enum(EASING_NAMES).optional(),
});

export const CompositionSchema = z.object({
  version: z.string(),
  composition: CompositionMetaSchema,
  assets: z.array(AssetSchema),
  layers: z.array(LayerSchema),
  items: z.record(z.string().min(1), ItemSchema),
  tweens: z.array(TweenSchema),
});
