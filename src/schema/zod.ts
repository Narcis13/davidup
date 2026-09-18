import { z } from "zod";
import { EASING_NAMES } from "../easings/index.js";
import { isRationalFps } from "./fps.js";
import { strictObject } from "./strict.js";

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

// Tween easing (v1.1 S17): one of the 19 names, `{ bezier: [x1, y1, x2, y2] }`
// (CSS cubic-bezier — x1/x2 in [0, 1], y1/y2 may overshoot) or `{ steps: n }`
// (CSS steps(n), jump-end). The object forms are strict so an ambiguous
// `{ bezier, steps }` is rejected rather than resolved by union order.
// Shared by TweenSchema, the MCP tweens/behavior tools and the editor's
// command schema (apps/editor/app/types/commands.ts). Each tuple slot is its
// own schema instance: a reused instance becomes a `$ref` in the tool JSON
// Schema that MCP clients see.
export const BezierEasingSchema = strictObject({
  bezier: z.tuple([
    z.number().min(0).max(1),
    z.number().finite(),
    z.number().min(0).max(1),
    z.number().finite(),
  ]),
});

export const StepsEasingSchema = strictObject({ steps: z.number().int().min(1) });

// A plain union reports a bare "Invalid input" when nothing matches (a typo'd
// name, a 3-number bezier), where z.enum used to list the names. Out-of-range
// numbers, fractional steps and unknown keys keep their specific issue.
const easingErrorMap: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code !== z.ZodIssueCode.invalid_union) return { message: ctx.defaultError };
  let received: string;
  try {
    received = JSON.stringify(ctx.data) ?? String(ctx.data);
  } catch {
    received = String(ctx.data);
  }
  if (received.length > 80) received = `${received.slice(0, 77)}...`;
  return {
    message:
      `Invalid easing ${received}. Expected a name (${EASING_NAMES.join(" | ")}), ` +
      "{ bezier: [x1, y1, x2, y2] } with x1 and x2 in [0, 1], or { steps: n } with an integer n ≥ 1.",
  };
};

export const EasingSchema = z.union(
  [z.enum(EASING_NAMES), BezierEasingSchema, StepsEasingSchema],
  { errorMap: easingErrorMap },
);

// Item ids (the `items` record key), layer ids, tween ids, tween targets, and
// tween properties all end up as one half of the resolver's bucket key
// `${target}::${property}` (see engine/resolver.ts). That key is split on the
// first "::" it finds, so any of these strings containing "::" would corrupt
// the split and silently misroute or drop tweens (R-3). Forbidding the
// substring outright — rather than rejecting every colon — keeps
// single-colon ids (if any project relies on them) valid.
export function idSchema(label: string) {
  return z.string().min(1).refine((v) => !v.includes("::"), {
    message: `${label} must not contain "::"`,
  });
}

// Shape only. Encoder preconditions (even width/height for libx264+yuv420p,
// the >4096 size warning) are semantic checks in `validator.ts`
// (`checkDimensions` → E_DIMENSION_ODD / W_DIMENSION_LARGE) so they surface
// with their own code rather than a generic E_SCHEMA.
// `fps` is a positive number or an exact rational "N/D" (v1.1 S7), e.g.
// "30000/1001" for NTSC 29.97 — see `fps.ts` for the time math.
export const FpsSchema = z.union([
  z.number().positive(),
  z.string().refine(isRationalFps, {
    message: 'fps string must be a rational "N/D" with positive integers, e.g. "30000/1001"',
  }),
]);

export const CompositionMetaSchema = strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: FpsSchema,
  duration: z.number().nonnegative(),
  // Any CSS colour, or "transparent" (v1.1 S9): nothing is painted, so alpha
  // codecs (ProRes 4444 / VP9) export the empty canvas as alpha 0.
  background: z.string(),
  // Master bus applied after all audio tracks are mixed (v1.1 S10). Omitted ⇒
  // `{ limiter: true }`: a -1 dBFS lookahead limiter so overlapping music +
  // voiceover can't clip. `targetLufs` adds a two-pass EBU R128 loudness
  // normalisation (an extra ffmpeg analysis pass over the mix) before the
  // limiter. Ignored when the composition has no `audio[]`.
  audioMaster: strictObject({
    limiter: z.boolean().optional(),
    targetLufs: z.number().min(-70).max(-5).optional(),
  }).optional(),
});

export const ImageAssetSchema = strictObject({
  id: z.string().min(1),
  type: z.literal("image"),
  src: z.string().min(1),
});

export const FontAssetSchema = strictObject({
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
export const AudioAssetSchema = strictObject({
  id: z.string().min(1),
  type: z.literal("audio"),
  src: z.string().min(1),
  duration: z.number().nonnegative().optional(),
  sampleRate: z.number().int().positive().optional(),
  channels: z.number().int().positive().optional(),
  codec: z.string().min(1).optional(),
});

// External video asset (v0.2 §S6). Container extensions accepted by
// `register_asset` — the canonical list both the MCP tool and the store check
// before admitting `type: "video"`. Lowercased dotted form so `extname()`
// output compares directly. Mirrors AUDIO_ASSET_EXTENSIONS.
export const VIDEO_ASSET_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
] as const;

/** True when `src` ends with one of {@link VIDEO_ASSET_EXTENSIONS} (case-insensitive). */
export function isSupportedVideoSrc(src: string): boolean {
  const lower = src.toLowerCase();
  return VIDEO_ASSET_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// Video asset (v0.2 §S6). `src` is a path to an external video file in a
// supported container (see VIDEO_ASSET_EXTENSIONS). The metadata fields are
// populated by `register_asset` via ffprobe at registration time; they are all
// optional so an asset registered while ffprobe is unavailable still parses and
// validates (the tool surfaces a warning instead of failing). Referenced by
// VideoItem.asset (§S5) — once registered with a numeric `duration` it
// activates the `trimOut ≤ duration` check in the semantic validator.
// `duration` is seconds; `width`/`height` are pixels; `fps` is the frame rate;
// `hasAlpha` is true when the pixel format carries an alpha plane; `codec` is
// ffprobe's `codec_name` (e.g. "h264", "vp9", "av1"); `pixelFormat` is
// ffprobe's `pix_fmt` (e.g. "yuv420p", "yuva420p"); `hasAudio` (v1.1 S11) is
// whether the container carries at least one audio stream — it lets the
// validator warn when a `keepAudio` clip has no sound to keep.
export const VideoAssetSchema = strictObject({
  id: z.string().min(1),
  type: z.literal("video"),
  src: z.string().min(1),
  duration: z.number().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().optional(),
  // The probed rate verbatim ("30000/1001"). Accepted so a `probeVideo()`
  // result can be spread straight into an asset under the strict schema.
  fpsRational: z.string().refine(isRationalFps).optional(),
  hasAlpha: z.boolean().optional(),
  codec: z.string().min(1).optional(),
  pixelFormat: z.string().min(1).optional(),
  hasAudio: z.boolean().optional(),
});

export const AssetSchema = z.discriminatedUnion("type", [
  ImageAssetSchema,
  FontAssetSchema,
  AudioAssetSchema,
  VideoAssetSchema,
]);

export const TransformSchema = strictObject({
  x: z.number(),
  y: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  rotation: z.number(),
  anchorX: z.number(),
  anchorY: z.number(),
  opacity: z.number().min(0).max(1),
});

// Per-item visual effects (v1.1 S21). `effects` is an ordered stack: the item
// is first painted onto a scratch surface as a whole (a group with all its
// children, at full alpha), each effect is then applied to the result of the
// one before it, and the outcome is composited once with the item's opacity.
// So a shadow listed after a blur is cast by the blurred item, and two glows
// stack into a stronger halo. Effects imply isolation: a group carrying
// effects is flattened exactly as with `isolate: true`.
//
// All lengths are canvas pixels, applied after the item's transform — like
// the text shadow, they do not grow or rotate with the item's scale/rotation.
//   blur   — Gaussian blur; `radius` is the CSS `blur()` radius (σ, px).
//   shadow — drop shadow, same fields and units as the text `shadow`
//            (`blur` is the Canvas2D `shadowBlur`, i.e. 2σ).
//   glow   — an un-offset halo in `color`; `radius` is σ like `blur`.
// Tweenable as `effects.<index>.<field>` — see schema/tweenable.ts.
//
// DUAL: mirror in apps/editor/app/types/commands.ts.
export const BlurEffectSchema = strictObject({
  type: z.literal("blur"),
  radius: z.number().nonnegative(),
});

export const ShadowEffectSchema = strictObject({
  type: z.literal("shadow"),
  color: z.string(),
  blur: z.number().nonnegative().optional(),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
});

export const GlowEffectSchema = strictObject({
  type: z.literal("glow"),
  color: z.string(),
  radius: z.number().nonnegative(),
});

export const EffectSchema = z.discriminatedUnion("type", [
  BlurEffectSchema,
  ShadowEffectSchema,
  GlowEffectSchema,
]);

export const EFFECT_TYPES = ["blur", "shadow", "glow"] as const;

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
//
// Effects (v1.1 S21): an optional, ordered stack of visual effects on any
// item — see `EffectSchema` below.
export const ItemFlagsSchema = {
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  name: z.string().max(80).optional(),
  enter: z.number().nonnegative().optional(),
  exit: z.number().positive().optional(),
  effects: z.array(EffectSchema).optional(),
} as const;

export const SpriteItemSchema = strictObject({
  type: z.literal("sprite"),
  asset: z.string().min(1),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  tint: z.string().optional(),
  transform: TransformSchema,
  ...ItemFlagsSchema,
});

// Drop shadow cast by a text item's fill (v1.1 S13). Offsets are in canvas
// pixels and, per Canvas2D, are not affected by the item's rotation/scale.
export const TextShadowSchema = strictObject({
  color: z.string(),
  blur: z.number().nonnegative().optional(),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
});

// Text v2 (v1.1 S13, TEXT_V2_DESIGN.md). Every field after `align` is
// optional; see src/engine/textLayout.ts for the layout model:
//   - point mode (no `maxWidth`, anchor 0,0): first baseline at the origin,
//     lines aligned around x — a single line draws exactly as in v1.0.
//   - box mode (`maxWidth` set, or a non-zero anchor): origin is the top-left
//     of the text block, anchors pivot on its measured extent.
//   maxWidth      — word-wrap width in px (a word wider than it overflows)
//   lineHeight    — line advance as a multiple of fontSize (default 1.2)
//   letterSpacing — extra px between glyphs (may be negative)
//   fontWeight    — CSS weight keyword or 1..1000
//   fontStyle     — CSS font-style
//   strokeColor / strokeWidth — outline drawn over the fill
//   shadow        — drop shadow cast by the fill
export const TextItemSchema = strictObject({
  type: z.literal("text"),
  text: z.string(),
  font: z.string().min(1),
  fontSize: z.number().positive(),
  color: z.string(),
  align: z.enum(["left", "center", "right"]).optional(),
  maxWidth: z.number().positive().optional(),
  lineHeight: z.number().positive().optional(),
  letterSpacing: z.number().optional(),
  fontWeight: z
    .union([z.enum(["normal", "bold"]), z.number().int().min(1).max(1000)])
    .optional(),
  fontStyle: z.enum(["normal", "italic", "oblique"]).optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().nonnegative().optional(),
  shadow: TextShadowSchema.optional(),
  transform: TransformSchema,
  ...ItemFlagsSchema,
});

export const ShapeItemSchema = strictObject({
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

// Group (v1.1 S18 adds `isolate` / `blendMode`).
//
// By default a group is a pure transform node: its `transform.opacity`
// multiplies into every descendant's alpha and its children paint straight
// onto the shared canvas. Two overlapping opaque children in a 50 % group
// therefore show their seam, because each is composited separately (R-20).
//
//   isolate   — flatten the children into a scratch surface first, then
//               composite that surface once with the group's opacity and
//               blend mode. The group reads as one layer: overlaps vanish,
//               and a child's own blend mode sees only its siblings, not the
//               canvas backdrop (CSS `isolation: isolate`). Opt-in — absent
//               keeps the multiplicative path, so no existing frame moves.
//   blendMode — how the group composites against what is already painted.
//               Isolated, it applies once to the flattened result; otherwise
//               it applies to each child's own draw (like `Layer.blendMode`).
//
// DUAL: mirror both in apps/editor/app/types/commands.ts or they are silently
// stripped off UI payloads.
export const GroupItemSchema = strictObject({
  type: z.literal("group"),
  items: z.array(z.string().min(1)),
  isolate: z.boolean().optional(),
  blendMode: BlendModeSchema.optional(),
  transform: TransformSchema,
  ...ItemFlagsSchema,
});

// How a VideoItem's decoded frame is scaled into its [width, height] box,
// mirroring CSS `object-fit` (v0.2 §S5):
//   cover   — fill the box, preserve aspect, crop overflow
//   contain — fit inside the box, preserve aspect, letterbox (the default)
//   fill    — stretch to the box, aspect not preserved
//   none    — draw at native frame size, no scaling
// Drives the renderer's dst-rect math (S8); inert until then.
export const VIDEO_FIT_MODES = ["cover", "contain", "fill", "none"] as const;
export const VideoFitSchema = z.enum(VIDEO_FIT_MODES);

// Video clip placed on the composition (v0.2 §S5). Spatially a sprite — same
// `transform` + `width`/`height` box — so the existing resolver/renderer
// transform path and every sprite tween (transform.*, width, height) apply
// unchanged (see tweenable.ts `video`). On top of that it carries a temporal
// window on the composition timeline plus a trim into the source asset:
//   start            — composition time (s) the clip begins playing
//   end              — composition time (s) it stops; omitted ⇒ runs until the
//                      trimmed source is exhausted, then freeze/loop (S8)
//   trimIn / trimOut — [trimIn, trimOut) seconds sliced out of the source
//   fit              — how the frame fills the box (default "contain")
//   loop             — replay the trimmed source when `end` outlasts it
//
//   keepAudio        — (v1.1 S11) mux the clip's own audio stream: the render
//                      synthesises an `audio[]` track `${itemId}__audio` that
//                      mirrors start/end/trimIn/trimOut (see
//                      compose/videoAudio.ts)
//
// By default video is a SILENT texture — all audio comes from explicitly
// declared AudioTracks (§S1); `keepAudio` is the one opt-in bridge. The `asset`
// reference is intentionally NOT cross-checked at parse time (video asset
// registration is §S6, mirroring how audio §S1 defers its check to §S2), so a
// composition naming a not-yet-registered clip still parses. The temporal/trim
// invariants (`0 ≤ trimIn < trimOut ≤ asset.duration`, `end > start`) are
// enforced by the semantic validator, not here: `.refine()` cannot sit inside a
// discriminatedUnion, and the `≤ asset.duration` bound needs the asset map.
// DUAL: mirror any new field in apps/editor/app/types/commands.ts or it is
// silently stripped off UI payloads.
export const VideoItemSchema = strictObject({
  type: z.literal("video"),
  asset: z.string().min(1),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  start: z.number().nonnegative(),
  end: z.number().positive().optional(),
  trimIn: z.number().nonnegative().optional(),
  trimOut: z.number().positive().optional(),
  fit: VideoFitSchema.default("contain"),
  loop: z.boolean().default(false),
  keepAudio: z.boolean().optional(),
  transform: TransformSchema,
  ...ItemFlagsSchema,
});

export const ItemSchema = z.discriminatedUnion("type", [
  SpriteItemSchema,
  TextItemSchema,
  ShapeItemSchema,
  GroupItemSchema,
  VideoItemSchema,
]);

export const LayerSchema = strictObject({
  id: idSchema("Layer id"),
  z: z.number(),
  opacity: z.number().min(0).max(1),
  blendMode: BlendModeSchema,
  items: z.array(z.string().min(1)),
  ...ItemFlagsSchema,
});

export const TweenSchema = strictObject({
  id: idSchema("Tween id"),
  target: idSchema("Tween target"),
  property: idSchema("Tween property"),
  from: z.union([z.number(), z.string()]),
  to: z.union([z.number(), z.string()]),
  start: z.number().nonnegative(),
  duration: z.number().positive(),
  easing: EasingSchema.optional(),
});

// External audio track on the composition timeline (v0.2 §S1). Audio is never
// derived from video — every track here is an explicitly declared external
// asset. Placement is `[start, end)` seconds on the composition timeline; an
// omitted `end` means "play the asset out to its natural duration" (resolved at
// mux time, S4). `trimIn` (R-11, Session 28) is the offset in seconds *into the
// source file* to start reading from — the timeline placement and the
// in-source read point are independent, so a track can both start mid-file and
// land anywhere on the timeline. Mirrors `VideoItemSchema.trimIn` for the same
// idea on the video side. `volume` is a linear gain multiplier in [0, 2]
// (1 = unchanged, 2 = +6dB); `fadeIn` / `fadeOut` are ramp lengths in seconds
// at each edge, measured from the (possibly trimmed) clip's own start/end.
// `loop` (v1.1 S10) repeats the (trimIn-seeked) source until `end` — or the
// composition end when `end` is omitted — so a short music bed can run under a
// longer clip.
//
// `id` is optional in hand-authored JSON but is the addressing key used by the
// S3 MCP tools (update_audio_track / remove_audio_track); the store assigns one
// when a track is created without it. Mirrored field-for-field in the editor's
// command schema (apps/editor/app/types/commands.ts) — keep both in sync or new
// fields are silently stripped off UI/MCP payloads.
export const AudioTrackSchema = strictObject({
  id: z.string().min(1).optional(),
  asset: z.string().min(1),
  start: z.number().nonnegative(),
  end: z.number().optional(),
  trimIn: z.number().nonnegative().optional(),
  volume: z.number().min(0).max(2).optional(),
  fadeIn: z.number().nonnegative().optional(),
  fadeOut: z.number().nonnegative().optional(),
  loop: z.boolean().optional(),
}).refine((t) => t.end === undefined || t.end > t.start, {
  message: "Audio track `end` must be greater than `start`.",
  path: ["end"],
});

export const CompositionSchema = strictObject({
  version: z.string(),
  composition: CompositionMetaSchema,
  assets: z.array(AssetSchema),
  layers: z.array(LayerSchema),
  items: z.record(idSchema("Item id"), ItemSchema),
  tweens: z.array(TweenSchema),
  // Optional so pre-v0.2 project JSON (no audio key) stays valid without a
  // migration, matching the rest of the schema's additive evolution.
  audio: z.array(AudioTrackSchema).optional(),
});
