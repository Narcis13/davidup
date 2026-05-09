// MCP tool definitions for Davidup (per design-doc §4.1–4.6).
//
// Each tool is a plain `ToolDef` with name, description, Zod input shape, and
// a handler that returns a JSON-serialisable result OR throws MCPToolError
// for structured failure. The dispatcher in `server.ts` is the only thing
// that knows about MCP transport and CallToolResult shape — handlers are
// pure functions over (args, deps), which keeps them unit-testable.
//
// Convention (per §4.7):
//   - Success → handler returns the payload object. The dispatcher wraps it
//     in `{ content: [{type:"text", text:JSON}], structuredContent: payload }`.
//   - Failure → handler throws MCPToolError(code, message, hint?). The
//     dispatcher wraps it in `{ error: { code, message, hint? } }` AND sets
//     `isError: true` so MCP clients see it as an error too.

import { z } from "zod";

import { renderToFile } from "../drivers/node/index.js";
import { EASING_NAMES } from "../easings/index.js";
import { MCPToolError } from "./errors.js";
import {
  renderPreviewFrame,
  renderThumbnailStrip,
  type PreviewSkiaModule,
} from "./render.js";
import {
  CompositionStore,
  type SetMetaPropertyName,
} from "./store.js";

// ──────────────── Shared dependency container ────────────────

export interface ToolDeps {
  store: CompositionStore;
  // Injected for tests; production server passes nothing and the renderers
  // dynamic-import skia-canvas.
  skiaCanvas?: PreviewSkiaModule;
}

// ──────────────── Tool definition shape ────────────────

export interface ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  // Handlers receive args already parsed by the SDK against inputSchema.
  // We re-validate with our own object here so direct callers (tests,
  // examples) can use the dispatcher without going through the SDK.
  handler: (args: z.infer<z.ZodObject<Shape>>, deps: ToolDeps) => Promise<unknown> | unknown;
}

function defineTool<Shape extends z.ZodRawShape>(def: ToolDef<Shape>): ToolDef<z.ZodRawShape> {
  return def as unknown as ToolDef<z.ZodRawShape>;
}

// Convenience: composition-id helper used by every tool that targets one.
const COMPOSITION_ID = z
  .string()
  .min(1)
  .optional()
  .describe("Target composition id. Omit to use the default.");

const HEX_COLOR = z.string().describe("Hex string (#rgb or #rrggbb) or rgba()");
const POINTS = z
  .array(z.tuple([z.number(), z.number()]))
  .describe("Polygon points as [[x,y], ...]");

// ──────────────── 4.1 Composition lifecycle ────────────────

const createComposition = defineTool({
  name: "create_composition",
  title: "Create composition",
  description:
    "Create a new composition. Becomes the default composition if none exists. Returns the assigned compositionId.",
  inputSchema: {
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    duration: z.number().nonnegative(),
    background: z.string().optional(),
    id: z.string().min(1).optional(),
  },
  handler: (args, { store }) => {
    const compositionId = store.createComposition({
      width: args.width,
      height: args.height,
      fps: args.fps,
      duration: args.duration,
      ...(args.background !== undefined ? { background: args.background } : {}),
      ...(args.id !== undefined ? { id: args.id } : {}),
    });
    return { compositionId };
  },
});

const getComposition = defineTool({
  name: "get_composition",
  title: "Get composition JSON",
  description:
    "Return the full canonical CompositionJSON for self-inspection by an agent.",
  inputSchema: {
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    return { json: store.toJSON(args.compositionId) };
  },
});

const setCompositionProperty = defineTool({
  name: "set_composition_property",
  title: "Set composition meta property",
  description:
    "Update one of width/height/fps/duration/background on the composition.",
  inputSchema: {
    property: z.enum(["width", "height", "fps", "duration", "background"]),
    value: z.union([z.number(), z.string()]),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    store.setMetaProperty(
      args.property as SetMetaPropertyName,
      args.value,
      args.compositionId,
    );
    return { ok: true as const };
  },
});

const validateTool = defineTool({
  name: "validate",
  title: "Validate composition",
  description:
    "Run schema + semantic validation. Returns { valid, errors, warnings }.",
  inputSchema: {
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    return store.validate(args.compositionId);
  },
});

const resetTool = defineTool({
  name: "reset",
  title: "Reset / drop composition",
  description:
    "Clear the active (or specified) composition. Leaves other compositions untouched if compositionId is given.",
  inputSchema: {
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    store.reset(args.compositionId);
    return { ok: true as const };
  },
});

// ──────────────── 4.2 Assets ────────────────

const registerAsset = defineTool({
  name: "register_asset",
  title: "Register asset",
  description:
    "Register an image or font asset by id. Font assets require a `family`.",
  inputSchema: {
    id: z.string().min(1),
    type: z.enum(["image", "font"]),
    src: z.string().min(1),
    family: z.string().min(1).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    store.registerAsset(
      {
        id: args.id,
        type: args.type,
        src: args.src,
        ...(args.family !== undefined ? { family: args.family } : {}),
      },
      args.compositionId,
    );
    return { ok: true as const };
  },
});

const listAssets = defineTool({
  name: "list_assets",
  title: "List assets",
  description: "List all registered assets in declaration order.",
  inputSchema: {
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    return { assets: store.listAssets(args.compositionId) };
  },
});

const removeAsset = defineTool({
  name: "remove_asset",
  title: "Remove asset",
  description:
    "Remove an asset. Errors if any item still references it.",
  inputSchema: {
    id: z.string().min(1),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    store.removeAsset(args.id, args.compositionId);
    return { ok: true as const };
  },
});

// ──────────────── 4.3 Layers ────────────────

const addLayer = defineTool({
  name: "add_layer",
  title: "Add layer",
  description:
    "Add a layer with z-index. Optional opacity, blendMode, explicit id.",
  inputSchema: {
    id: z.string().min(1).optional(),
    z: z.number(),
    opacity: z.number().min(0).max(1).optional(),
    blendMode: z.string().optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const layerId = store.addLayer(
      {
        z: args.z,
        ...(args.id !== undefined ? { id: args.id } : {}),
        ...(args.opacity !== undefined ? { opacity: args.opacity } : {}),
        ...(args.blendMode !== undefined ? { blendMode: args.blendMode } : {}),
      },
      args.compositionId,
    );
    return { layerId };
  },
});

const updateLayer = defineTool({
  name: "update_layer",
  title: "Update layer",
  description: "Patch a layer's z, opacity, or blendMode.",
  inputSchema: {
    id: z.string().min(1),
    props: z.object({
      z: z.number().optional(),
      opacity: z.number().min(0).max(1).optional(),
      blendMode: z.string().optional(),
    }),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const props: { z?: number; opacity?: number; blendMode?: string } = {};
    if (args.props.z !== undefined) props.z = args.props.z;
    if (args.props.opacity !== undefined) props.opacity = args.props.opacity;
    if (args.props.blendMode !== undefined) props.blendMode = args.props.blendMode;
    store.updateLayer(args.id, props, args.compositionId);
    return { ok: true as const };
  },
});

const removeLayer = defineTool({
  name: "remove_layer",
  title: "Remove layer",
  description:
    "Remove a layer. Pass cascade=true to also remove the layer's items + their tweens.",
  inputSchema: {
    id: z.string().min(1),
    cascade: z.boolean().optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    store.removeLayer(args.id, args.cascade ?? false, args.compositionId);
    return { ok: true as const };
  },
});

// ──────────────── 4.4 Items ────────────────

const TRANSFORM_INPUT = {
  anchorX: z.number().optional(),
  anchorY: z.number().optional(),
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
};

const addSprite = defineTool({
  name: "add_sprite",
  title: "Add sprite item",
  description: "Add a sprite item to a layer.",
  inputSchema: {
    layerId: z.string().min(1),
    asset: z.string().min(1),
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    ...TRANSFORM_INPUT,
    tint: z.string().optional(),
    id: z.string().min(1).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const itemId = store.addSprite(
      {
        layerId: args.layerId,
        asset: args.asset,
        x: args.x,
        y: args.y,
        width: args.width,
        height: args.height,
        ...(args.anchorX !== undefined ? { anchorX: args.anchorX } : {}),
        ...(args.anchorY !== undefined ? { anchorY: args.anchorY } : {}),
        ...(args.rotation !== undefined ? { rotation: args.rotation } : {}),
        ...(args.opacity !== undefined ? { opacity: args.opacity } : {}),
        ...(args.scaleX !== undefined ? { scaleX: args.scaleX } : {}),
        ...(args.scaleY !== undefined ? { scaleY: args.scaleY } : {}),
        ...(args.tint !== undefined ? { tint: args.tint } : {}),
        ...(args.id !== undefined ? { id: args.id } : {}),
      },
      args.compositionId,
    );
    return { itemId };
  },
});

const addText = defineTool({
  name: "add_text",
  title: "Add text item",
  description: "Add a text item to a layer.",
  inputSchema: {
    layerId: z.string().min(1),
    text: z.string(),
    font: z.string().min(1),
    fontSize: z.number().positive(),
    color: HEX_COLOR,
    x: z.number(),
    y: z.number(),
    anchorX: z.number().optional(),
    anchorY: z.number().optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    id: z.string().min(1).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const itemId = store.addText(
      {
        layerId: args.layerId,
        text: args.text,
        font: args.font,
        fontSize: args.fontSize,
        color: args.color,
        x: args.x,
        y: args.y,
        ...(args.anchorX !== undefined ? { anchorX: args.anchorX } : {}),
        ...(args.anchorY !== undefined ? { anchorY: args.anchorY } : {}),
        ...(args.align !== undefined ? { align: args.align } : {}),
        ...(args.rotation !== undefined ? { rotation: args.rotation } : {}),
        ...(args.opacity !== undefined ? { opacity: args.opacity } : {}),
        ...(args.id !== undefined ? { id: args.id } : {}),
      },
      args.compositionId,
    );
    return { itemId };
  },
});

const addShape = defineTool({
  name: "add_shape",
  title: "Add shape item",
  description: "Add a rect / circle / polygon shape item.",
  inputSchema: {
    layerId: z.string().min(1),
    kind: z.enum(["rect", "circle", "polygon"]),
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative().optional(),
    height: z.number().nonnegative().optional(),
    points: POINTS.optional(),
    fillColor: z.string().optional(),
    strokeColor: z.string().optional(),
    strokeWidth: z.number().nonnegative().optional(),
    cornerRadius: z.number().nonnegative().optional(),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    id: z.string().min(1).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const itemId = store.addShape(
      {
        layerId: args.layerId,
        kind: args.kind,
        x: args.x,
        y: args.y,
        ...(args.width !== undefined ? { width: args.width } : {}),
        ...(args.height !== undefined ? { height: args.height } : {}),
        ...(args.points !== undefined ? { points: args.points } : {}),
        ...(args.fillColor !== undefined ? { fillColor: args.fillColor } : {}),
        ...(args.strokeColor !== undefined ? { strokeColor: args.strokeColor } : {}),
        ...(args.strokeWidth !== undefined ? { strokeWidth: args.strokeWidth } : {}),
        ...(args.cornerRadius !== undefined ? { cornerRadius: args.cornerRadius } : {}),
        ...(args.rotation !== undefined ? { rotation: args.rotation } : {}),
        ...(args.opacity !== undefined ? { opacity: args.opacity } : {}),
        ...(args.id !== undefined ? { id: args.id } : {}),
      },
      args.compositionId,
    );
    return { itemId };
  },
});

const addGroup = defineTool({
  name: "add_group",
  title: "Add group item",
  description: "Add a group item with optional initial child items list.",
  inputSchema: {
    layerId: z.string().min(1),
    x: z.number(),
    y: z.number(),
    childItemIds: z.array(z.string().min(1)).optional(),
    id: z.string().min(1).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const itemId = store.addGroup(
      {
        layerId: args.layerId,
        x: args.x,
        y: args.y,
        ...(args.childItemIds !== undefined ? { childItemIds: args.childItemIds } : {}),
        ...(args.id !== undefined ? { id: args.id } : {}),
      },
      args.compositionId,
    );
    return { itemId };
  },
});

const ITEM_PROP_SHAPE = z
  .object({
    x: z.number(),
    y: z.number(),
    scaleX: z.number(),
    scaleY: z.number(),
    rotation: z.number(),
    anchorX: z.number(),
    anchorY: z.number(),
    opacity: z.number().min(0).max(1),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    asset: z.string().min(1),
    tint: z.string(),
    text: z.string(),
    font: z.string().min(1),
    fontSize: z.number().positive(),
    color: z.string(),
    align: z.enum(["left", "center", "right"]),
    fillColor: z.string(),
    strokeColor: z.string(),
    strokeWidth: z.number().nonnegative(),
    cornerRadius: z.number().nonnegative(),
    points: POINTS,
    items: z.array(z.string().min(1)),
  })
  .partial();

const updateItem = defineTool({
  name: "update_item",
  title: "Update item",
  description:
    "Patch an item's transform fields and/or type-specific properties. Unknown keys for the item type error.",
  inputSchema: {
    id: z.string().min(1),
    props: ITEM_PROP_SHAPE,
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    store.updateItem(args.id, stripUndefined(args.props), args.compositionId);
    return { ok: true as const };
  },
});

const moveItemToLayer = defineTool({
  name: "move_item_to_layer",
  title: "Move item to layer",
  description: "Move an item from its current layer to a new layer.",
  inputSchema: {
    itemId: z.string().min(1),
    targetLayerId: z.string().min(1),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    store.moveItemToLayer(args.itemId, args.targetLayerId, args.compositionId);
    return { ok: true as const };
  },
});

const removeItem = defineTool({
  name: "remove_item",
  title: "Remove item",
  description: "Remove an item. Cascades: deletes any tweens that target it.",
  inputSchema: {
    id: z.string().min(1),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    store.removeItem(args.id, args.compositionId);
    return { ok: true as const };
  },
});

// ──────────────── 4.5 Tweens ────────────────

const TWEEN_VALUE = z.union([z.number(), z.string()]);

const addTween = defineTool({
  name: "add_tween",
  title: "Add tween",
  description:
    "Add a property tween. Errors if it overlaps another tween on the same (target, property).",
  inputSchema: {
    target: z.string().min(1),
    property: z.string().min(1),
    from: TWEEN_VALUE,
    to: TWEEN_VALUE,
    start: z.number().nonnegative(),
    duration: z.number().positive(),
    easing: z.enum(EASING_NAMES).optional(),
    id: z.string().min(1).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const tweenId = store.addTween(
      {
        target: args.target,
        property: args.property,
        from: args.from,
        to: args.to,
        start: args.start,
        duration: args.duration,
        ...(args.easing !== undefined ? { easing: args.easing } : {}),
        ...(args.id !== undefined ? { id: args.id } : {}),
      },
      args.compositionId,
    );
    return { tweenId };
  },
});

const updateTween = defineTool({
  name: "update_tween",
  title: "Update tween",
  description: "Patch tween fields. Re-validates overlap on the new window.",
  inputSchema: {
    id: z.string().min(1),
    props: z
      .object({
        target: z.string().min(1),
        property: z.string().min(1),
        from: TWEEN_VALUE,
        to: TWEEN_VALUE,
        start: z.number().nonnegative(),
        duration: z.number().positive(),
        easing: z.enum(EASING_NAMES),
      })
      .partial(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    store.updateTween(args.id, stripUndefined(args.props), args.compositionId);
    return { ok: true as const };
  },
});

const removeTween = defineTool({
  name: "remove_tween",
  title: "Remove tween",
  description: "Remove a tween by id.",
  inputSchema: {
    id: z.string().min(1),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    store.removeTween(args.id, args.compositionId);
    return { ok: true as const };
  },
});

const listTweens = defineTool({
  name: "list_tweens",
  title: "List tweens",
  description: "List tweens, optionally filtered by target and/or property.",
  inputSchema: {
    target: z.string().min(1).optional(),
    property: z.string().min(1).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const filter: { target?: string; property?: string } = {};
    if (args.target !== undefined) filter.target = args.target;
    if (args.property !== undefined) filter.property = args.property;
    return { tweens: store.listTweens(filter, args.compositionId) };
  },
});

// ──────────────── 4.6 Render ────────────────

function ensureValidForRender(store: CompositionStore, compositionId?: string): void {
  const result = store.validate(compositionId);
  if (!result.valid) {
    throw new MCPToolError(
      "E_VALIDATION_FAILED",
      `Composition is invalid (${result.errors.length} error(s)).`,
      "Call `validate` and address all errors before rendering.",
    );
  }
}

const renderPreviewFrameTool = defineTool({
  name: "render_preview_frame",
  title: "Render preview frame",
  description:
    "Render a single frame at time t and return base64-encoded PNG/JPEG. Validates first.",
  inputSchema: {
    time: z.number().nonnegative(),
    format: z.enum(["png", "jpeg"]).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: async (args, { store, skiaCanvas }) => {
    ensureValidForRender(store, args.compositionId);
    const comp = store.toJSON(args.compositionId);
    const result = await renderPreviewFrame(comp, args.time, {
      ...(args.format !== undefined ? { format: args.format } : {}),
      ...(skiaCanvas !== undefined ? { skiaCanvas } : {}),
    });
    return result;
  },
});

const renderThumbnailStripTool = defineTool({
  name: "render_thumbnail_strip",
  title: "Render thumbnail strip",
  description:
    "Render `count` frames uniformly sampled across the timeline. Returns base64 image array + sample times.",
  inputSchema: {
    count: z.number().int().positive(),
    format: z.enum(["png", "jpeg"]).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: async (args, { store, skiaCanvas }) => {
    ensureValidForRender(store, args.compositionId);
    const comp = store.toJSON(args.compositionId);
    const result = await renderThumbnailStrip(comp, {
      count: args.count,
      ...(args.format !== undefined ? { format: args.format } : {}),
      ...(skiaCanvas !== undefined ? { skiaCanvas } : {}),
    });
    return result;
  },
});

const renderToVideo = defineTool({
  name: "render_to_video",
  title: "Render to video file",
  description:
    "Render the composition to an MP4 (or other ffmpeg-supported container). Validates first.",
  inputSchema: {
    outputPath: z.string().min(1),
    codec: z.enum(["libx264", "libx265"]).optional(),
    crf: z.number().int().min(0).max(63).optional(),
    preset: z.string().optional(),
    pixFmt: z.string().optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: async (args, { store }) => {
    ensureValidForRender(store, args.compositionId);
    const comp = store.toJSON(args.compositionId);
    try {
      const result = await renderToFile(comp, args.outputPath, {
        ...(args.codec !== undefined ? { codec: args.codec } : {}),
        ...(args.crf !== undefined ? { crf: args.crf } : {}),
        ...(args.preset !== undefined ? { preset: args.preset } : {}),
        ...(args.pixFmt !== undefined ? { pixFmt: args.pixFmt } : {}),
      });
      return {
        ok: true as const,
        outputPath: result.outputPath,
        durationMs: result.durationMs,
        frameCount: result.frameCount,
      };
    } catch (err) {
      throw new MCPToolError(
        "E_RENDER_FAILED",
        err instanceof Error ? err.message : String(err),
        "Check that ffmpeg is on $PATH and assets resolve from the working directory.",
      );
    }
  },
});

// ──────────────── Registry ────────────────

// Drop undefined-valued keys so a Zod-parsed `.partial()` object satisfies a
// store input type compiled with `exactOptionalPropertyTypes: true`.
function stripUndefined<T extends object>(obj: T): { [K in keyof T]: NonNullable<T[K]> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as { [K in keyof T]: NonNullable<T[K]> };
}

export const TOOLS: ReadonlyArray<ToolDef<z.ZodRawShape>> = [
  // 4.1
  createComposition,
  getComposition,
  setCompositionProperty,
  validateTool,
  resetTool,
  // 4.2
  registerAsset,
  listAssets,
  removeAsset,
  // 4.3
  addLayer,
  updateLayer,
  removeLayer,
  // 4.4
  addSprite,
  addText,
  addShape,
  addGroup,
  updateItem,
  moveItemToLayer,
  removeItem,
  // 4.5
  addTween,
  updateTween,
  removeTween,
  listTweens,
  // 4.6
  renderPreviewFrameTool,
  renderThumbnailStripTool,
  renderToVideo,
];

export const TOOL_NAMES: ReadonlyArray<string> = TOOLS.map((t) => t.name);
