import { z } from "zod";
import { EASING_NAMES } from "../easings/index.js";

// Canvas2D `globalCompositeOperation` values per HTML Living Standard. The
// renderer passes `Layer.blendMode` straight to `ctx.globalCompositeOperation`
// (see `src/engine/render.ts:150`), so anything outside this list produces
// host-divergent behavior — browsers silently ignore unknowns, skia-canvas
// throws. We also accept the CSS alias "normal" and map it to "source-over".
export const CANVAS2D_COMPOSITE_OPS = [
  "source-over",
  "source-in",
  "source-out",
  "source-atop",
  "destination-over",
  "destination-in",
  "destination-out",
  "destination-atop",
  "lighter",
  "copy",
  "xor",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

export const BLEND_MODES = [...CANVAS2D_COMPOSITE_OPS, "normal"] as const;
export const BlendModeSchema = z.enum(BLEND_MODES);

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

// Per UX_GAPS §M: `visible` and `locked` are optional booleans on every item
// (and layer). Absent ≡ visible & unlocked, keeping older project JSON valid
// without a migration. The engine skips drawing when `visible === false`;
// `locked` is purely a hint to the editor (Inspector + Stage drag refuse
// edits) and is ignored by the renderer.
//
// Per UX_GAPS §P: `name` is an optional human-friendly label rendered next
// to the id in the Inspector / LayersPanel / Outliner. It never replaces
// the id (existing references still resolve by id); the engine ignores it.
// Capped at 80 chars so an oversize label can't blow up the source map
// reveal or status-bar paths.
export const ItemFlagsSchema = {
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  name: z.string().max(80).optional(),
} as const;

export const SpriteItemSchema = z.object({
  type: z.literal("sprite"),
  asset: z.string().min(1),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  tint: z.string().optional(),
  transform: TransformSchema,
  ...ItemFlagsSchema,
});

export const TextItemSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  font: z.string().min(1),
  fontSize: z.number().positive(),
  color: z.string(),
  align: z.enum(["left", "center", "right"]).optional(),
  transform: TransformSchema,
  ...ItemFlagsSchema,
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
  ...ItemFlagsSchema,
});

export const GroupItemSchema = z.object({
  type: z.literal("group"),
  items: z.array(z.string().min(1)),
  transform: TransformSchema,
  ...ItemFlagsSchema,
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
  blendMode: BlendModeSchema,
  items: z.array(z.string().min(1)),
  ...ItemFlagsSchema,
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
