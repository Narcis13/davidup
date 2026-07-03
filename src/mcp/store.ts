// In-memory composition store backing the MCP server (per design-doc §4 + plan §8).
//
// One CompositionStore tracks any number of compositions keyed by id, plus a
// "default" id that is implicitly used when a tool call omits compositionId.
// The first composition created becomes the default; reset() drops the default
// when the active composition is removed.
//
// Mutation primitives intentionally mirror the §4 tool surface so each MCP
// tool handler is a thin wrapper. The store enforces structural invariants
// the design doc guarantees (unique ids, asset-in-use, layer-non-empty,
// tween overlap) by throwing MCPToolError; tool wrappers turn those into
// structured `{error}` payloads.

import type { EasingName } from "../easings/index.js";
import { validate, OVERLAP_EPS, type ValidationResult } from "../schema/validator.js";
import type {
  Asset,
  AudioTrack,
  BlendMode,
  Composition,
  CompositionMeta,
  GroupItem,
  Item,
  Layer,
  ShapeItem,
  SpriteItem,
  TextItem,
  Transform,
  Tween,
  VideoFit,
  VideoItem,
} from "../schema/types.js";
import {
  AUDIO_ASSET_EXTENSIONS,
  VIDEO_ASSET_EXTENSIONS,
  COMPOSITION_VERSION,
  ItemSchema,
  isSupportedAudioSrc,
  isSupportedVideoSrc,
} from "../schema/zod.js";
import { getTweenable } from "../schema/tweenable.js";
import type { BehaviorDescriptor } from "../compose/behaviors.js";
import type { SceneDefinition, TimeMapping } from "../compose/scenes.js";
import type { TemplateDefinition } from "../compose/templates.js";
import { MCPToolError } from "./errors.js";

const DEFAULT_BACKGROUND = "#000000";
const DEFAULT_OPACITY = 1;
const DEFAULT_BLEND_MODE: BlendMode = "normal";

const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0,
  anchorY: 0,
  opacity: 1,
};

interface SceneInstanceRecord {
  sceneId: string;
  layerId: string;
  start: number;
  params: Record<string, unknown>;
  transform: Record<string, unknown> | undefined;
  /** v0.5 time-mapping spec. Undefined means identity. */
  time: TimeMapping | undefined;
  /** Item ids added by this scene instance (wrapper group + prefixed inner items). */
  itemIds: string[];
  /** Tween ids added by this scene instance. */
  tweenIds: string[];
  /** Asset ids added by this scene instance (those NOT pre-existing in root). */
  assetIds: string[];
}

interface MutableComposition {
  readonly id: string;
  meta: CompositionMeta;
  // Insertion-ordered Maps preserve the order assets/layers/items were added,
  // which becomes the order they appear in the serialised JSON.
  assets: Map<string, Asset>;
  layers: Map<string, Layer>;
  items: Map<string, Item>;
  // itemLayer[itemId] = layerId | null. null means orphan (not in any layer)
  // — we never produce orphans through public APIs but keep the slot for
  // group children that are created without a layer assignment in future.
  itemLayer: Map<string, string>;
  tweens: Map<string, Tween>;
  // External audio tracks keyed by id (v0.2 §S3). Insertion-ordered like the
  // other maps so the serialised `audio[]` keeps add order. Audio is never
  // derived from video — every entry is an explicitly declared external asset.
  audio: Map<string, AudioTrack>;
  // Scene instance tracking — populated by add_scene_instance / cleared by
  // update_scene_instance + remove. Lets scene-instance MCP tools roll back
  // exactly the items/tweens/assets a prior call added without scanning.
  sceneInstances: Map<string, SceneInstanceRecord>;
  // Monotonic counters used when an explicit id is not supplied.
  nextSeq: { layer: number; item: number; tween: number; comp: number; scene: number; audio: number };
}

export interface CreateCompositionInput {
  width: number;
  height: number;
  fps: number;
  duration: number;
  background?: string;
  id?: string;
}

export type SetMetaPropertyName =
  | "width"
  | "height"
  | "fps"
  | "duration"
  | "background";

export interface RegisterAssetInput {
  id: string;
  type: "image" | "font" | "audio" | "video";
  src: string;
  family?: string;
  // Audio (v0.2 §S2) + video (§S6) metadata. Probed via ffprobe by the
  // `register_asset` tool before the input reaches the store; all optional so
  // the asset can be registered even when ffprobe is unavailable. `duration`
  // and `codec` are shared; `sampleRate`/`channels` are audio-only;
  // `width`/`height`/`fps`/`hasAlpha`/`pixelFormat` are video-only.
  duration?: number;
  sampleRate?: number;
  channels?: number;
  codec?: string;
  width?: number;
  height?: number;
  fps?: number;
  hasAlpha?: boolean;
  pixelFormat?: string;
}

export interface AddLayerInput {
  id?: string;
  z: number;
  opacity?: number;
  blendMode?: BlendMode;
  visible?: boolean;
  locked?: boolean;
  name?: string;
}

export interface UpdateLayerProps {
  z?: number;
  opacity?: number;
  blendMode?: BlendMode;
  visible?: boolean;
  locked?: boolean;
  name?: string;
  // Lifespan — same semantics as on items (see UpdateItemProps).
  enter?: number;
  exit?: number;
}

export interface AddSpriteInput {
  layerId: string;
  asset: string;
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX?: number;
  anchorY?: number;
  rotation?: number;
  opacity?: number;
  scaleX?: number;
  scaleY?: number;
  tint?: string;
  id?: string;
  name?: string;
}

export interface AddTextInput {
  layerId: string;
  text: string;
  font: string;
  fontSize: number;
  color: string;
  x: number;
  y: number;
  anchorX?: number;
  anchorY?: number;
  align?: "left" | "center" | "right";
  rotation?: number;
  opacity?: number;
  id?: string;
  name?: string;
}

export interface AddShapeInput {
  layerId: string;
  kind: "rect" | "circle" | "polygon";
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: ReadonlyArray<readonly [number, number]>;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  rotation?: number;
  opacity?: number;
  anchorX?: number;
  anchorY?: number;
  id?: string;
  name?: string;
}

export interface AddGroupInput {
  layerId: string;
  x: number;
  y: number;
  childItemIds?: ReadonlyArray<string>;
  anchorX?: number;
  anchorY?: number;
  rotation?: number;
  opacity?: number;
  scaleX?: number;
  scaleY?: number;
  id?: string;
  name?: string;
}

export interface UpdateItemProps {
  // Transform overrides applied as a partial merge.
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  anchorX?: number;
  anchorY?: number;
  opacity?: number;
  // Sprite/shape size.
  width?: number;
  height?: number;
  // Sprite-specific.
  asset?: string;
  tint?: string;
  // Text-specific.
  text?: string;
  font?: string;
  fontSize?: number;
  color?: string;
  align?: "left" | "center" | "right";
  // Shape-specific.
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  points?: ReadonlyArray<readonly [number, number]>;
  // Group-specific.
  items?: ReadonlyArray<string>;
  // §M flags (all item types).
  visible?: boolean;
  locked?: boolean;
  // §P friendly label — display-only; never replaces the id.
  name?: string;
  // Lifespan: half-open [enter, exit) window in composition seconds. Either
  // bound omitted means open on that side. Out-of-window items render as if
  // `visible = false` (see engine/resolver.ts).
  enter?: number;
  exit?: number;
}

export interface AddTweenInput {
  target: string;
  property: string;
  from: number | string;
  to: number | string;
  start: number;
  duration: number;
  easing?: EasingName;
  id?: string;
}

export interface UpdateTweenProps {
  target?: string;
  property?: string;
  from?: number | string;
  to?: number | string;
  start?: number;
  duration?: number;
  easing?: EasingName;
}

export interface ListTweensFilter {
  target?: string;
  property?: string;
}

// Audio track inputs (v0.2 §S3). `start`/`end` are composition seconds (`end`
// omitted ⇒ play out to the asset's natural duration at mux time); `volume` is
// a linear gain in [0, 2]; `fadeIn`/`fadeOut` are ramp lengths in seconds.
export interface AddAudioTrackInput {
  asset: string;
  start: number;
  end?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  id?: string;
}

export interface UpdateAudioTrackProps {
  asset?: string;
  start?: number;
  end?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface ListAudioTracksFilter {
  asset?: string;
}

// Returned by add/update so the MCP tool can surface non-fatal placement
// warnings (track extends past the composition end) without failing the call —
// aligns with the v0.2 plan's Q6 "warn, don't error" rule.
export interface AudioTrackMutationResult {
  warnings: string[];
}

export interface AddAudioTrackResult extends AudioTrackMutationResult {
  id: string;
}

// Video item inputs (v0.2 §S9). Spatially a sprite (`x`/`y` + `width`/`height`
// box + transform); on top of that a temporal window (`start`/`end`) and a
// source trim (`trimIn`/`trimOut`). `width`/`height` default to the composition
// dimensions; `start` defaults to 0; `fit` to "contain"; `loop` to false.
// `layerId` is optional — omitted, the clip lands on the topmost layer (highest
// z). Video carries ZERO audio fields by design.
export interface AddVideoInput {
  layerId?: string;
  asset: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  anchorX?: number;
  anchorY?: number;
  rotation?: number;
  opacity?: number;
  scaleX?: number;
  scaleY?: number;
  start?: number;
  end?: number;
  trimIn?: number;
  trimOut?: number;
  fit?: VideoFit;
  loop?: boolean;
  id?: string;
  name?: string;
}

export interface UpdateVideoProps {
  // Transform overrides.
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  anchorX?: number;
  anchorY?: number;
  opacity?: number;
  // Spatial box + source.
  width?: number;
  height?: number;
  asset?: string;
  // Temporal window + source trim + display.
  start?: number;
  end?: number;
  trimIn?: number;
  trimOut?: number;
  fit?: VideoFit;
  loop?: boolean;
  // §M flags + §P label + lifespan (every item type).
  visible?: boolean;
  locked?: boolean;
  name?: string;
  enter?: number;
  exit?: number;
}

// Like the audio result types, add/update surface non-fatal placement warnings
// (the clip's visible window extends past the composition end) without failing.
export interface VideoMutationResult {
  warnings: string[];
}

export interface AddVideoResult extends VideoMutationResult {
  itemId: string;
}

export class CompositionStore {
  private readonly compositions = new Map<string, MutableComposition>();
  private defaultId: string | null = null;
  private autoSeq = 0;
  // Session-scoped user registries. Templates/scenes defined via the MCP
  // `define_user_template`, `define_scene`, and `import_scene` tools live
  // here instead of the process-global compose REGISTRY so two MCP sessions
  // on the same backend never see each other's mutations (M4 — SaaS blocker).
  // Built-ins and editor library_index entries continue to live on the
  // process-global registry and are visible as a read-only fallback via the
  // expansion functions' existing `options.{templates,scenes}` precedence.
  private readonly userTemplates = new Map<string, TemplateDefinition>();
  private readonly userScenes = new Map<string, SceneDefinition>();
  // Session-scoped behavior descriptors registered via `define_user_behavior`.
  // Descriptor-only — `apply_behavior` will throw E_BEHAVIOR_UNKNOWN because
  // user-defined expansion is not supported (mirrors `compose.registerBehavior`
  // semantics). These appear alongside built-ins in `list_behaviors`.
  private readonly userBehaviors = new Map<string, BehaviorDescriptor>();

  // ──────────────── Composition lifecycle ────────────────

  createComposition(input: CreateCompositionInput): string {
    const id = input.id ?? this.nextCompositionId();
    if (this.compositions.has(id)) {
      throw new MCPToolError(
        "E_DUPLICATE_ID",
        `Composition id "${id}" already exists.`,
        "Pass a different id, or call reset({ compositionId }) first.",
      );
    }
    const meta: CompositionMeta = {
      width: input.width,
      height: input.height,
      fps: input.fps,
      duration: input.duration,
      background: input.background ?? DEFAULT_BACKGROUND,
    };
    const comp: MutableComposition = {
      id,
      meta,
      assets: new Map(),
      layers: new Map(),
      items: new Map(),
      itemLayer: new Map(),
      tweens: new Map(),
      audio: new Map(),
      sceneInstances: new Map(),
      nextSeq: { layer: 0, item: 0, tween: 0, comp: 0, scene: 0, audio: 0 },
    };
    this.compositions.set(id, comp);
    if (this.defaultId === null) this.defaultId = id;
    return id;
  }

  reset(compositionId?: string): void {
    if (compositionId !== undefined) {
      this.compositions.delete(compositionId);
      if (this.defaultId === compositionId) {
        this.defaultId = this.compositions.keys().next().value ?? null;
      }
      return;
    }
    this.compositions.clear();
    this.defaultId = null;
    this.autoSeq = 0;
  }

  hasComposition(compositionId?: string): boolean {
    const id = compositionId ?? this.defaultId;
    return id !== null && this.compositions.has(id);
  }

  getDefaultId(): string | null {
    return this.defaultId;
  }

  setMetaProperty(
    property: SetMetaPropertyName,
    value: unknown,
    compositionId?: string,
  ): void {
    const comp = this.requireComposition(compositionId);
    switch (property) {
      case "width":
      case "height":
        ensurePositiveInt(property, value);
        comp.meta = { ...comp.meta, [property]: value as number };
        return;
      case "fps":
        ensurePositive(property, value);
        comp.meta = { ...comp.meta, fps: value as number };
        return;
      case "duration":
        ensureNonNegative(property, value);
        comp.meta = { ...comp.meta, duration: value as number };
        return;
      case "background":
        if (typeof value !== "string" || value.length === 0) {
          throw new MCPToolError(
            "E_INVALID_VALUE",
            `composition.background must be a non-empty string.`,
            'Use a hex string like "#000000".',
          );
        }
        comp.meta = { ...comp.meta, background: value };
        return;
      default: {
        const _exhaustive: never = property;
        void _exhaustive;
        throw new MCPToolError(
          "E_INVALID_VALUE",
          `Unknown composition property "${String(property)}".`,
        );
      }
    }
  }

  validate(compositionId?: string): ValidationResult {
    const json = this.toJSON(compositionId);
    return validate(json);
  }

  toJSON(compositionId?: string): Composition {
    const comp = this.requireComposition(compositionId);
    const audio = Array.from(comp.audio.values()).map(cloneAudioTrack);
    return {
      version: COMPOSITION_VERSION,
      composition: { ...comp.meta },
      assets: Array.from(comp.assets.values()).map(cloneAsset),
      layers: Array.from(comp.layers.values()).map(cloneLayer),
      items: Object.fromEntries(
        Array.from(comp.items.entries()).map(([id, item]) => [id, cloneItem(item)]),
      ),
      tweens: Array.from(comp.tweens.values()).map(cloneTween),
      // Emit `audio` only when there's at least one track so pre-v0.2 projects
      // (and every composition that never touched audio) serialise byte-for-byte
      // as before — the schema keeps `audio` optional for exactly this reason.
      ...(audio.length > 0 ? { audio } : {}),
    };
  }

  // ──────────────── Assets ────────────────

  registerAsset(input: RegisterAssetInput, compositionId?: string): void {
    const comp = this.requireComposition(compositionId);
    if (!input.id || input.id.length === 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "Asset id must be a non-empty string.",
        "Pass a stable string id (used later by add_sprite/add_text and remove_asset).",
      );
    }
    if (comp.assets.has(input.id)) {
      throw new MCPToolError(
        "E_DUPLICATE_ID",
        `Asset id "${input.id}" already registered.`,
        "Use remove_asset first if you want to replace it.",
      );
    }
    if (input.type === "image") {
      comp.assets.set(input.id, { id: input.id, type: "image", src: input.src });
    } else if (input.type === "font") {
      if (!input.family || input.family.length === 0) {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          'Font assets require a non-empty "family".',
        );
      }
      comp.assets.set(input.id, {
        id: input.id,
        type: "font",
        src: input.src,
        family: input.family,
      });
    } else if (input.type === "audio") {
      if (!isSupportedAudioSrc(input.src)) {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          `Audio asset "${input.id}" has unsupported src "${input.src}".`,
          `Audio sources must end with one of: ${AUDIO_ASSET_EXTENSIONS.join(", ")}.`,
        );
      }
      // Only persist metadata fields that were actually resolved — leaving them
      // absent (rather than undefined) keeps the serialised JSON clean and
      // mirrors how an asset registered without ffprobe looks.
      comp.assets.set(input.id, {
        id: input.id,
        type: "audio",
        src: input.src,
        ...(input.duration !== undefined ? { duration: input.duration } : {}),
        ...(input.sampleRate !== undefined ? { sampleRate: input.sampleRate } : {}),
        ...(input.channels !== undefined ? { channels: input.channels } : {}),
        ...(input.codec !== undefined ? { codec: input.codec } : {}),
      });
    } else if (input.type === "video") {
      if (!isSupportedVideoSrc(input.src)) {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          `Video asset "${input.id}" has unsupported src "${input.src}".`,
          `Video sources must end with one of: ${VIDEO_ASSET_EXTENSIONS.join(", ")}.`,
        );
      }
      // As with audio: only persist metadata fields that were actually
      // resolved, so an asset registered without ffprobe serialises clean.
      comp.assets.set(input.id, {
        id: input.id,
        type: "video",
        src: input.src,
        ...(input.duration !== undefined ? { duration: input.duration } : {}),
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.height !== undefined ? { height: input.height } : {}),
        ...(input.fps !== undefined ? { fps: input.fps } : {}),
        ...(input.hasAlpha !== undefined ? { hasAlpha: input.hasAlpha } : {}),
        ...(input.codec !== undefined ? { codec: input.codec } : {}),
        ...(input.pixelFormat !== undefined ? { pixelFormat: input.pixelFormat } : {}),
      });
    } else {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Unknown asset type "${String((input as { type: unknown }).type)}".`,
        'Expected "image", "font", "audio", or "video".',
      );
    }
  }

  listAssets(compositionId?: string): Asset[] {
    const comp = this.requireComposition(compositionId);
    return Array.from(comp.assets.values()).map(cloneAsset);
  }

  removeAsset(assetId: string, compositionId?: string): void {
    const comp = this.requireComposition(compositionId);
    if (!comp.assets.has(assetId)) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No asset "${assetId}".`,
        "Call list_assets to see registered asset ids.",
      );
    }
    for (const [itemId, item] of comp.items) {
      if (item.type === "sprite" && item.asset === assetId) {
        throw new MCPToolError(
          "E_ASSET_IN_USE",
          `Asset "${assetId}" is used by sprite "${itemId}".`,
          "Remove or reassign the item before removing the asset.",
        );
      }
      if (item.type === "text" && item.font === assetId) {
        throw new MCPToolError(
          "E_ASSET_IN_USE",
          `Asset "${assetId}" is used as font by text "${itemId}".`,
          "Remove or reassign the item before removing the asset.",
        );
      }
      if (item.type === "video" && item.asset === assetId) {
        throw new MCPToolError(
          "E_ASSET_IN_USE",
          `Asset "${assetId}" is used by video "${itemId}".`,
          "Remove or reassign the item before removing the asset.",
        );
      }
    }
    for (const [trackId, track] of comp.audio) {
      if (track.asset === assetId) {
        throw new MCPToolError(
          "E_ASSET_IN_USE",
          `Asset "${assetId}" is used by audio track "${trackId}".`,
          "Remove the audio track (remove_audio_track) before removing the asset.",
        );
      }
    }
    comp.assets.delete(assetId);
  }

  // ──────────────── Layers ────────────────

  addLayer(input: AddLayerInput, compositionId?: string): string {
    const comp = this.requireComposition(compositionId);
    const id = input.id ?? this.nextLayerId(comp);
    if (comp.layers.has(id)) {
      throw new MCPToolError(
        "E_DUPLICATE_ID",
        `Layer id "${id}" already exists.`,
        "Pick a different id, or omit `id` to let the store auto-assign.",
      );
    }
    const opacity = input.opacity ?? DEFAULT_OPACITY;
    ensureUnitInterval("opacity", opacity);
    comp.layers.set(id, {
      id,
      z: input.z,
      opacity,
      blendMode: input.blendMode ?? DEFAULT_BLEND_MODE,
      items: [],
      ...(input.visible !== undefined ? { visible: input.visible } : {}),
      ...(input.locked !== undefined ? { locked: input.locked } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
    });
    return id;
  }

  updateLayer(
    id: string,
    props: UpdateLayerProps,
    compositionId?: string,
  ): void {
    const comp = this.requireComposition(compositionId);
    const layer = comp.layers.get(id);
    if (!layer) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No layer "${id}".`,
        "Inspect get_composition().layers to see existing layer ids, or call add_layer first.",
      );
    }
    const next: Layer = { ...layer };
    if (props.z !== undefined) next.z = props.z;
    if (props.opacity !== undefined) {
      ensureUnitInterval("opacity", props.opacity);
      next.opacity = props.opacity;
    }
    if (props.blendMode !== undefined) next.blendMode = props.blendMode;
    if (props.visible !== undefined) next.visible = props.visible;
    if (props.locked !== undefined) next.locked = props.locked;
    if (props.name !== undefined) next.name = props.name;
    if (props.enter !== undefined) {
      ensureNonNegative("enter", props.enter);
      next.enter = props.enter;
    }
    if (props.exit !== undefined) {
      ensurePositive("exit", props.exit);
      next.exit = props.exit;
    }
    comp.layers.set(id, next);
  }

  removeLayer(
    id: string,
    cascade: boolean,
    compositionId?: string,
  ): void {
    const comp = this.requireComposition(compositionId);
    const layer = comp.layers.get(id);
    if (!layer) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No layer "${id}".`,
        "Inspect get_composition().layers to see existing layer ids.",
      );
    }
    if (layer.items.length > 0 && !cascade) {
      throw new MCPToolError(
        "E_LAYER_NOT_EMPTY",
        `Layer "${id}" has ${layer.items.length} item(s).`,
        "Pass cascade=true to remove items (and their tweens) too.",
      );
    }
    if (cascade) {
      for (const itemId of [...layer.items]) {
        this.removeItemImpl(comp, itemId);
      }
    }
    comp.layers.delete(id);
  }

  // ──────────────── Items ────────────────

  addSprite(input: AddSpriteInput, compositionId?: string): string {
    const comp = this.requireComposition(compositionId);
    const layer = this.requireLayer(comp, input.layerId);
    const id = input.id ?? this.nextItemId(comp);
    this.ensureNoItem(comp, id);
    const transform: Transform = {
      ...DEFAULT_TRANSFORM,
      x: input.x,
      y: input.y,
      scaleX: input.scaleX ?? DEFAULT_TRANSFORM.scaleX,
      scaleY: input.scaleY ?? DEFAULT_TRANSFORM.scaleY,
      rotation: input.rotation ?? DEFAULT_TRANSFORM.rotation,
      anchorX: input.anchorX ?? DEFAULT_TRANSFORM.anchorX,
      anchorY: input.anchorY ?? DEFAULT_TRANSFORM.anchorY,
      opacity: input.opacity ?? DEFAULT_TRANSFORM.opacity,
    };
    ensureUnitInterval("opacity", transform.opacity);
    const sprite: SpriteItem = {
      type: "sprite",
      asset: input.asset,
      width: input.width,
      height: input.height,
      transform,
      ...(input.tint !== undefined ? { tint: input.tint } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
    };
    comp.items.set(id, sprite);
    comp.itemLayer.set(id, layer.id);
    pushUnique(layer.items, id);
    return id;
  }

  addText(input: AddTextInput, compositionId?: string): string {
    const comp = this.requireComposition(compositionId);
    const layer = this.requireLayer(comp, input.layerId);
    const id = input.id ?? this.nextItemId(comp);
    this.ensureNoItem(comp, id);
    const transform: Transform = {
      ...DEFAULT_TRANSFORM,
      x: input.x,
      y: input.y,
      rotation: input.rotation ?? DEFAULT_TRANSFORM.rotation,
      anchorX: input.anchorX ?? DEFAULT_TRANSFORM.anchorX,
      anchorY: input.anchorY ?? DEFAULT_TRANSFORM.anchorY,
      opacity: input.opacity ?? DEFAULT_TRANSFORM.opacity,
    };
    ensureUnitInterval("opacity", transform.opacity);
    const text: TextItem = {
      type: "text",
      text: input.text,
      font: input.font,
      fontSize: input.fontSize,
      color: input.color,
      transform,
      ...(input.align !== undefined ? { align: input.align } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
    };
    comp.items.set(id, text);
    comp.itemLayer.set(id, layer.id);
    pushUnique(layer.items, id);
    return id;
  }

  addShape(input: AddShapeInput, compositionId?: string): string {
    const comp = this.requireComposition(compositionId);
    const layer = this.requireLayer(comp, input.layerId);
    const id = input.id ?? this.nextItemId(comp);
    this.ensureNoItem(comp, id);
    const transform: Transform = {
      ...DEFAULT_TRANSFORM,
      x: input.x,
      y: input.y,
      rotation: input.rotation ?? DEFAULT_TRANSFORM.rotation,
      anchorX: input.anchorX ?? DEFAULT_TRANSFORM.anchorX,
      anchorY: input.anchorY ?? DEFAULT_TRANSFORM.anchorY,
      opacity: input.opacity ?? DEFAULT_TRANSFORM.opacity,
    };
    ensureUnitInterval("opacity", transform.opacity);
    const shape: ShapeItem = {
      type: "shape",
      kind: input.kind,
      transform,
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      ...(input.points !== undefined
        ? { points: input.points.map((p) => [p[0], p[1]] as [number, number]) }
        : {}),
      ...(input.fillColor !== undefined ? { fillColor: input.fillColor } : {}),
      ...(input.strokeColor !== undefined ? { strokeColor: input.strokeColor } : {}),
      ...(input.strokeWidth !== undefined ? { strokeWidth: input.strokeWidth } : {}),
      ...(input.cornerRadius !== undefined ? { cornerRadius: input.cornerRadius } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
    };
    comp.items.set(id, shape);
    comp.itemLayer.set(id, layer.id);
    pushUnique(layer.items, id);
    return id;
  }

  addGroup(input: AddGroupInput, compositionId?: string): string {
    const comp = this.requireComposition(compositionId);
    const layer = this.requireLayer(comp, input.layerId);
    const id = input.id ?? this.nextItemId(comp);
    this.ensureNoItem(comp, id);
    const childIds = input.childItemIds ?? [];
    // Validate every child up front so we never half-build a group that
    // references a phantom id (which would otherwise only surface later via
    // validate() as E_ITEM_MISSING).
    for (const cid of childIds) {
      if (cid === id) {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          `Group "${id}" cannot list itself as a child.`,
        );
      }
      if (!comp.items.has(cid)) {
        throw new MCPToolError(
          "E_NOT_FOUND",
          `add_group child item "${cid}" not found.`,
          "Inspect get_composition().items for existing item ids.",
        );
      }
    }
    const transform: Transform = {
      ...DEFAULT_TRANSFORM,
      x: input.x,
      y: input.y,
      scaleX: input.scaleX ?? DEFAULT_TRANSFORM.scaleX,
      scaleY: input.scaleY ?? DEFAULT_TRANSFORM.scaleY,
      rotation: input.rotation ?? DEFAULT_TRANSFORM.rotation,
      anchorX: input.anchorX ?? DEFAULT_TRANSFORM.anchorX,
      anchorY: input.anchorY ?? DEFAULT_TRANSFORM.anchorY,
      opacity: input.opacity ?? DEFAULT_TRANSFORM.opacity,
    };
    ensureUnitInterval("opacity", transform.opacity);
    const group: GroupItem = {
      type: "group",
      items: [...childIds],
      transform,
      ...(input.name !== undefined ? { name: input.name } : {}),
    };
    comp.items.set(id, group);
    comp.itemLayer.set(id, layer.id);
    pushUnique(layer.items, id);
    // Detach each child from anywhere else that references it: layer.items
    // (so the renderer doesn't draw it twice — once at the layer root and
    // once through the new group's children) and any other group.items (so
    // re-grouping moves it cleanly between groups instead of duplicating).
    // `itemLayer` is updated to point at the new group's layer so future
    // remove/move operations have an authoritative source-layer to peel off.
    for (const cid of childIds) {
      for (const otherLayer of comp.layers.values()) {
        if (otherLayer.items.includes(cid)) {
          otherLayer.items = otherLayer.items.filter((x) => x !== cid);
        }
      }
      for (const [otherId, other] of comp.items) {
        if (otherId === id || otherId === cid) continue;
        if (other.type === "group" && other.items.includes(cid)) {
          comp.items.set(otherId, {
            ...other,
            items: other.items.filter((x) => x !== cid),
          });
        }
      }
      comp.itemLayer.set(cid, layer.id);
    }
    return id;
  }

  // ──────────────── Video items (§S9) ────────────────

  addVideo(input: AddVideoInput, compositionId?: string): AddVideoResult {
    const comp = this.requireComposition(compositionId);
    const layer =
      input.layerId !== undefined
        ? this.requireLayer(comp, input.layerId)
        : this.requireTopmostLayer(comp);
    const asset = this.requireVideoAsset(comp, input.asset);

    const start = input.start ?? 0;
    // Box defaults to the composition frame so a dropped clip fills it (with
    // fit=contain it letterboxes, never overflows) even when the asset was
    // registered without ffprobe metadata.
    const width = input.width ?? comp.meta.width;
    const height = input.height ?? comp.meta.height;
    validateVideoFields(
      {
        start,
        end: input.end,
        trimIn: input.trimIn,
        trimOut: input.trimOut,
        width,
        height,
      },
      asset,
    );

    const id = input.id ?? this.nextItemId(comp);
    this.ensureNoItem(comp, id);

    const transform: Transform = {
      ...DEFAULT_TRANSFORM,
      x: input.x,
      y: input.y,
      scaleX: input.scaleX ?? DEFAULT_TRANSFORM.scaleX,
      scaleY: input.scaleY ?? DEFAULT_TRANSFORM.scaleY,
      rotation: input.rotation ?? DEFAULT_TRANSFORM.rotation,
      anchorX: input.anchorX ?? DEFAULT_TRANSFORM.anchorX,
      anchorY: input.anchorY ?? DEFAULT_TRANSFORM.anchorY,
      opacity: input.opacity ?? DEFAULT_TRANSFORM.opacity,
    };
    ensureUnitInterval("opacity", transform.opacity);

    const video: VideoItem = {
      type: "video",
      asset: input.asset,
      width,
      height,
      start,
      fit: input.fit ?? "contain",
      loop: input.loop ?? false,
      transform,
      ...(input.end !== undefined ? { end: input.end } : {}),
      ...(input.trimIn !== undefined ? { trimIn: input.trimIn } : {}),
      ...(input.trimOut !== undefined ? { trimOut: input.trimOut } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
    };
    comp.items.set(id, video);
    comp.itemLayer.set(id, layer.id);
    pushUnique(layer.items, id);
    return { itemId: id, warnings: videoPlacementWarnings(comp, video, asset) };
  }

  updateVideo(
    id: string,
    props: UpdateVideoProps,
    compositionId?: string,
  ): VideoMutationResult {
    const comp = this.requireComposition(compositionId);
    const existing = comp.items.get(id);
    if (!existing) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No item "${id}".`,
        "Inspect get_composition().items for existing item ids, or add_video first.",
      );
    }
    if (existing.type !== "video") {
      throw new MCPToolError(
        "E_INVALID_PROPERTY",
        `Item "${id}" is type "${existing.type}", not "video".`,
        "update_video only patches video items; use update_item for other types.",
      );
    }

    const assetId = props.asset ?? existing.asset;
    const asset = this.requireVideoAsset(comp, assetId);

    const transform = { ...existing.transform };
    if (props.x !== undefined) transform.x = props.x;
    if (props.y !== undefined) transform.y = props.y;
    if (props.scaleX !== undefined) transform.scaleX = props.scaleX;
    if (props.scaleY !== undefined) transform.scaleY = props.scaleY;
    if (props.rotation !== undefined) transform.rotation = props.rotation;
    if (props.anchorX !== undefined) transform.anchorX = props.anchorX;
    if (props.anchorY !== undefined) transform.anchorY = props.anchorY;
    if (props.opacity !== undefined) {
      ensureUnitInterval("opacity", props.opacity);
      transform.opacity = props.opacity;
    }

    const width = props.width ?? existing.width;
    const height = props.height ?? existing.height;
    const start = props.start ?? existing.start;
    const end = props.end ?? existing.end;
    const trimIn = props.trimIn ?? existing.trimIn;
    const trimOut = props.trimOut ?? existing.trimOut;
    validateVideoFields({ start, end, trimIn, trimOut, width, height }, asset);

    if (props.enter !== undefined) ensureNonNegative("enter", props.enter);
    if (props.exit !== undefined) ensurePositive("exit", props.exit);

    // §M flags + §P label + lifespan: patch wins, otherwise keep existing.
    const visible = props.visible ?? existing.visible;
    const locked = props.locked ?? existing.locked;
    const name = props.name ?? existing.name;
    const enter = props.enter ?? existing.enter;
    const exit = props.exit ?? existing.exit;

    const updated: VideoItem = {
      type: "video",
      asset: assetId,
      width,
      height,
      start,
      fit: props.fit ?? existing.fit,
      loop: props.loop ?? existing.loop,
      transform,
      ...(end !== undefined ? { end } : {}),
      ...(trimIn !== undefined ? { trimIn } : {}),
      ...(trimOut !== undefined ? { trimOut } : {}),
      ...(visible !== undefined ? { visible } : {}),
      ...(locked !== undefined ? { locked } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(enter !== undefined ? { enter } : {}),
      ...(exit !== undefined ? { exit } : {}),
    };
    comp.items.set(id, updated);
    return { warnings: videoPlacementWarnings(comp, updated, asset) };
  }

  /**
   * Add a fully-formed canonical Item under an explicit id and layer. Bypasses
   * the type-specific input shapes used by `addSprite` / `addText` / etc.,
   * which deliberately omit fields like `transform.scaleX` for ergonomic
   * reasons. Template expansion needs the full transform fidelity, so it
   * routes through this entrypoint instead. Validates the item shape against
   * the canonical Zod schema.
   */
  addRawItem(
    input: { id: string; layerId: string; item: unknown },
    compositionId?: string,
  ): void {
    const comp = this.requireComposition(compositionId);
    const layer = this.requireLayer(comp, input.layerId);
    if (typeof input.id !== "string" || input.id.length === 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "Item id must be a non-empty string.",
        "Pass a stable string id; tweens and updates will reference it later.",
      );
    }
    this.ensureNoItem(comp, input.id);
    const parsed = ItemSchema.safeParse(input.item);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path?.join(".") ?? "";
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Item "${input.id}" has invalid shape${path ? ` at ${path}` : ""}: ${issue?.message ?? "schema mismatch"}.`,
      );
    }
    comp.items.set(input.id, parsed.data as Item);
    comp.itemLayer.set(input.id, layer.id);
    pushUnique(layer.items, input.id);
  }

  updateItem(id: string, props: UpdateItemProps, compositionId?: string): void {
    const comp = this.requireComposition(compositionId);
    const item = comp.items.get(id);
    if (!item)
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No item "${id}".`,
        "Inspect get_composition().items for existing item ids, or add_sprite/add_text/add_shape/add_group first.",
      );
    const next = applyItemUpdate(item, props);
    comp.items.set(id, next);
  }

  moveItemToLayer(
    itemId: string,
    targetLayerId: string,
    compositionId?: string,
  ): void {
    const comp = this.requireComposition(compositionId);
    if (!comp.items.has(itemId)) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No item "${itemId}".`,
        "Inspect get_composition().items for existing item ids.",
      );
    }
    const target = this.requireLayer(comp, targetLayerId);
    const sourceId = comp.itemLayer.get(itemId);
    if (sourceId !== undefined) {
      const source = comp.layers.get(sourceId);
      if (source) {
        source.items = source.items.filter((x) => x !== itemId);
      }
    }
    pushUnique(target.items, itemId);
    comp.itemLayer.set(itemId, target.id);
  }

  removeItem(id: string, compositionId?: string): void {
    const comp = this.requireComposition(compositionId);
    if (!comp.items.has(id)) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No item "${id}".`,
        "Inspect get_composition().items for existing item ids.",
      );
    }
    this.removeItemImpl(comp, id);
  }

  // ──────────────── Tweens ────────────────

  addTween(input: AddTweenInput, compositionId?: string): string {
    const comp = this.requireComposition(compositionId);
    const item = comp.items.get(input.target);
    if (!item) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `Tween target item "${input.target}" not found.`,
      );
    }
    const desc = getTweenable(item.type, input.property);
    if (!desc) {
      throw new MCPToolError(
        "E_INVALID_PROPERTY",
        `Property "${input.property}" is not tweenable on ${item.type}.`,
      );
    }
    if (desc.kind === "number") {
      if (typeof input.from !== "number" || typeof input.to !== "number") {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          `Property "${input.property}" expects numeric from/to.`,
        );
      }
    } else {
      if (typeof input.from !== "string" || typeof input.to !== "string") {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          `Property "${input.property}" expects color string from/to.`,
        );
      }
    }
    if (input.duration <= 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "Tween duration must be > 0.",
      );
    }
    if (input.start < 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "Tween start must be ≥ 0.",
      );
    }

    const id = input.id ?? this.nextTweenId(comp);
    if (comp.tweens.has(id)) {
      throw new MCPToolError(
        "E_DUPLICATE_ID",
        `Tween id "${id}" already exists.`,
        "Omit `id` to let the store auto-assign, or call remove_tween first to replace.",
      );
    }

    this.ensureNoOverlap(comp, input.target, input.property, input.start, input.duration, null);

    const tween: Tween = {
      id,
      target: input.target,
      property: input.property,
      from: input.from,
      to: input.to,
      start: input.start,
      duration: input.duration,
      ...(input.easing !== undefined ? { easing: input.easing } : {}),
    };
    comp.tweens.set(id, tween);
    return id;
  }

  updateTween(id: string, props: UpdateTweenProps, compositionId?: string): void {
    const comp = this.requireComposition(compositionId);
    const tween = comp.tweens.get(id);
    if (!tween)
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No tween "${id}".`,
        "Call list_tweens to see existing tween ids, or add_tween first.",
      );

    const target = props.target ?? tween.target;
    const property = props.property ?? tween.property;
    const start = props.start ?? tween.start;
    const duration = props.duration ?? tween.duration;
    const from = props.from ?? tween.from;
    const to = props.to ?? tween.to;
    const easing = props.easing ?? tween.easing;

    const item = comp.items.get(target);
    if (!item) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `Tween target item "${target}" not found.`,
      );
    }
    const desc = getTweenable(item.type, property);
    if (!desc) {
      throw new MCPToolError(
        "E_INVALID_PROPERTY",
        `Property "${property}" is not tweenable on ${item.type}.`,
      );
    }
    if (desc.kind === "number" && (typeof from !== "number" || typeof to !== "number")) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Property "${property}" expects numeric from/to.`,
      );
    }
    if (desc.kind === "color" && (typeof from !== "string" || typeof to !== "string")) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Property "${property}" expects color string from/to.`,
      );
    }
    if (duration <= 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "Tween duration must be > 0.",
        "Pass a positive number of seconds (e.g. duration: 0.5).",
      );
    }
    if (start < 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "Tween start must be ≥ 0.",
        "Pass a non-negative seconds offset from the composition start.",
      );
    }

    this.ensureNoOverlap(comp, target, property, start, duration, id);

    const updated: Tween = {
      id,
      target,
      property,
      from,
      to,
      start,
      duration,
      ...(easing !== undefined ? { easing } : {}),
    };
    comp.tweens.set(id, updated);
  }

  removeTween(id: string, compositionId?: string): void {
    const comp = this.requireComposition(compositionId);
    if (!comp.tweens.delete(id)) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No tween "${id}".`,
        "Call list_tweens to see existing tween ids.",
      );
    }
  }

  listTweens(filter: ListTweensFilter = {}, compositionId?: string): Tween[] {
    const comp = this.requireComposition(compositionId);
    const out: Tween[] = [];
    for (const tween of comp.tweens.values()) {
      if (filter.target !== undefined && tween.target !== filter.target) continue;
      if (filter.property !== undefined && tween.property !== filter.property) continue;
      out.push(cloneTween(tween));
    }
    return out;
  }

  // ──────────────── Audio tracks (§S3) ────────────────

  addAudioTrack(
    input: AddAudioTrackInput,
    compositionId?: string,
  ): AddAudioTrackResult {
    const comp = this.requireComposition(compositionId);
    const asset = this.requireAudioAsset(comp, input.asset);
    validateAudioFields(input);

    const id = input.id ?? this.nextAudioTrackId(comp);
    if (comp.audio.has(id)) {
      throw new MCPToolError(
        "E_DUPLICATE_ID",
        `Audio track id "${id}" already exists.`,
        "Omit `id` to let the store auto-assign, or call remove_audio_track first to replace.",
      );
    }

    const track: AudioTrack = {
      id,
      asset: input.asset,
      start: input.start,
      ...(input.end !== undefined ? { end: input.end } : {}),
      ...(input.volume !== undefined ? { volume: input.volume } : {}),
      ...(input.fadeIn !== undefined ? { fadeIn: input.fadeIn } : {}),
      ...(input.fadeOut !== undefined ? { fadeOut: input.fadeOut } : {}),
    };
    comp.audio.set(id, track);
    return { id, warnings: audioPlacementWarnings(comp, track, asset) };
  }

  updateAudioTrack(
    id: string,
    props: UpdateAudioTrackProps,
    compositionId?: string,
  ): AudioTrackMutationResult {
    const comp = this.requireComposition(compositionId);
    const existing = comp.audio.get(id);
    if (!existing) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No audio track "${id}".`,
        "Call list_audio_tracks to see existing audio track ids, or add_audio_track first.",
      );
    }

    const assetId = props.asset ?? existing.asset;
    const asset = this.requireAudioAsset(comp, assetId);
    const merged = {
      asset: assetId,
      start: props.start ?? existing.start,
      end: props.end ?? existing.end,
      volume: props.volume ?? existing.volume,
      fadeIn: props.fadeIn ?? existing.fadeIn,
      fadeOut: props.fadeOut ?? existing.fadeOut,
    };
    validateAudioFields(merged);

    const updated: AudioTrack = {
      id,
      asset: merged.asset,
      start: merged.start,
      ...(merged.end !== undefined ? { end: merged.end } : {}),
      ...(merged.volume !== undefined ? { volume: merged.volume } : {}),
      ...(merged.fadeIn !== undefined ? { fadeIn: merged.fadeIn } : {}),
      ...(merged.fadeOut !== undefined ? { fadeOut: merged.fadeOut } : {}),
    };
    comp.audio.set(id, updated);
    return { warnings: audioPlacementWarnings(comp, updated, asset) };
  }

  removeAudioTrack(id: string, compositionId?: string): void {
    const comp = this.requireComposition(compositionId);
    if (!comp.audio.delete(id)) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No audio track "${id}".`,
        "Call list_audio_tracks to see existing audio track ids.",
      );
    }
  }

  listAudioTracks(
    filter: ListAudioTracksFilter = {},
    compositionId?: string,
  ): AudioTrack[] {
    const comp = this.requireComposition(compositionId);
    const out: AudioTrack[] = [];
    for (const track of comp.audio.values()) {
      if (filter.asset !== undefined && track.asset !== filter.asset) continue;
      out.push(cloneAudioTrack(track));
    }
    return out;
  }

  /**
   * Add an audio track from a fully-formed object (used by editor hydration in
   * apply_command's hydrateStore). Lenient on the asset reference — the schema
   * intentionally lets a track name an asset that isn't registered yet (S1), so
   * a composition that came off disk hydrates without the asset-existence check
   * that `addAudioTrack` enforces for fresh MCP calls. Assigns an id when the
   * loaded track omits one.
   */
  addRawAudioTrack(track: AudioTrack, compositionId?: string): void {
    const comp = this.requireComposition(compositionId);
    const id = track.id ?? this.nextAudioTrackId(comp);
    if (comp.audio.has(id)) {
      throw new MCPToolError(
        "E_DUPLICATE_ID",
        `Audio track id "${id}" already exists.`,
        "Pick a different id, or remove_audio_track the existing one first.",
      );
    }
    comp.audio.set(id, cloneAudioTrack({ ...track, id }));
  }

  /** Require an asset that exists AND is type "audio"; the shared add/update guard. */
  private requireAudioAsset(comp: MutableComposition, assetId: string): Asset {
    const asset = comp.assets.get(assetId);
    if (!asset) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `Audio track references unknown asset "${assetId}".`,
        "Register it first with register_asset({ type: 'audio' }); list_assets shows registered ids.",
      );
    }
    if (asset.type !== "audio") {
      throw new MCPToolError(
        "E_ASSET_TYPE_MISMATCH",
        `Asset "${assetId}" is type "${asset.type}", not "audio".`,
        "Audio tracks can only reference assets registered with type 'audio'.",
      );
    }
    return asset;
  }

  /** Require an asset that exists AND is type "video"; the add_video/update_video guard. */
  private requireVideoAsset(comp: MutableComposition, assetId: string): Asset {
    const asset = comp.assets.get(assetId);
    if (!asset) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `Video item references unknown asset "${assetId}".`,
        "Register it first with register_asset({ type: 'video' }); list_assets shows registered ids.",
      );
    }
    if (asset.type !== "video") {
      throw new MCPToolError(
        "E_ASSET_TYPE_MISMATCH",
        `Asset "${assetId}" is type "${asset.type}", not "video".`,
        "Video items can only reference assets registered with type 'video'.",
      );
    }
    return asset;
  }

  /**
   * The layer a video lands on when add_video omits `layerId`: highest z wins,
   * ties broken by most-recent insertion (Map order). Errors when the
   * composition has no layers yet.
   */
  private requireTopmostLayer(comp: MutableComposition): Layer {
    let top: Layer | undefined;
    for (const layer of comp.layers.values()) {
      if (top === undefined || layer.z >= top.z) top = layer;
    }
    if (top === undefined) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        "Composition has no layers to add the video to.",
        "Call add_layer first, or pass an explicit layerId.",
      );
    }
    return top;
  }

  // ──────────────── Scene instances ────────────────

  /**
   * Reserve a fresh scene-instance id. Used by `add_scene_instance` when the
   * caller doesn't supply one explicitly.
   */
  nextSceneInstanceId(compositionId?: string): string {
    const comp = this.requireComposition(compositionId);
    let candidate: string;
    do {
      candidate = `scene-${++comp.nextSeq.scene}`;
    } while (comp.items.has(candidate));
    return candidate;
  }

  /**
   * Register a scene-instance expansion result against the store. Caller is
   * responsible for actually adding the items/tweens/assets via the regular
   * mutation primitives — this tracker just remembers the bookkeeping so a
   * later update / remove can roll back exactly those ids.
   */
  trackSceneInstance(
    instanceId: string,
    record: SceneInstanceRecord,
    compositionId?: string,
  ): void {
    const comp = this.requireComposition(compositionId);
    if (comp.sceneInstances.has(instanceId)) {
      throw new MCPToolError(
        "E_DUPLICATE_ID",
        `Scene instance "${instanceId}" already tracked.`,
      );
    }
    comp.sceneInstances.set(instanceId, record);
  }

  hasSceneInstance(instanceId: string, compositionId?: string): boolean {
    const comp = this.requireComposition(compositionId);
    return comp.sceneInstances.has(instanceId);
  }

  getSceneInstance(
    instanceId: string,
    compositionId?: string,
  ): SceneInstanceRecord | undefined {
    const comp = this.requireComposition(compositionId);
    return comp.sceneInstances.get(instanceId);
  }

  /**
   * Drop everything a prior `trackSceneInstance` call added: tweens first
   * (they reference items), then items (a group's children are dropped via
   * normal `removeItemImpl`), then any assets the instance contributed
   * exclusively. Best-effort — every removal is wrapped in a try/catch so a
   * partially-rolled-back state doesn't trap subsequent calls.
   */
  removeSceneInstance(instanceId: string, compositionId?: string): void {
    const comp = this.requireComposition(compositionId);
    const record = comp.sceneInstances.get(instanceId);
    if (!record) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No scene instance "${instanceId}" to remove.`,
      );
    }
    for (const tid of record.tweenIds) {
      comp.tweens.delete(tid);
    }
    for (const iid of record.itemIds) {
      if (comp.items.has(iid)) {
        try {
          this.removeItemImpl(comp, iid);
        } catch {
          /* best-effort */
        }
      }
    }
    for (const aid of record.assetIds) {
      // Drop only if no item references the asset (e.g. concurrent additions
      // by other tools may pin it). The protective check matches removeAsset.
      if (!comp.assets.has(aid)) continue;
      let inUse = false;
      for (const item of comp.items.values()) {
        if (item.type === "sprite" && item.asset === aid) {
          inUse = true;
          break;
        }
        if (item.type === "text" && item.font === aid) {
          inUse = true;
          break;
        }
      }
      if (!inUse) comp.assets.delete(aid);
    }
    comp.sceneInstances.delete(instanceId);
  }

  /**
   * Append an asset that's already known to be unique-by-id+content. Used by
   * scene-instance expansion which validates conflicts upstream.
   */
  registerAssetUnchecked(asset: Asset, compositionId?: string): void {
    const comp = this.requireComposition(compositionId);
    if (comp.assets.has(asset.id)) {
      // Already merged by an earlier instance; skip to keep dedupe behavior.
      return;
    }
    comp.assets.set(asset.id, cloneAsset(asset));
  }

  /**
   * Read-only access to the asset map keyed by id — used by scene-instance
   * expansion to detect existing conflicts.
   */
  getAsset(id: string, compositionId?: string): Asset | undefined {
    const comp = this.requireComposition(compositionId);
    return comp.assets.get(id);
  }

  /**
   * Add a fully-formed canonical Item under an explicit id WITHOUT placing it
   * in any layer. Used by scene-instance expansion for inner items that are
   * referenced through the synthetic group wrapper instead of a layer's
   * `items` list. Validates the item shape against the canonical Zod schema.
   */
  addRawSubItem(
    input: { id: string; item: unknown },
    compositionId?: string,
  ): void {
    const comp = this.requireComposition(compositionId);
    if (typeof input.id !== "string" || input.id.length === 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "Item id must be a non-empty string.",
        "Pass a stable string id; tweens and updates will reference it later.",
      );
    }
    this.ensureNoItem(comp, input.id);
    const parsed = ItemSchema.safeParse(input.item);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path?.join(".") ?? "";
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Item "${input.id}" has invalid shape${path ? ` at ${path}` : ""}: ${issue?.message ?? "schema mismatch"}.`,
      );
    }
    comp.items.set(input.id, parsed.data as Item);
  }

  /** Required for scene-instance handlers that need to add a fully-formed wrapper group with explicit transform + child ids. */
  addRawGroup(
    input: { id: string; layerId: string; childItemIds: ReadonlyArray<string>; transform: Transform },
    compositionId?: string,
  ): void {
    const comp = this.requireComposition(compositionId);
    const layer = this.requireLayer(comp, input.layerId);
    if (typeof input.id !== "string" || input.id.length === 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "Group id must be a non-empty string.",
        "Pass a stable string id (used later by add_tween targets and update_item).",
      );
    }
    this.ensureNoItem(comp, input.id);
    const group: GroupItem = {
      type: "group",
      items: [...input.childItemIds],
      transform: { ...input.transform },
    };
    comp.items.set(input.id, group);
    comp.itemLayer.set(input.id, layer.id);
    pushUnique(layer.items, input.id);
  }

  /** Add a tween from a fully-formed object (used by scene expansion). */
  addRawTween(tween: Tween, compositionId?: string): void {
    const comp = this.requireComposition(compositionId);
    if (comp.tweens.has(tween.id)) {
      throw new MCPToolError(
        "E_DUPLICATE_ID",
        `Tween id "${tween.id}" already exists.`,
        "Pick a different id, or remove_tween the existing one first.",
      );
    }
    const item = comp.items.get(tween.target);
    if (!item) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `Tween target item "${tween.target}" not found.`,
      );
    }
    const desc = getTweenable(item.type, tween.property);
    if (!desc) {
      throw new MCPToolError(
        "E_INVALID_PROPERTY",
        `Property "${tween.property}" is not tweenable on ${item.type}.`,
      );
    }
    if (desc.kind === "number" && (typeof tween.from !== "number" || typeof tween.to !== "number")) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Property "${tween.property}" expects numeric from/to.`,
      );
    }
    if (desc.kind === "color" && (typeof tween.from !== "string" || typeof tween.to !== "string")) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Property "${tween.property}" expects color string from/to.`,
      );
    }
    if (tween.duration <= 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "Tween duration must be > 0.",
        "Pass a positive number of seconds (e.g. duration: 0.5).",
      );
    }
    if (tween.start < 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "Tween start must be ≥ 0.",
        "Pass a non-negative seconds offset from the composition start.",
      );
    }
    this.ensureNoOverlap(
      comp,
      tween.target,
      tween.property,
      tween.start,
      tween.duration,
      null,
    );
    comp.tweens.set(tween.id, {
      id: tween.id,
      target: tween.target,
      property: tween.property,
      from: tween.from,
      to: tween.to,
      start: tween.start,
      duration: tween.duration,
      ...(tween.easing !== undefined ? { easing: tween.easing } : {}),
    });
  }

  // ──────────────── Session-scoped template / scene registries ────────────────

  setUserTemplate(def: TemplateDefinition): void {
    if (typeof def.id !== "string" || def.id.length === 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "Template definition must have a non-empty id.",
      );
    }
    this.userTemplates.set(def.id, def);
  }

  getUserTemplate(id: string): TemplateDefinition | undefined {
    return this.userTemplates.get(id);
  }

  hasUserTemplate(id: string): boolean {
    return this.userTemplates.has(id);
  }

  removeUserTemplate(id: string): boolean {
    return this.userTemplates.delete(id);
  }

  listUserTemplates(): TemplateDefinition[] {
    return Array.from(this.userTemplates.values());
  }

  /** Snapshot for `expandTemplate(options.templates)`. */
  userTemplateRecord(): Record<string, TemplateDefinition> {
    return Object.fromEntries(this.userTemplates);
  }

  setUserScene(def: SceneDefinition): void {
    if (typeof def.id !== "string" || def.id.length === 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "Scene definition must have a non-empty id.",
      );
    }
    this.userScenes.set(def.id, def);
  }

  getUserScene(id: string): SceneDefinition | undefined {
    return this.userScenes.get(id);
  }

  hasUserScene(id: string): boolean {
    return this.userScenes.has(id);
  }

  removeUserScene(id: string): boolean {
    return this.userScenes.delete(id);
  }

  listUserScenes(): SceneDefinition[] {
    return Array.from(this.userScenes.values());
  }

  /** Snapshot for `expandSceneInstance(options.scenes)`. */
  userSceneRecord(): Record<string, SceneDefinition> {
    return Object.fromEntries(this.userScenes);
  }

  setUserBehavior(descriptor: BehaviorDescriptor): void {
    if (typeof descriptor.name !== "string" || descriptor.name.length === 0) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "Behavior descriptor must have a non-empty name.",
      );
    }
    // Clone defensively so callers can't mutate the stored descriptor later.
    const cloned: BehaviorDescriptor = {
      name: descriptor.name,
      description: descriptor.description ?? "",
      params: descriptor.params.map((p) => ({ ...p })),
      produces:
        typeof descriptor.produces === "string"
          ? descriptor.produces
          : [...descriptor.produces],
    };
    this.userBehaviors.set(descriptor.name, cloned);
  }

  hasUserBehavior(name: string): boolean {
    return this.userBehaviors.has(name);
  }

  removeUserBehavior(name: string): boolean {
    return this.userBehaviors.delete(name);
  }

  listUserBehaviors(): BehaviorDescriptor[] {
    return Array.from(this.userBehaviors.values()).map((d) => ({
      name: d.name,
      description: d.description,
      params: d.params.map((p) => ({ ...p })),
      produces: typeof d.produces === "string" ? d.produces : [...d.produces],
    }));
  }

  // ──────────────── Internals ────────────────

  private requireComposition(compositionId?: string): MutableComposition {
    const id = compositionId ?? this.defaultId;
    if (id === null || id === undefined) {
      throw new MCPToolError(
        "E_NO_COMPOSITION",
        "No composition exists.",
        "Call create_composition first.",
      );
    }
    const comp = this.compositions.get(id);
    if (!comp) {
      throw new MCPToolError(
        "E_NO_COMPOSITION",
        `Composition "${id}" not found.`,
        "Call create_composition with this id, or omit compositionId to use the default.",
      );
    }
    return comp;
  }

  private requireLayer(comp: MutableComposition, layerId: string): Layer {
    const layer = comp.layers.get(layerId);
    if (!layer) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No layer "${layerId}".`,
        "Call add_layer to create it, or inspect get_composition().layers for existing layer ids.",
      );
    }
    return layer;
  }

  private ensureNoItem(comp: MutableComposition, id: string): void {
    if (comp.items.has(id)) {
      throw new MCPToolError(
        "E_DUPLICATE_ID",
        `Item id "${id}" already exists.`,
        "Pick a different id, omit `id` to let the store auto-assign, or remove_item first.",
      );
    }
  }

  private ensureNoOverlap(
    comp: MutableComposition,
    target: string,
    property: string,
    start: number,
    duration: number,
    ignoreId: string | null,
  ): void {
    const end = start + duration;
    for (const other of comp.tweens.values()) {
      if (ignoreId !== null && other.id === ignoreId) continue;
      if (other.target !== target || other.property !== property) continue;
      const oEnd = other.start + other.duration;
      // Strict overlap (touching at endpoints is OK; matches validator §3.5.5),
      // with the same OVERLAP_EPS tolerance the validator uses so mathematically
      // abutting windows survive chained `start + duration` FP drift (e.g.
      // 5.2 + 0.4 = 5.6000000000000005) instead of tripping E_TWEEN_OVERLAP.
      // Unlike the validator's adjacent-pair scan over a start-sorted bucket,
      // `other` here isn't guaranteed to start before the candidate, so the
      // comparison is written symmetrically via the shared overlap span.
      const overlapStart = Math.max(start, other.start);
      const overlapEnd = Math.min(end, oEnd);
      if (overlapStart + OVERLAP_EPS < overlapEnd) {
        throw new MCPToolError(
          "E_TWEEN_OVERLAP",
          `Tween overlaps "${other.id}" on ${target}.${property}: ` +
            `[${other.start}, ${oEnd}] vs [${start}, ${end}].`,
          "Adjust start/duration so the windows don't intersect, or remove the conflicting tween.",
        );
      }
    }
  }

  private removeItemImpl(comp: MutableComposition, id: string): void {
    const layerId = comp.itemLayer.get(id);
    if (layerId !== undefined) {
      const layer = comp.layers.get(layerId);
      if (layer) layer.items = layer.items.filter((x) => x !== id);
      comp.itemLayer.delete(id);
    }
    // Detach from any group that contains it as a child.
    for (const [otherId, other] of comp.items) {
      if (otherId === id) continue;
      if (other.type === "group") {
        const filtered = other.items.filter((x) => x !== id);
        if (filtered.length !== other.items.length) {
          comp.items.set(otherId, { ...other, items: filtered });
        }
      }
    }
    comp.items.delete(id);
    // Cascade: drop any tween targeting this item (per §4.4 remove_item).
    for (const [tid, tween] of comp.tweens) {
      if (tween.target === id) comp.tweens.delete(tid);
    }
  }

  private nextCompositionId(): string {
    return `comp-${++this.autoSeq}`;
  }

  private nextLayerId(comp: MutableComposition): string {
    let candidate: string;
    do {
      candidate = `layer-${++comp.nextSeq.layer}`;
    } while (comp.layers.has(candidate));
    return candidate;
  }

  private nextItemId(comp: MutableComposition): string {
    let candidate: string;
    do {
      candidate = `item-${++comp.nextSeq.item}`;
    } while (comp.items.has(candidate));
    return candidate;
  }

  private nextTweenId(comp: MutableComposition): string {
    let candidate: string;
    do {
      candidate = `tween-${++comp.nextSeq.tween}`;
    } while (comp.tweens.has(candidate));
    return candidate;
  }

  private nextAudioTrackId(comp: MutableComposition): string {
    let candidate: string;
    do {
      candidate = `audio-${++comp.nextSeq.audio}`;
    } while (comp.audio.has(candidate));
    return candidate;
  }
}

// ──────────────── Helpers ────────────────

function ensurePositive(name: string, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `${name} must be a positive number.`,
    );
  }
}

function ensurePositiveInt(name: string, value: unknown): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `${name} must be a positive integer.`,
    );
  }
}

function ensureNonNegative(name: string, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `${name} must be a non-negative number.`,
    );
  }
}

function ensureUnitInterval(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `${name} must be in [0, 1].`,
    );
  }
}

function pushUnique(arr: string[], value: string): void {
  if (arr.includes(value)) return;
  arr.push(value);
}

// Audio-track field rules (v0.2 §S1, enforced here at the store boundary too so
// direct callers and editor-hydrated updates get the same guarantees the Zod
// tool schema gives MCP clients). Shape-level rejection → E_INVALID_VALUE.
function validateAudioFields(t: {
  start: number;
  end?: number | undefined;
  volume?: number | undefined;
  fadeIn?: number | undefined;
  fadeOut?: number | undefined;
}): void {
  ensureNonNegative("Audio track start", t.start);
  if (t.end !== undefined && t.end <= t.start) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      "Audio track `end` must be greater than `start`.",
      "Omit `end` to play the asset out to its natural duration.",
    );
  }
  if (t.volume !== undefined && (!Number.isFinite(t.volume) || t.volume < 0 || t.volume > 2)) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      "Audio track volume must be in [0, 2].",
      "1 = unchanged, 0 = silent, 2 = +6dB.",
    );
  }
  if (t.fadeIn !== undefined) ensureNonNegative("Audio track fadeIn", t.fadeIn);
  if (t.fadeOut !== undefined) ensureNonNegative("Audio track fadeOut", t.fadeOut);
}

// Non-fatal placement check: a track that starts at/after the composition end,
// or whose end (explicit, or implied by the asset's natural duration) runs past
// it, is reported as a warning — never an error (plan Q6: trim at mux, don't
// reject the edit). 1µs epsilon absorbs float drift in `start + duration` sums.
const AUDIO_DURATION_EPS = 1e-6;

function audioPlacementWarnings(
  comp: MutableComposition,
  track: AudioTrack,
  asset: Asset,
): string[] {
  const warnings: string[] = [];
  const compDuration = comp.meta.duration;
  if (compDuration <= 0) return warnings;
  const label = `Audio track "${track.id ?? track.asset}"`;

  if (track.start >= compDuration) {
    warnings.push(
      `${label} starts at ${track.start}s, at or past the composition end (${compDuration}s); it will be silent.`,
    );
    return warnings;
  }

  const assetDuration =
    asset.type === "audio" ? asset.duration : undefined;
  const effectiveEnd =
    track.end ??
    (assetDuration !== undefined ? track.start + assetDuration : undefined);
  if (effectiveEnd !== undefined && effectiveEnd > compDuration + AUDIO_DURATION_EPS) {
    warnings.push(
      `${label} ends at ${effectiveEnd}s, past the composition end (${compDuration}s); it will be truncated at mux time.`,
    );
  }
  return warnings;
}

// Video field rules (v0.2 §S5/§S9), enforced at the store boundary so direct
// callers and editor-hydrated updates get the same guarantees the validator's
// E_VIDEO_RANGE pass gives loaded compositions. Shape-level rejection here is
// E_INVALID_VALUE (E_VIDEO_RANGE is a validator-only code). The asset is passed
// so the `trimOut ≤ duration` bound can be checked once the source is probed.
function validateVideoFields(
  t: {
    start: number;
    end?: number | undefined;
    trimIn?: number | undefined;
    trimOut?: number | undefined;
    width: number;
    height: number;
  },
  asset: Asset,
): void {
  ensureNonNegative("Video start", t.start);
  ensureNonNegative("Video width", t.width);
  ensureNonNegative("Video height", t.height);
  if (t.trimIn !== undefined) ensureNonNegative("Video trimIn", t.trimIn);
  if (t.trimOut !== undefined) ensurePositive("Video trimOut", t.trimOut);

  const trimIn = t.trimIn ?? 0;
  if (t.trimOut !== undefined && trimIn >= t.trimOut) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Video trim window is empty: trimIn (${trimIn}) must be less than trimOut (${t.trimOut}).`,
      "Widen the trim window so trimIn < trimOut.",
    );
  }
  if (t.trimOut !== undefined) {
    const duration = asset.type === "video" ? asset.duration : undefined;
    if (typeof duration === "number" && t.trimOut > duration) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Video trimOut (${t.trimOut}) exceeds the duration of asset "${asset.id}" (${duration}).`,
        "Lower trimOut to the asset duration or shorter.",
      );
    }
  }
  if (t.end !== undefined && t.end <= t.start) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `Video end (${t.end}) must be greater than start (${t.start}).`,
      "Omit `end` to let the trimmed source play out (then freeze/loop).",
    );
  }
}

// Non-fatal placement check mirroring audioPlacementWarnings: a clip that starts
// at/after the composition end, or whose explicit `end` runs past it, is a
// warning, not an error. (Without an explicit `end` the clip freezes/loops at
// the composition edge, so there is nothing to warn about.)
function videoPlacementWarnings(
  comp: MutableComposition,
  item: VideoItem,
  _asset: Asset,
): string[] {
  const warnings: string[] = [];
  const compDuration = comp.meta.duration;
  if (compDuration <= 0) return warnings;
  const label = `Video "${item.name ?? item.asset}"`;

  if (item.start >= compDuration) {
    warnings.push(
      `${label} starts at ${item.start}s, at or past the composition end (${compDuration}s); it will not be visible.`,
    );
    return warnings;
  }
  if (item.end !== undefined && item.end > compDuration + AUDIO_DURATION_EPS) {
    warnings.push(
      `${label} ends at ${item.end}s, past the composition end (${compDuration}s); it will be cut off at render time.`,
    );
  }
  return warnings;
}

function cloneAsset(asset: Asset): Asset {
  switch (asset.type) {
    case "image":
      return { id: asset.id, type: "image", src: asset.src };
    case "font":
      return { id: asset.id, type: "font", src: asset.src, family: asset.family };
    case "audio":
      return {
        id: asset.id,
        type: "audio",
        src: asset.src,
        ...(asset.duration !== undefined ? { duration: asset.duration } : {}),
        ...(asset.sampleRate !== undefined ? { sampleRate: asset.sampleRate } : {}),
        ...(asset.channels !== undefined ? { channels: asset.channels } : {}),
        ...(asset.codec !== undefined ? { codec: asset.codec } : {}),
      };
    case "video":
      return {
        id: asset.id,
        type: "video",
        src: asset.src,
        ...(asset.duration !== undefined ? { duration: asset.duration } : {}),
        ...(asset.width !== undefined ? { width: asset.width } : {}),
        ...(asset.height !== undefined ? { height: asset.height } : {}),
        ...(asset.fps !== undefined ? { fps: asset.fps } : {}),
        ...(asset.hasAlpha !== undefined ? { hasAlpha: asset.hasAlpha } : {}),
        ...(asset.codec !== undefined ? { codec: asset.codec } : {}),
        ...(asset.pixelFormat !== undefined ? { pixelFormat: asset.pixelFormat } : {}),
      };
  }
}

function cloneLayer(layer: Layer): Layer {
  return {
    id: layer.id,
    z: layer.z,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    items: [...layer.items],
    ...(layer.visible !== undefined ? { visible: layer.visible } : {}),
    ...(layer.locked !== undefined ? { locked: layer.locked } : {}),
    ...(layer.name !== undefined ? { name: layer.name } : {}),
    ...(layer.enter !== undefined ? { enter: layer.enter } : {}),
    ...(layer.exit !== undefined ? { exit: layer.exit } : {}),
  };
}

function cloneItem(item: Item): Item {
  // §M flags + lifespan propagate through every clone path so toJSON
  // round-trips them.
  const flags = {
    ...(item.visible !== undefined ? { visible: item.visible } : {}),
    ...(item.locked !== undefined ? { locked: item.locked } : {}),
    ...(item.enter !== undefined ? { enter: item.enter } : {}),
    ...(item.exit !== undefined ? { exit: item.exit } : {}),
  };
  switch (item.type) {
    case "sprite":
      return {
        type: "sprite",
        asset: item.asset,
        width: item.width,
        height: item.height,
        transform: { ...item.transform },
        ...(item.tint !== undefined ? { tint: item.tint } : {}),
        ...flags,
      };
    case "text":
      return {
        type: "text",
        text: item.text,
        font: item.font,
        fontSize: item.fontSize,
        color: item.color,
        transform: { ...item.transform },
        ...(item.align !== undefined ? { align: item.align } : {}),
        ...flags,
      };
    case "shape":
      return {
        type: "shape",
        kind: item.kind,
        transform: { ...item.transform },
        ...(item.width !== undefined ? { width: item.width } : {}),
        ...(item.height !== undefined ? { height: item.height } : {}),
        ...(item.points !== undefined
          ? { points: item.points.map((p) => [p[0], p[1]] as [number, number]) }
          : {}),
        ...(item.fillColor !== undefined ? { fillColor: item.fillColor } : {}),
        ...(item.strokeColor !== undefined ? { strokeColor: item.strokeColor } : {}),
        ...(item.strokeWidth !== undefined ? { strokeWidth: item.strokeWidth } : {}),
        ...(item.cornerRadius !== undefined ? { cornerRadius: item.cornerRadius } : {}),
        ...flags,
      };
    case "group":
      return {
        type: "group",
        items: [...item.items],
        transform: { ...item.transform },
        ...flags,
      };
    case "video":
      // `fit` / `loop` always present after a schema parse (they carry
      // defaults); the temporal trim bounds are optional.
      return {
        type: "video",
        asset: item.asset,
        width: item.width,
        height: item.height,
        start: item.start,
        fit: item.fit,
        loop: item.loop,
        transform: { ...item.transform },
        ...(item.end !== undefined ? { end: item.end } : {}),
        ...(item.trimIn !== undefined ? { trimIn: item.trimIn } : {}),
        ...(item.trimOut !== undefined ? { trimOut: item.trimOut } : {}),
        ...flags,
      };
  }
}

function cloneTween(tween: Tween): Tween {
  return {
    id: tween.id,
    target: tween.target,
    property: tween.property,
    from: tween.from,
    to: tween.to,
    start: tween.start,
    duration: tween.duration,
    ...(tween.easing !== undefined ? { easing: tween.easing } : {}),
  };
}

function cloneAudioTrack(track: AudioTrack): AudioTrack {
  return {
    ...(track.id !== undefined ? { id: track.id } : {}),
    asset: track.asset,
    start: track.start,
    ...(track.end !== undefined ? { end: track.end } : {}),
    ...(track.volume !== undefined ? { volume: track.volume } : {}),
    ...(track.fadeIn !== undefined ? { fadeIn: track.fadeIn } : {}),
    ...(track.fadeOut !== undefined ? { fadeOut: track.fadeOut } : {}),
  };
}

function applyItemUpdate(item: Item, props: UpdateItemProps): Item {
  const transform = { ...item.transform };
  if (props.x !== undefined) transform.x = props.x;
  if (props.y !== undefined) transform.y = props.y;
  if (props.scaleX !== undefined) transform.scaleX = props.scaleX;
  if (props.scaleY !== undefined) transform.scaleY = props.scaleY;
  if (props.rotation !== undefined) transform.rotation = props.rotation;
  if (props.anchorX !== undefined) transform.anchorX = props.anchorX;
  if (props.anchorY !== undefined) transform.anchorY = props.anchorY;
  if (props.opacity !== undefined) {
    ensureUnitInterval("opacity", props.opacity);
    transform.opacity = props.opacity;
  }

  // §M visibility/lock flags + §P name + lifespan apply to every item type.
  // They all appear in every variant's allowlist below.
  const flagPatch: {
    visible?: boolean;
    locked?: boolean;
    name?: string;
    enter?: number;
    exit?: number;
  } = {};
  if (props.visible !== undefined) flagPatch.visible = props.visible;
  if (props.locked !== undefined) flagPatch.locked = props.locked;
  if (props.name !== undefined) flagPatch.name = props.name;
  if (props.enter !== undefined) {
    ensureNonNegative("enter", props.enter);
    flagPatch.enter = props.enter;
  }
  if (props.exit !== undefined) {
    ensurePositive("exit", props.exit);
    flagPatch.exit = props.exit;
  }
  const COMMON_ALLOWED = ["visible", "locked", "name", "enter", "exit"] as const;

  switch (item.type) {
    case "sprite": {
      const next: SpriteItem = {
        ...item,
        transform,
        ...(props.asset !== undefined ? { asset: props.asset } : {}),
        ...(props.width !== undefined ? { width: props.width } : {}),
        ...(props.height !== undefined ? { height: props.height } : {}),
        ...flagPatch,
      };
      if (props.tint !== undefined) next.tint = props.tint;
      rejectKeys(props, item.type, [
        "asset",
        "width",
        "height",
        "tint",
        "x",
        "y",
        "scaleX",
        "scaleY",
        "rotation",
        "anchorX",
        "anchorY",
        "opacity",
        ...COMMON_ALLOWED,
      ]);
      return next;
    }
    case "text": {
      const next: TextItem = {
        ...item,
        transform,
        ...(props.text !== undefined ? { text: props.text } : {}),
        ...(props.font !== undefined ? { font: props.font } : {}),
        ...(props.fontSize !== undefined ? { fontSize: props.fontSize } : {}),
        ...(props.color !== undefined ? { color: props.color } : {}),
        ...flagPatch,
      };
      if (props.align !== undefined) next.align = props.align;
      rejectKeys(props, item.type, [
        "text",
        "font",
        "fontSize",
        "color",
        "align",
        "x",
        "y",
        "scaleX",
        "scaleY",
        "rotation",
        "anchorX",
        "anchorY",
        "opacity",
        ...COMMON_ALLOWED,
      ]);
      return next;
    }
    case "shape": {
      const next: ShapeItem = {
        ...item,
        transform,
        ...(props.width !== undefined ? { width: props.width } : {}),
        ...(props.height !== undefined ? { height: props.height } : {}),
        ...(props.points !== undefined
          ? {
              points: props.points.map((p) => [p[0], p[1]] as [number, number]),
            }
          : {}),
        ...(props.fillColor !== undefined ? { fillColor: props.fillColor } : {}),
        ...(props.strokeColor !== undefined ? { strokeColor: props.strokeColor } : {}),
        ...(props.strokeWidth !== undefined ? { strokeWidth: props.strokeWidth } : {}),
        ...(props.cornerRadius !== undefined ? { cornerRadius: props.cornerRadius } : {}),
        ...flagPatch,
      };
      rejectKeys(props, item.type, [
        "width",
        "height",
        "points",
        "fillColor",
        "strokeColor",
        "strokeWidth",
        "cornerRadius",
        "x",
        "y",
        "scaleX",
        "scaleY",
        "rotation",
        "anchorX",
        "anchorY",
        "opacity",
        ...COMMON_ALLOWED,
      ]);
      return next;
    }
    case "group": {
      const next: GroupItem = {
        ...item,
        transform,
        ...(props.items !== undefined ? { items: [...props.items] } : {}),
        ...flagPatch,
      };
      rejectKeys(props, item.type, [
        "items",
        "x",
        "y",
        "scaleX",
        "scaleY",
        "rotation",
        "anchorX",
        "anchorY",
        "opacity",
        ...COMMON_ALLOWED,
      ]);
      return next;
    }
    case "video": {
      // generic update_item patches video's spatial surface only (transform +
      // box + asset), exactly like a sprite minus `tint`. The temporal/display
      // fields (start/end/trimIn/trimOut/fit/loop) are not part of
      // UpdateItemProps — dedicated add_video/update_video tools land in §S9.
      const next: VideoItem = {
        ...item,
        transform,
        ...(props.asset !== undefined ? { asset: props.asset } : {}),
        ...(props.width !== undefined ? { width: props.width } : {}),
        ...(props.height !== undefined ? { height: props.height } : {}),
        ...flagPatch,
      };
      rejectKeys(props, item.type, [
        "asset",
        "width",
        "height",
        "x",
        "y",
        "scaleX",
        "scaleY",
        "rotation",
        "anchorX",
        "anchorY",
        "opacity",
        ...COMMON_ALLOWED,
      ]);
      return next;
    }
  }
}

function rejectKeys(
  props: UpdateItemProps,
  itemType: Item["type"],
  allowed: ReadonlyArray<keyof UpdateItemProps>,
): void {
  const allowedSet = new Set<keyof UpdateItemProps>(allowed);
  for (const key of Object.keys(props) as Array<keyof UpdateItemProps>) {
    if (props[key] === undefined) continue;
    if (!allowedSet.has(key)) {
      throw new MCPToolError(
        "E_INVALID_PROPERTY",
        `Property "${String(key)}" cannot be set on ${itemType} items.`,
      );
    }
  }
}
