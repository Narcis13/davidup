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

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  expandBehavior,
  expandBehaviors,
  listBehaviors,
  type BehaviorBlock,
} from "../compose/behaviors.js";
// Side-effect import: registers v0.3 built-in templates with the global
// registry so `apply_template` and `list_templates` see them out of the box.
import "../compose/builtInTemplates.js";
import {
  expandSceneInstance,
  getSceneDefinition,
  listScenes,
  readSceneDefinition,
  sceneDescriptor,
  type SceneInstance,
  type SceneParamDescriptor,
  type TimeMapping,
} from "../compose/scenes.js";
import {
  expandTemplate,
  listTemplates,
  templateDescriptor,
  type TemplateDefinition,
  type TemplateDescriptor,
  type TemplateInstance,
  type TemplateParamDescriptor,
} from "../compose/templates.js";
import { renderToFile } from "../drivers/node/index.js";
import { EASING_NAMES } from "../easings/index.js";
import type { Tween } from "../schema/types.js";
import { BlendModeSchema } from "../schema/zod.js";
import { MCPToolError } from "./errors.js";
import {
  renderPreviewFrame,
  renderThumbnailStrip,
  type PreviewSkiaModule,
} from "./render.js";
import {
  CompositionStore,
  type SetMetaPropertyName,
  type UpdateLayerProps,
} from "./store.js";

// ──────────────── Shared dependency container ────────────────

// Project-lifecycle hooks injected by an editor that hosts the MCP server.
// The base engine (running standalone via `davidup mcp`) has no concept of a
// "project" — it just owns a CompositionStore — so `projectControls` is
// optional. When absent the project_* tools surface a structured error
// telling the agent to connect via the editor instead.

export interface ProjectInfo {
  root: string;
  compositionPath: string;
  libraryIndexPath: string | null;
  assetsDir: string | null;
  loadedAt: number;
}

export interface RecentProjectInfo {
  path: string;
  name: string;
  lastOpenedAt: number;
  lastModifiedAt: number;
}

export interface ProjectControls {
  current(): Promise<ProjectInfo | null> | ProjectInfo | null;
  list(): Promise<RecentProjectInfo[]> | RecentProjectInfo[];
  open(args: { path: string }): Promise<ProjectInfo>;
  create(args: {
    name: string;
    location: string;
    template?: string;
  }): Promise<ProjectInfo>;
}

// Polish §20.30 — `list_library` MCP tool. The merged catalog the editor
// returns from `GET /api/library`, plus a `thumbnailUrl` per item built from
// `/api/library/thumbnail?kind=...&id=...`. Mirroring the HTTP response shape
// means agents see exactly what humans see in the Library panel.

export type MCPLibraryItemKind =
  | "template"
  | "behavior"
  | "scene"
  | "asset"
  | "font";

export type MCPLibraryScope = "project" | "global";

export interface MCPLibraryItem {
  kind: MCPLibraryItemKind;
  id: string;
  name?: string;
  description?: string;
  source: string;
  scope: MCPLibraryScope;
  overridden?: boolean;
  params?: unknown[];
  emits?: string[];
  duration?: number;
  url?: string;
  thumbnail?: string;
  /** `/api/library/thumbnail?kind=<kind>&id=<id>` — the same path the UI uses. */
  thumbnailUrl: string;
}

export interface MCPLibraryRootInfo {
  scope: MCPLibraryScope;
  path: string;
}

export interface MCPLibraryCatalog {
  root: string | null;
  roots: MCPLibraryRootInfo[];
  loadedAt: number;
  attached: boolean;
  globalAttached: boolean;
  projectRoot: string | null;
  count: number;
  total: number;
  query: {
    q: string | null;
    kind: MCPLibraryItemKind | null;
    scope: MCPLibraryScope | null;
  };
  items: MCPLibraryItem[];
  errors: { file: string; message: string; scope: MCPLibraryScope }[];
}

export interface LibraryListArgs {
  q?: string;
  kind?: MCPLibraryItemKind;
  scope?: MCPLibraryScope;
}

export interface LibraryControls {
  list(args: LibraryListArgs): Promise<MCPLibraryCatalog> | MCPLibraryCatalog;
}

// Polish §20.31 — async render via MCP. The editor injects `RenderControls`
// so `render_to_video` can enqueue a job in the editor's render queue (the
// "Transmit job queue") and return a `jobId` immediately. The standalone
// engine has no queue; render_to_video stays blocking there.

export type MCPRenderJobStatus = "pending" | "running" | "done" | "error";

export interface MCPRenderJobProgress {
  frame: number;
  total: number;
  /** Milliseconds since the job started. */
  elapsedMs: number;
}

export interface MCPRenderJobResult {
  outputPath: string;
  relativeOutputPath: string;
  frameCount: number;
  durationMs: number;
}

export interface MCPRenderJobSnapshot {
  jobId: string;
  status: MCPRenderJobStatus;
  outputPath: string;
  relativeOutputPath: string;
  totalFrames: number;
  /** Epoch ms when the job was enqueued. */
  startedAt: number;
  progress: MCPRenderJobProgress | null;
  result: MCPRenderJobResult | null;
  error: { message: string } | null;
  /** SSE endpoint the editor exposes for live progress events. */
  eventsUrl?: string;
}

export interface MCPRenderStartArgs {
  outputPath: string;
  codec?: "libx264" | "libx265";
  crf?: number;
  preset?: string;
  pixFmt?: string;
}

export interface RenderControls {
  start(args: MCPRenderStartArgs): Promise<MCPRenderJobSnapshot> | MCPRenderJobSnapshot;
  get(jobId: string): Promise<MCPRenderJobSnapshot | null> | MCPRenderJobSnapshot | null;
  list(): Promise<MCPRenderJobSnapshot[]> | MCPRenderJobSnapshot[];
  /** Resolves once the job is terminal (done or error). Never rejects. */
  waitFor(jobId: string): Promise<MCPRenderJobSnapshot>;
}

export interface ToolDeps {
  store: CompositionStore;
  // Injected for tests; production server passes nothing and the renderers
  // dynamic-import skia-canvas.
  skiaCanvas?: PreviewSkiaModule;
  // Injected by the editor's mcp_bridge; missing in the standalone engine.
  projectControls?: ProjectControls;
  libraryControls?: LibraryControls;
  renderControls?: RenderControls;
}

function requireProjectControls(deps: ToolDeps): ProjectControls {
  if (!deps.projectControls) {
    throw new MCPToolError(
      "E_UNKNOWN",
      "Project lifecycle tools are not available on this MCP server.",
      "Connect through the editor (`davidup edit`) — the standalone engine server has no project concept.",
    );
  }
  return deps.projectControls;
}

function requireLibraryControls(deps: ToolDeps): LibraryControls {
  if (!deps.libraryControls) {
    throw new MCPToolError(
      "E_UNKNOWN",
      "Library tools are not available on this MCP server.",
      "Connect through the editor (`davidup edit`) — the standalone engine server has no library service.",
    );
  }
  return deps.libraryControls;
}

function requireRenderControls(deps: ToolDeps): RenderControls {
  if (!deps.renderControls) {
    throw new MCPToolError(
      "E_UNKNOWN",
      "Render queue tools are not available on this MCP server.",
      "Connect through the editor (`davidup edit`) — the standalone engine server has no render queue.",
    );
  }
  return deps.renderControls;
}

// Sandbox `import_scene`. In editor mode resolve relative to
// `<project-root>/scenes/` and refuse paths that escape it; in standalone mode
// refuse all filesystem reads unless the operator has opted in by setting
// `DAVIDUP_ALLOW_FS=1`. Keeps an MCP client from coaxing the server into
// reading arbitrary files (~/.ssh/id_rsa, /etc/passwd, …).
async function resolveImportScenePath(
  requested: string,
  deps: ToolDeps,
  path: typeof import("node:path"),
): Promise<string> {
  if (deps.projectControls) {
    const project = await deps.projectControls.current();
    if (!project) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        "import_scene needs an open project to sandbox filesystem reads.",
        "Call `open_project` or `create_project` first; scene files are resolved under `<project>/scenes/`.",
      );
    }
    const scenesDir = path.resolve(project.root, "scenes");
    const resolved = path.resolve(scenesDir, requested);
    const rel = path.relative(scenesDir, resolved);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Scene path "${requested}" resolves outside the project's scenes/ directory.`,
        "Pass a path relative to `<project>/scenes/` (no `..` segments, no absolute paths).",
      );
    }
    return resolved;
  }
  if (process.env.DAVIDUP_ALLOW_FS !== "1") {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      "import_scene is disabled on this standalone MCP server.",
      "Set `DAVIDUP_ALLOW_FS=1` in the server's environment to allow filesystem reads, or run the editor server which sandboxes reads to `<project>/scenes/`.",
    );
  }
  return path.resolve(requested);
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
    blendMode: BlendModeSchema.optional(),
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
      blendMode: BlendModeSchema.optional(),
    }),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const props: UpdateLayerProps = {};
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

// ──────────────── 4.5b Behaviors (§6.7) ────────────────

const applyBehavior = defineTool({
  name: "apply_behavior",
  title: "Apply behavior",
  description:
    "Expand a built-in behavior into one or more tweens. Each emitted tween is added to the store under a deterministic id; ordinary overlap and property-validity checks apply.",
  inputSchema: {
    target: z.string().min(1),
    behavior: z.string().min(1),
    start: z.number().nonnegative(),
    duration: z.number().positive(),
    params: z.record(z.string(), z.unknown()).optional(),
    easing: z.enum(EASING_NAMES).optional(),
    id: z.string().min(1).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const block: BehaviorBlock = {
      target: args.target,
      behavior: args.behavior,
      start: args.start,
      duration: args.duration,
    };
    if (args.easing !== undefined) block.easing = args.easing;
    if (args.params !== undefined) block.params = args.params;
    if (args.id !== undefined) block.id = args.id;
    const tweens = expandBehavior(block);
    const tweenIds: string[] = [];
    try {
      for (const t of tweens) {
        store.addTween(
          {
            id: t.id,
            target: t.target,
            property: t.property,
            from: t.from,
            to: t.to,
            start: t.start,
            duration: t.duration,
            ...(t.easing !== undefined ? { easing: t.easing } : {}),
          },
          args.compositionId,
        );
        tweenIds.push(t.id);
      }
    } catch (err) {
      // Roll back any partially-added tweens so apply_behavior is atomic.
      for (const id of tweenIds) {
        try {
          store.removeTween(id, args.compositionId);
        } catch {
          // best-effort cleanup; ignore
        }
      }
      throw err;
    }
    return { tweenIds };
  },
});

const listBehaviorsTool = defineTool({
  name: "list_behaviors",
  title: "List behaviors",
  description:
    "List the built-in behaviors available to apply_behavior, with their parameters and produced tween suffixes.",
  inputSchema: {},
  handler: () => {
    return { behaviors: listBehaviors() };
  },
});

// ──────────────── 4.5c Templates (§7.8) ────────────────

const TEMPLATE_PARAM_TYPE = z.enum(["number", "string", "color", "boolean"]);

const TEMPLATE_PARAM_DESCRIPTOR = z.object({
  name: z.string().min(1),
  type: TEMPLATE_PARAM_TYPE,
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  description: z.string().optional(),
});

const applyTemplate = defineTool({
  name: "apply_template",
  title: "Apply template",
  description:
    "Expand a template instance into items + tweens, atomically adding them to the composition. " +
    "Tweens authored as `$behavior` blocks inside the template are expanded to literal tweens. " +
    "On any validation/overlap error every item and tween added during the call is rolled back.",
  inputSchema: {
    templateId: z.string().min(1),
    layerId: z.string().min(1),
    start: z.number().nonnegative().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    id: z.string().min(1).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const instanceId = args.id ?? `${args.templateId}_${args.start ?? 0}`;
    const instance: TemplateInstance = {
      template: args.templateId,
      layerId: args.layerId,
      ...(args.params !== undefined ? { params: args.params } : {}),
      ...(args.start !== undefined ? { start: args.start } : {}),
    };
    // Session-scoped user templates win over the process-global REGISTRY so
    // two MCP sessions on the same backend never share `define_user_template`
    // mutations. The expander falls back to the global REGISTRY when an id
    // isn't present in the session record.
    const expanded = expandTemplate(instanceId, instance, {
      templates: store.userTemplateRecord(),
    });
    // Run the §10.4 behavior pass on the template's tween array so any
    // `$behavior` blocks the template emitted resolve to literal tweens.
    const literalTweens = (
      expandBehaviors({ tweens: expanded.tweens }) as { tweens: Tween[] }
    ).tweens;

    const itemIds: string[] = [];
    const tweenIds: string[] = [];
    try {
      for (const localId of Object.keys(expanded.items)) {
        store.addRawItem(
          {
            id: localId,
            layerId: args.layerId,
            item: expanded.items[localId],
          },
          args.compositionId,
        );
        itemIds.push(localId);
      }
      for (const t of literalTweens) {
        store.addTween(
          {
            id: t.id,
            target: t.target,
            property: t.property,
            from: t.from,
            to: t.to,
            start: t.start,
            duration: t.duration,
            ...(t.easing !== undefined ? { easing: t.easing } : {}),
          },
          args.compositionId,
        );
        tweenIds.push(t.id);
      }
    } catch (err) {
      // Rollback: tweens first (they reference items), then items. Best-effort
      // — removeTween/removeItem only fail if already gone, which is fine.
      for (let i = tweenIds.length - 1; i >= 0; i -= 1) {
        try {
          store.removeTween(tweenIds[i] as string, args.compositionId);
        } catch {
          /* already gone */
        }
      }
      for (let i = itemIds.length - 1; i >= 0; i -= 1) {
        try {
          store.removeItem(itemIds[i] as string, args.compositionId);
        } catch {
          /* already gone */
        }
      }
      throw err;
    }
    return { instanceId, items: itemIds, tweens: tweenIds };
  },
});

const listTemplatesTool = defineTool({
  name: "list_templates",
  title: "List templates",
  description:
    "List the registered templates (built-ins plus any user templates registered via define_user_template), with their parameters and the local item ids each one emits.",
  inputSchema: {},
  handler: (_args, { store }) => {
    // Merge process-global registry (built-ins / library_index) with this
    // session's user templates; session entries override globals on id
    // collision, mirroring the precedence used at expansion time.
    const merged = new Map<string, TemplateDescriptor>();
    for (const d of listTemplates()) merged.set(d.id, d);
    for (const def of store.listUserTemplates()) {
      merged.set(def.id, templateDescriptor(def));
    }
    return { templates: Array.from(merged.values()) };
  },
});

const defineUserTemplate = defineTool({
  name: "define_user_template",
  title: "Define user template",
  description:
    "Register a user-defined template scoped to this MCP session. Last write wins per id, and session templates take precedence over the built-in / library-loaded global registry on the same id (so a built-in can be shadowed by re-registering under the same id). Definitions do not leak to other MCP sessions sharing the same backend.",
  inputSchema: {
    id: z.string().min(1),
    description: z.string().optional(),
    params: z.array(TEMPLATE_PARAM_DESCRIPTOR).optional(),
    items: z.record(z.string().min(1), z.unknown()),
    tweens: z.array(z.unknown()).optional(),
  },
  handler: (args, { store }) => {
    const params: TemplateParamDescriptor[] = (args.params ?? []).map((p) => {
      const desc: TemplateParamDescriptor = { name: p.name, type: p.type };
      if (p.required === true) desc.required = true;
      if (Object.prototype.hasOwnProperty.call(p, "default")) {
        desc.default = p.default;
      }
      if (p.description !== undefined) desc.description = p.description;
      return desc;
    });
    const def: TemplateDefinition = {
      id: args.id,
      params,
      items: args.items,
      tweens: args.tweens ?? [],
    };
    if (args.description !== undefined) def.description = args.description;
    store.setUserTemplate(def);
    return { id: args.id };
  },
});

// ──────────────── 4.5d Scenes (§8.9) ────────────────

const SCENE_PARAM_TYPE = z.enum(["number", "string", "color", "boolean"]);

const SCENE_PARAM_DESCRIPTOR = z.object({
  name: z.string().min(1),
  type: SCENE_PARAM_TYPE,
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  description: z.string().optional(),
});

const SCENE_ASSET = z.union([
  z.object({
    id: z.string().min(1),
    type: z.literal("image"),
    src: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("font"),
    src: z.string().min(1),
    family: z.string().min(1),
  }),
]);

const SCENE_TRANSFORM = z
  .object({
    x: z.number(),
    y: z.number(),
    scaleX: z.number(),
    scaleY: z.number(),
    rotation: z.number(),
    anchorX: z.number(),
    anchorY: z.number(),
    opacity: z.number().min(0).max(1),
  })
  .partial();

// v0.5 time-mapping spec for scene instances (§8.5). Range/sanity checks
// happen inside expandSceneInstance once the scene's `duration` is known —
// here we only enforce shape.
const TIME_MAPPING_SCHEMA = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("identity") }),
  z.object({
    mode: z.literal("clip"),
    fromTime: z.number().nonnegative(),
    toTime: z.number().positive(),
  }),
  z.object({
    mode: z.literal("loop"),
    count: z.number().int().min(1),
  }),
  z.object({
    mode: z.literal("timeScale"),
    scale: z.number().positive(),
  }),
]);

const defineScene = defineTool({
  name: "define_scene",
  title: "Define scene",
  description:
    "Register a scene definition scoped to this MCP session. A scene is a self-contained mini-composition with its own duration, items, tweens, params, and assets. Last write wins per id, and session scenes take precedence over the built-in / library-loaded global registry on the same id. Definitions do not leak to other MCP sessions sharing the same backend.",
  inputSchema: {
    id: z.string().min(1),
    description: z.string().optional(),
    duration: z.number().nonnegative(),
    size: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
    background: z.string().optional(),
    params: z.array(SCENE_PARAM_DESCRIPTOR).optional(),
    assets: z.array(SCENE_ASSET).optional(),
    items: z.record(z.string().min(1), z.unknown()),
    tweens: z.array(z.unknown()).optional(),
  },
  handler: (args, { store }) => {
    const def = readSceneDefinition(args.id, {
      ...(args.description !== undefined ? { description: args.description } : {}),
      duration: args.duration,
      ...(args.size !== undefined ? { size: args.size } : {}),
      ...(args.background !== undefined ? { background: args.background } : {}),
      params: args.params ?? [],
      assets: args.assets ?? [],
      items: args.items,
      tweens: args.tweens ?? [],
    });
    // The descriptor declarations the user provided already came in via the
    // SceneParamDescriptor interface shape; carry them through unchanged.
    const params: SceneParamDescriptor[] = (args.params ?? []).map((p) => {
      const desc: SceneParamDescriptor = { name: p.name, type: p.type };
      if (p.required === true) desc.required = true;
      if (Object.prototype.hasOwnProperty.call(p, "default")) desc.default = p.default;
      if (p.description !== undefined) desc.description = p.description;
      return desc;
    });
    def.params = params;
    store.setUserScene(def);
    return { sceneId: args.id };
  },
});

const importScene = defineTool({
  name: "import_scene",
  title: "Import scene from file",
  description:
    "Load a scene definition from a JSON file on disk and register it for this MCP session. The file's top-level shape mirrors `define_scene` (id, duration, items, tweens, params, assets, size, background). Filesystem reads are sandboxed: in the editor server `path` is resolved within `<project-root>/scenes/`; in the standalone engine server reads are refused unless the operator has set `DAVIDUP_ALLOW_FS=1`. Imports are session-scoped and do not leak to other MCP sessions sharing the same backend.",
  inputSchema: {
    path: z.string().min(1),
    id: z.string().min(1).optional(),
  },
  handler: async (args, deps) => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const resolvedPath = await resolveImportScenePath(args.path, deps, path);
    let raw: string;
    try {
      raw = await fs.readFile(resolvedPath, "utf8");
    } catch (err) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `Scene file not found: ${args.path}`,
        err instanceof Error ? err.message : undefined,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Scene file is not valid JSON: ${args.path}`,
        err instanceof Error ? err.message : undefined,
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `Scene file ${args.path} must contain a JSON object.`,
      );
    }
    const sceneObj = parsed as Record<string, unknown>;
    const id =
      args.id ??
      (typeof sceneObj.id === "string" && sceneObj.id.length > 0 ? sceneObj.id : undefined);
    if (id === undefined) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        "import_scene requires an id (passed as arg or set on the file's `id` field).",
      );
    }
    const def = readSceneDefinition(id, sceneObj);
    deps.store.setUserScene(def);
    return { sceneId: id };
  },
});

const listScenesTool = defineTool({
  name: "list_scenes",
  title: "List scenes",
  description:
    "List the registered scenes (defined via define_scene or import_scene), with their params, duration, size, background, emitted item ids, and asset ids.",
  inputSchema: {},
  handler: (_args, { store }) => {
    // Merge the process-global scene registry (built-ins / library_index)
    // with this session's user scenes; session entries override globals on
    // id collision, mirroring the precedence used at expansion time.
    const merged = new Map<string, ReturnType<typeof sceneDescriptor>>();
    for (const d of listScenes()) merged.set(d.id, d);
    for (const def of store.listUserScenes()) {
      merged.set(def.id, sceneDescriptor(def));
    }
    return { scenes: Array.from(merged.values()) };
  },
});

const removeScene = defineTool({
  name: "remove_scene",
  title: "Remove scene",
  description:
    "Drop a scene previously registered in this MCP session by define_scene / import_scene. Process-global entries (built-ins, editor library) are not removable from a session and removing them is rejected. Existing scene-instance expansions in compositions are unaffected — already-expanded items live on as canonical items.",
  inputSchema: {
    sceneId: z.string().min(1),
  },
  handler: (args, { store }) => {
    if (!store.removeUserScene(args.sceneId)) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No scene "${args.sceneId}" in this session's registry.`,
        "Session-scoped removal only affects scenes defined via define_scene or import_scene in this MCP session.",
      );
    }
    return { ok: true as const };
  },
});

function applySceneInstanceToStore(
  store: CompositionStore,
  args: {
    instanceId: string;
    sceneId: string;
    layerId: string;
    start: number;
    params?: Record<string, unknown>;
    transform?: Record<string, unknown>;
    time?: TimeMapping;
    compositionId?: string;
  },
): { itemIds: string[]; tweenIds: string[]; assetIds: string[] } {
  // Look up the scene in this session's registry first (the only place
  // define_scene / import_scene write to). Fall back to the process-global
  // registry for built-ins / editor library entries so a multi-tenant
  // backend never lets a user-defined scene from session A appear in
  // session B (M4 — SaaS blocker fix).
  const def = store.getUserScene(args.sceneId) ?? getSceneDefinition(args.sceneId);
  if (!def) {
    throw new MCPToolError(
      "E_SCENE_UNKNOWN",
      `Unknown scene "${args.sceneId}".`,
      "Call list_scenes to see available names, or define_scene / import_scene first.",
    );
  }
  const sceneInstance: SceneInstance = {
    scene: args.sceneId,
    start: args.start,
    layerId: args.layerId,
    ...(args.params !== undefined ? { params: args.params } : {}),
    ...(args.transform !== undefined ? { transform: args.transform } : {}),
    ...(args.time !== undefined ? { time: args.time } : {}),
  };
  // Pass the session's scene record into the expander so any nested scene
  // references inside this scene also resolve session-first.
  const expanded = expandSceneInstance(args.instanceId, sceneInstance, {
    scenes: store.userSceneRecord(),
  });

  // Run the §10.4 behavior pass on the scene's tween array so any
  // `$behavior` blocks the scene emitted resolve to literal tweens.
  const literalTweens = (
    expandBehaviors({ tweens: expanded.tweens }) as { tweens: Tween[] }
  ).tweens;

  const addedItemIds: string[] = [];
  const addedTweenIds: string[] = [];
  const addedAssetIds: string[] = [];

  try {
    // Assets first — items can reference them.
    for (const a of expanded.assets) {
      const existing = store.getAsset(a.id, args.compositionId);
      if (existing === undefined) {
        store.registerAssetUnchecked(a, args.compositionId);
        addedAssetIds.push(a.id);
      } else {
        const sameSrc = existing.src === a.src;
        const sameType = existing.type === a.type;
        const sameFamily =
          existing.type === "font" && a.type === "font"
            ? existing.family === a.family
            : true;
        if (!sameSrc || !sameType || !sameFamily) {
          throw new MCPToolError(
            "E_ASSET_CONFLICT",
            `Scene "${args.sceneId}" asset "${a.id}" conflicts with an existing asset of different content.`,
          );
        }
      }
    }

    // Inner items (no layer).
    for (const innerId of Object.keys(expanded.items)) {
      store.addRawSubItem(
        { id: innerId, item: expanded.items[innerId] },
        args.compositionId,
      );
      addedItemIds.push(innerId);
    }

    // Wrapper group — sits in the requested layer with the merged transform.
    const wrapperTransform = (
      expanded.groupItem as {
        transform: {
          x: number;
          y: number;
          scaleX: number;
          scaleY: number;
          rotation: number;
          anchorX: number;
          anchorY: number;
          opacity: number;
        };
      }
    ).transform;
    const wrapperChildren = (expanded.groupItem as { items: string[] }).items;
    store.addRawGroup(
      {
        id: args.instanceId,
        layerId: args.layerId,
        childItemIds: wrapperChildren,
        transform: { ...wrapperTransform },
      },
      args.compositionId,
    );
    addedItemIds.push(args.instanceId);

    // Tweens last — they reference item ids that must already exist.
    for (const t of literalTweens) {
      store.addRawTween(t, args.compositionId);
      addedTweenIds.push(t.id);
    }
  } catch (err) {
    // Roll back in reverse order.
    for (let i = addedTweenIds.length - 1; i >= 0; i -= 1) {
      try {
        store.removeTween(addedTweenIds[i] as string, args.compositionId);
      } catch {
        /* already gone */
      }
    }
    for (let i = addedItemIds.length - 1; i >= 0; i -= 1) {
      try {
        store.removeItem(addedItemIds[i] as string, args.compositionId);
      } catch {
        /* already gone */
      }
    }
    // Don't bother rolling back asset additions — they're inert without items
    // and may already be referenced elsewhere. Caller can `remove_asset` if
    // they really want a clean slate.
    void addedAssetIds;
    throw err;
  }

  return { itemIds: addedItemIds, tweenIds: addedTweenIds, assetIds: addedAssetIds };
}

const addSceneInstance = defineTool({
  name: "add_scene_instance",
  title: "Add scene instance",
  description:
    "Place a scene in the composition's timeline. Expands the scene into a synthetic group (placed in `layerId` at the optional `transform`) plus prefixed inner items and time-shifted tweens. The optional `time` field controls how the scene's tween timeline maps onto the parent: \"identity\" (default), \"clip\" with fromTime/toTime, \"loop\" with count, or \"timeScale\" with scale. Scene-declared assets are merged into the root composition; conflicts on id with different content error. The whole expansion is atomic — any failure rolls back every item, tween, and asset added during this call.",
  inputSchema: {
    sceneId: z.string().min(1),
    layerId: z.string().min(1),
    start: z.number().nonnegative().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    transform: SCENE_TRANSFORM.optional(),
    time: TIME_MAPPING_SCHEMA.optional(),
    id: z.string().min(1).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const instanceId = args.id ?? store.nextSceneInstanceId(args.compositionId);
    const start = args.start ?? 0;

    const result = applySceneInstanceToStore(store, {
      instanceId,
      sceneId: args.sceneId,
      layerId: args.layerId,
      start,
      ...(args.params !== undefined ? { params: args.params } : {}),
      ...(args.transform !== undefined ? { transform: args.transform } : {}),
      ...(args.time !== undefined ? { time: args.time } : {}),
      ...(args.compositionId !== undefined ? { compositionId: args.compositionId } : {}),
    });

    store.trackSceneInstance(
      instanceId,
      {
        sceneId: args.sceneId,
        layerId: args.layerId,
        start,
        params: args.params ?? {},
        transform: args.transform,
        time: args.time,
        itemIds: result.itemIds,
        tweenIds: result.tweenIds,
        assetIds: result.assetIds,
      },
      args.compositionId,
    );

    return {
      instanceId,
      items: result.itemIds,
      tweens: result.tweenIds,
      assets: result.assetIds,
    };
  },
});

const updateSceneInstance = defineTool({
  name: "update_scene_instance",
  title: "Update scene instance",
  description:
    "Patch a scene instance's params / transform / start / time. The instance is removed and re-expanded under the same id; rolled back to the previous state on any error.",
  inputSchema: {
    instanceId: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
    transform: SCENE_TRANSFORM.optional(),
    start: z.number().nonnegative().optional(),
    time: TIME_MAPPING_SCHEMA.optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const prev = store.getSceneInstance(args.instanceId, args.compositionId);
    if (!prev) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No tracked scene instance "${args.instanceId}".`,
        "Use add_scene_instance first.",
      );
    }
    const nextParams = args.params ?? prev.params;
    const nextTransform = args.transform ?? prev.transform;
    const nextStart = args.start ?? prev.start;
    const nextTime = args.time ?? prev.time;

    // Drop the previous expansion entirely.
    store.removeSceneInstance(args.instanceId, args.compositionId);

    try {
      const result = applySceneInstanceToStore(store, {
        instanceId: args.instanceId,
        sceneId: prev.sceneId,
        layerId: prev.layerId,
        start: nextStart,
        params: nextParams,
        ...(nextTransform !== undefined ? { transform: nextTransform } : {}),
        ...(nextTime !== undefined ? { time: nextTime } : {}),
        ...(args.compositionId !== undefined ? { compositionId: args.compositionId } : {}),
      });
      store.trackSceneInstance(
        args.instanceId,
        {
          sceneId: prev.sceneId,
          layerId: prev.layerId,
          start: nextStart,
          params: nextParams,
          transform: nextTransform,
          time: nextTime,
          itemIds: result.itemIds,
          tweenIds: result.tweenIds,
          assetIds: result.assetIds,
        },
        args.compositionId,
      );
      return { ok: true as const };
    } catch (err) {
      // Best-effort restoration of the previous expansion. If this fails the
      // store is left without the instance — caller can re-add via
      // add_scene_instance from the original params.
      try {
        const restored = applySceneInstanceToStore(store, {
          instanceId: args.instanceId,
          sceneId: prev.sceneId,
          layerId: prev.layerId,
          start: prev.start,
          params: prev.params,
          ...(prev.transform !== undefined ? { transform: prev.transform } : {}),
          ...(prev.time !== undefined ? { time: prev.time } : {}),
          ...(args.compositionId !== undefined ? { compositionId: args.compositionId } : {}),
        });
        store.trackSceneInstance(
          args.instanceId,
          {
            sceneId: prev.sceneId,
            layerId: prev.layerId,
            start: prev.start,
            params: prev.params,
            transform: prev.transform,
            time: prev.time,
            itemIds: restored.itemIds,
            tweenIds: restored.tweenIds,
            assetIds: restored.assetIds,
          },
          args.compositionId,
        );
      } catch {
        /* couldn't restore; surface the original error to the caller */
      }
      throw err;
    }
  },
});

const removeSceneInstanceTool = defineTool({
  name: "remove_scene_instance",
  title: "Remove scene instance",
  description:
    "Drop a previously-added scene instance: removes the wrapper group, all prefixed inner items, and all tweens added by the original expansion. Assets contributed by the instance are removed only if no item still references them.",
  inputSchema: {
    instanceId: z.string().min(1),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    store.removeSceneInstance(args.instanceId, args.compositionId);
    return { ok: true as const };
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

interface RenderToVideoResult {
  jobId: string;
  status: MCPRenderJobStatus;
  outputPath: string;
  relativeOutputPath: string;
  totalFrames: number;
  startedAt: number;
  eventsUrl?: string;
  result: MCPRenderJobResult | null;
}

const renderToVideo = defineTool({
  name: "render_to_video",
  title: "Render to video file",
  description:
    "Render the composition to an MP4 (or other ffmpeg-supported container). " +
    "Always returns the same shape: " +
    "`{ jobId, status, outputPath, relativeOutputPath, totalFrames, startedAt, eventsUrl?, result }`. " +
    "`result` is `null` until the job completes; on success it carries `{ outputPath, relativeOutputPath, durationMs, frameCount }`. " +
    "Default is async — the editor enqueues a job (polish §20.31) and returns immediately with `result: null`; " +
    "poll `get_render` or pass `wait: true` to block until the render completes (then `result` is populated). " +
    "The standalone engine has no queue; calls always block and the response carries `status: \"done\"` with `result` populated. " +
    "On render failure the handler throws `E_RENDER_FAILED` rather than resolving with `status: \"error\"`.",
  inputSchema: {
    outputPath: z.string().min(1),
    codec: z.enum(["libx264", "libx265"]).optional(),
    crf: z.number().int().min(0).max(63).optional(),
    preset: z.string().optional(),
    pixFmt: z.string().optional(),
    wait: z
      .boolean()
      .optional()
      .describe(
        "If true, block until the render finishes so `result` is populated in the response. Default is async (returns a jobId immediately with `result: null`) when a render queue is available. Ignored on the standalone engine, which is always blocking.",
      ),
    compositionId: COMPOSITION_ID,
  },
  handler: async (args, deps): Promise<RenderToVideoResult> => {
    const { store, renderControls } = deps;
    ensureValidForRender(store, args.compositionId);

    // Editor-hosted: route through the render queue. Default is async — return
    // a snapshot with `result: null`. With `wait: true`, await completion and
    // return the same shape with `result` populated.
    if (renderControls) {
      const startArgs: MCPRenderStartArgs = { outputPath: args.outputPath };
      if (args.codec !== undefined) startArgs.codec = args.codec;
      if (args.crf !== undefined) startArgs.crf = args.crf;
      if (args.preset !== undefined) startArgs.preset = args.preset;
      if (args.pixFmt !== undefined) startArgs.pixFmt = args.pixFmt;

      const snapshot = await renderControls.start(startArgs);

      const finalSnap =
        args.wait === true ? await renderControls.waitFor(snapshot.jobId) : snapshot;

      if (args.wait === true && finalSnap.status === "error") {
        throw new MCPToolError(
          "E_RENDER_FAILED",
          finalSnap.error?.message ?? "Render job failed.",
          "Inspect `get_render` for the terminal state.",
        );
      }
      if (args.wait === true && !finalSnap.result) {
        throw new MCPToolError(
          "E_RENDER_FAILED",
          "Render job finished without a result payload.",
        );
      }

      const out: RenderToVideoResult = {
        jobId: finalSnap.jobId,
        status: finalSnap.status,
        outputPath: finalSnap.outputPath,
        relativeOutputPath: finalSnap.relativeOutputPath,
        totalFrames: finalSnap.totalFrames,
        startedAt: finalSnap.startedAt,
        result: finalSnap.result,
      };
      if (finalSnap.eventsUrl !== undefined) out.eventsUrl = finalSnap.eventsUrl;
      return out;
    }

    // Standalone engine: no queue. Always blocking — synthesize a one-shot
    // snapshot so the return shape matches the editor-hosted path.
    const comp = store.toJSON(args.compositionId);
    const jobId = `local-${randomUUID()}`;
    const startedAt = Date.now();
    try {
      const result = await renderToFile(comp, args.outputPath, {
        ...(args.codec !== undefined ? { codec: args.codec } : {}),
        ...(args.crf !== undefined ? { crf: args.crf } : {}),
        ...(args.preset !== undefined ? { preset: args.preset } : {}),
        ...(args.pixFmt !== undefined ? { pixFmt: args.pixFmt } : {}),
      });
      return {
        jobId,
        status: "done",
        outputPath: result.outputPath,
        relativeOutputPath: result.outputPath,
        totalFrames: result.frameCount,
        startedAt,
        result: {
          outputPath: result.outputPath,
          relativeOutputPath: result.outputPath,
          durationMs: result.durationMs,
          frameCount: result.frameCount,
        },
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

const getRender = defineTool({
  name: "get_render",
  title: "Get render job",
  description:
    "Return a snapshot of a render job started by `render_to_video`: status, progress (latest frame/total/elapsedMs), terminal result on success, or error message on failure. " +
    "Errors E_NOT_FOUND if the jobId is unknown, or E_UNKNOWN if the MCP server is not hosted inside an editor.",
  inputSchema: {
    jobId: z.string().min(1),
  },
  handler: async (args, deps) => {
    const ctrl = requireRenderControls(deps);
    const snap = await ctrl.get(args.jobId);
    if (!snap) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No render job with id "${args.jobId}".`,
        "Call `list_renders` to see jobs that are still tracked in memory.",
      );
    }
    return snap;
  },
});

const listRenders = defineTool({
  name: "list_renders",
  title: "List render jobs",
  description:
    "List render jobs the editor's queue is currently tracking, newest first. Each entry has the same shape as `get_render`. " +
    "The queue retains a bounded number of completed jobs; older ones are evicted lazily. " +
    "Errors E_UNKNOWN if the MCP server is not hosted inside an editor.",
  inputSchema: {},
  handler: async (_args, deps) => {
    const ctrl = requireRenderControls(deps);
    const jobs = await ctrl.list();
    return { jobs };
  },
});

// ──────────────── 4.7 Project lifecycle (polish §20.29) ────────────────

const currentProject = defineTool({
  name: "current_project",
  title: "Current project",
  description:
    "Return information about the project currently loaded by the editor (root, paths, loadedAt). Returns `{ project: null }` when no project is loaded. Errors with E_UNKNOWN if the MCP server is not hosted inside an editor.",
  inputSchema: {},
  handler: async (_args, deps) => {
    const ctrl = requireProjectControls(deps);
    const project = await ctrl.current();
    return { project };
  },
});

const listProjects = defineTool({
  name: "list_projects",
  title: "List recent projects",
  description:
    "Return the editor's list of recently-opened projects, sorted newest first. Entries whose directory no longer exists are pruned. Errors with E_UNKNOWN if the MCP server is not hosted inside an editor.",
  inputSchema: {},
  handler: async (_args, deps) => {
    const ctrl = requireProjectControls(deps);
    const projects = await ctrl.list();
    return { projects };
  },
});

const openProject = defineTool({
  name: "open_project",
  title: "Open project",
  description:
    "Load a project from a directory on disk and make it the editor's active composition. Routes through the same controller path as POST /api/project in the UI (same validation, same path guard, same project-switch reset). Errors with E_NOT_FOUND if no composition.json exists at `path`, E_INVALID_VALUE if `path` is malformed or in a protected system location, or E_UNKNOWN if the MCP server is not hosted inside an editor.",
  inputSchema: {
    path: z.string().min(1),
  },
  handler: async (args, deps) => {
    const ctrl = requireProjectControls(deps);
    const project = await ctrl.open({ path: args.path });
    return { project };
  },
});

const LIBRARY_ITEM_KIND = z.enum(["template", "behavior", "scene", "asset", "font"]);
const LIBRARY_SCOPE = z.enum(["project", "global"]);

const listLibrary = defineTool({
  name: "list_library",
  title: "List library",
  description:
    "Return the merged Library catalog the editor's `GET /api/library` exposes: every template / behavior / scene / asset / font from the global pool (`~/.davidup/library` by default) AND the active project's `library/` directory. Each item carries `scope` (`project` | `global`), an `overridden: true` flag on the *loser* of a (kind, id) collision (project beats global), and `thumbnailUrl` = `/api/library/thumbnail?kind=<kind>&id=<id>` — the same image URL the Library panel renders. Optional filters: `q` (substring over id/name/description), `kind`, `scope`. Errors with E_UNKNOWN if the MCP server is not hosted inside an editor.",
  inputSchema: {
    q: z.string().min(1).optional(),
    kind: LIBRARY_ITEM_KIND.optional(),
    scope: LIBRARY_SCOPE.optional(),
  },
  handler: async (args, deps) => {
    const ctrl = requireLibraryControls(deps);
    const listArgs: LibraryListArgs = {};
    if (args.q !== undefined) listArgs.q = args.q;
    if (args.kind !== undefined) listArgs.kind = args.kind;
    if (args.scope !== undefined) listArgs.scope = args.scope;
    return ctrl.list(listArgs);
  },
});

const createProject = defineTool({
  name: "create_project",
  title: "Create project",
  description:
    "Scaffold a fresh project at `<location>/<name>` (using the optional `template`, default 'basic') and load it. Routes through the same controller path as POST /api/projects in the UI: same path guard, same scaffold error codes (E_TARGET_NOT_EMPTY → E_INVALID_VALUE, E_TEMPLATE_NOT_FOUND → E_NOT_FOUND), and the same recents bump on success. `name` doubles as the recents-list label.",
  inputSchema: {
    name: z.string().min(1),
    location: z.string().min(1),
    template: z.string().min(1).optional(),
  },
  handler: async (args, deps) => {
    const ctrl = requireProjectControls(deps);
    const project = await ctrl.create({
      name: args.name,
      location: args.location,
      ...(args.template !== undefined ? { template: args.template } : {}),
    });
    return { project };
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
  // 4.5b — behaviors
  applyBehavior,
  listBehaviorsTool,
  // 4.5c — templates
  applyTemplate,
  listTemplatesTool,
  defineUserTemplate,
  // 4.5d — scenes
  defineScene,
  importScene,
  listScenesTool,
  removeScene,
  addSceneInstance,
  updateSceneInstance,
  removeSceneInstanceTool,
  // 4.6
  renderPreviewFrameTool,
  renderThumbnailStripTool,
  renderToVideo,
  getRender,
  listRenders,
  // 4.7 — project lifecycle (polish §20.29)
  currentProject,
  listProjects,
  openProject,
  createProject,
  // 4.8 — library (polish §20.30)
  listLibrary,
];

export const TOOL_NAMES: ReadonlyArray<string> = TOOLS.map((t) => t.name);
