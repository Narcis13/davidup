import { z } from "zod";
import { EASING_NAMES } from "../easings/index.js";

/**
 * Canonical composition schema version. Bumped when the validator's accepted
 * shape changes incompatibly. Mirrored as the `version` string in every
 * `Composition` produced by `CompositionStore.toJSON()` and surfaced via
 * `list_engine_capabilities.schemaVersion`.
 */
export const COMPOSITION_VERSION = "0.1";

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

// External audio asset (v0.2 §S2). Container extensions accepted by
// `register_asset` — the canonical list both the MCP tool and the store check
// before admitting `type: "audio"`. Lowercased dotted form so `extname()`
// output compares directly.
export const AUDIO_ASSET_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".aac",
  ".m4a",
  ".ogg",
] as const;

/** True when `src` ends with one of {@link AUDIO_ASSET_EXTENSIONS} (case-insensitive). */
export function isSupportedAudioSrc(src: string): boolean {
  const lower = src.toLowerCase();
  return AUDIO_ASSET_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// Audio asset (v0.2 §S2). `src` is a path to an external audio file in a
// supported container (see AUDIO_ASSET_EXTENSIONS). The metadata fields are
// populated by `register_asset` via ffprobe at registration time; they are all
// optional so an asset registered while ffprobe is unavailable still parses and
// validates (the tool surfaces a warning instead of failing). Referenced by
// AudioTrack.asset (resolved at mux time, S4). `duration` is seconds;
// `sampleRate` is Hz; `channels` is the channel count; `codec` is ffprobe's
// `codec_name` (e.g. "mp3", "aac", "pcm_s16le").
export const AudioAssetSchema = z.object({
  id: z.string().min(1),
  type: z.literal("audio"),
  src: z.string().min(1),
  duration: z.number().nonnegative().optional(),
  sampleRate: z.number().int().positive().optional(),
  channels: z.number().int().positive().optional(),
  codec: z.string().min(1).optional(),
});

export const AssetSchema = z.discriminatedUnion("type", [
  ImageAssetSchema,
  FontAssetSchema,
  AudioAssetSchema,
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
//
// Lifespan: optional `enter` / `exit` seconds on the composition timeline.
// Half-open `[enter, exit)` window — outside it, the resolver flips
// `visible = false` so the existing render gate at engine/render.ts skips
// the item (or layer). Either bound omitted means "from the start" /
// "until the end" respectively, keeping legacy projects with no lifespan
// fields fully valid.
export const ItemFlagsSchema = {
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  name: z.string().max(80).optional(),
  enter: z.number().nonnegative().optional(),
  exit: z.number().positive().optional(),
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

// External audio track on the composition timeline (v0.2 §S1). Audio is never
// derived from video — every track here is an explicitly declared external
// asset. Placement is `[start, end)` seconds on the composition timeline; an
// omitted `end` means "play the asset out to its natural duration" (resolved at
// mux time, S4). `volume` is a linear gain multiplier in [0, 2] (1 = unchanged,
// 2 = +6dB); `fadeIn` / `fadeOut` are ramp lengths in seconds at each edge.
//
// `id` is optional in hand-authored JSON but is the addressing key used by the
// S3 MCP tools (update_audio_track / remove_audio_track); the store assigns one
// when a track is created without it. Mirrored field-for-field in the editor's
// command schema (apps/editor/app/types/commands.ts) — keep both in sync or new
// fields are silently stripped off UI/MCP payloads.
export const AudioTrackSchema = z
  .object({
    id: z.string().min(1).optional(),
    asset: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().optional(),
    volume: z.number().min(0).max(2).optional(),
    fadeIn: z.number().nonnegative().optional(),
    fadeOut: z.number().nonnegative().optional(),
  })
  .refine((t) => t.end === undefined || t.end > t.start, {
    message: "Audio track `end` must be greater than `start`.",
    path: ["end"],
  });

export const CompositionSchema = z.object({
  version: z.string(),
  composition: CompositionMetaSchema,
  assets: z.array(AssetSchema),
  layers: z.array(LayerSchema),
  items: z.record(z.string().min(1), ItemSchema),
  tweens: z.array(TweenSchema),
  // Optional so pre-v0.2 project JSON (no audio key) stays valid without a
  // migration, matching the rest of the schema's additive evolution.
  audio: z.array(AudioTrackSchema).optional(),
});
