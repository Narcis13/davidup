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
import { validate, type ValidationResult } from "../schema/validator.js";
import type {
  Asset,
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
} from "../schema/types.js";
import { ItemSchema } from "../schema/zod.js";
import { getTweenable } from "../schema/tweenable.js";
import { MCPToolError } from "./errors.js";

const COMPOSITION_VERSION = "0.1";
const DEFAULT_BACKGROUND = "#000000";
const DEFAULT_OPACITY = 1;
const DEFAULT_BLEND_MODE = "normal";

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
  // Monotonic counters used when an explicit id is not supplied.
  nextSeq: { layer: number; item: number; tween: number; comp: number };
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
  type: "image" | "font";
  src: string;
  family?: string;
}

export interface AddLayerInput {
  id?: string;
  z: number;
  opacity?: number;
  blendMode?: string;
}

export interface UpdateLayerProps {
  z?: number;
  opacity?: number;
  blendMode?: string;
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
  id?: string;
}

export interface AddGroupInput {
  layerId: string;
  x: number;
  y: number;
  childItemIds?: ReadonlyArray<string>;
  id?: string;
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

export class CompositionStore {
  private readonly compositions = new Map<string, MutableComposition>();
  private defaultId: string | null = null;
  private autoSeq = 0;

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
      nextSeq: { layer: 0, item: 0, tween: 0, comp: 0 },
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
    return {
      version: COMPOSITION_VERSION,
      composition: { ...comp.meta },
      assets: Array.from(comp.assets.values()).map(cloneAsset),
      layers: Array.from(comp.layers.values()).map(cloneLayer),
      items: Object.fromEntries(
        Array.from(comp.items.entries()).map(([id, item]) => [id, cloneItem(item)]),
      ),
      tweens: Array.from(comp.tweens.values()).map(cloneTween),
    };
  }

  // ──────────────── Assets ────────────────

  registerAsset(input: RegisterAssetInput, compositionId?: string): void {
    const comp = this.requireComposition(compositionId);
    if (!input.id || input.id.length === 0) {
      throw new MCPToolError("E_INVALID_VALUE", "Asset id must be a non-empty string.");
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
    } else {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Unknown asset type "${String((input as { type: unknown }).type)}".`,
        'Expected "image" or "font".',
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
      throw new MCPToolError("E_NOT_FOUND", `No asset "${assetId}".`);
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
      throw new MCPToolError("E_NOT_FOUND", `No layer "${id}".`);
    }
    const next: Layer = { ...layer };
    if (props.z !== undefined) next.z = props.z;
    if (props.opacity !== undefined) {
      ensureUnitInterval("opacity", props.opacity);
      next.opacity = props.opacity;
    }
    if (props.blendMode !== undefined) next.blendMode = props.blendMode;
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
      throw new MCPToolError("E_NOT_FOUND", `No layer "${id}".`);
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
    const transform: Transform = {
      ...DEFAULT_TRANSFORM,
      x: input.x,
      y: input.y,
    };
    const group: GroupItem = {
      type: "group",
      items: input.childItemIds ? [...input.childItemIds] : [],
      transform,
    };
    comp.items.set(id, group);
    comp.itemLayer.set(id, layer.id);
    pushUnique(layer.items, id);
    return id;
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
      throw new MCPToolError("E_INVALID_VALUE", "Item id must be a non-empty string.");
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
    if (!item) throw new MCPToolError("E_NOT_FOUND", `No item "${id}".`);
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
      throw new MCPToolError("E_NOT_FOUND", `No item "${itemId}".`);
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
      throw new MCPToolError("E_NOT_FOUND", `No item "${id}".`);
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
      throw new MCPToolError("E_DUPLICATE_ID", `Tween id "${id}" already exists.`);
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
    if (!tween) throw new MCPToolError("E_NOT_FOUND", `No tween "${id}".`);

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
      throw new MCPToolError("E_INVALID_VALUE", "Tween duration must be > 0.");
    }
    if (start < 0) {
      throw new MCPToolError("E_INVALID_VALUE", "Tween start must be ≥ 0.");
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
      throw new MCPToolError("E_NOT_FOUND", `No tween "${id}".`);
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
      throw new MCPToolError("E_NOT_FOUND", `No layer "${layerId}".`);
    }
    return layer;
  }

  private ensureNoItem(comp: MutableComposition, id: string): void {
    if (comp.items.has(id)) {
      throw new MCPToolError("E_DUPLICATE_ID", `Item id "${id}" already exists.`);
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
      // Strict overlap (touching at endpoints is OK; matches validator §3.5.5).
      if (start < oEnd && other.start < end) {
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

function cloneAsset(asset: Asset): Asset {
  return asset.type === "image"
    ? { id: asset.id, type: "image", src: asset.src }
    : { id: asset.id, type: "font", src: asset.src, family: asset.family };
}

function cloneLayer(layer: Layer): Layer {
  return {
    id: layer.id,
    z: layer.z,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    items: [...layer.items],
  };
}

function cloneItem(item: Item): Item {
  switch (item.type) {
    case "sprite":
      return {
        type: "sprite",
        asset: item.asset,
        width: item.width,
        height: item.height,
        transform: { ...item.transform },
        ...(item.tint !== undefined ? { tint: item.tint } : {}),
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
      };
    case "group":
      return {
        type: "group",
        items: [...item.items],
        transform: { ...item.transform },
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

  switch (item.type) {
    case "sprite": {
      const next: SpriteItem = {
        ...item,
        transform,
        ...(props.asset !== undefined ? { asset: props.asset } : {}),
        ...(props.width !== undefined ? { width: props.width } : {}),
        ...(props.height !== undefined ? { height: props.height } : {}),
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
      ]);
      return next;
    }
    case "group": {
      const next: GroupItem = {
        ...item,
        transform,
        ...(props.items !== undefined ? { items: [...props.items] } : {}),
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
