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
  type BehaviorDescriptor,
  type BehaviorParamDescriptor,
} from "../compose/behaviors.js";
// Side-effect import: registers v0.3 built-in templates with the global
// registry so `apply_template` and `list_templates` see them out of the box.
import "../compose/builtInTemplates.js";
import { precompile } from "../compose/precompile.js";
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
import { RefResolutionError } from "../compose/imports.js";
import {
  renderToFile,
  checkContainerCodec,
  COLOR_PROFILES,
  VIDEO_CODECS,
  type ColorProfile,
  type RenderRange,
  type VideoCodec,
  probeAudio as defaultProbeAudio,
  probeVideo as defaultProbeVideo,
  FfprobeUnavailableError,
  type AudioMetadata,
  type VideoMetadata,
} from "../drivers/node/index.js";
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_ID,
  isBundledFontId,
} from "../assets/bundled.js";
import { EASING_NAMES, PARAMETRIC_EASINGS } from "../easings/index.js";
import { EFFECT_TWEENABLE, listTweenable } from "../schema/tweenable.js";
import {
  checkDimensions,
  type ValidationError,
  type ValidationWarning,
} from "../schema/validator.js";
import type { FontAsset, Tween } from "../schema/types.js";
import {
  AUDIO_ASSET_EXTENSIONS,
  VIDEO_ASSET_EXTENSIONS,
  VIDEO_FIT_MODES,
  BLEND_MODES,
  BlendModeSchema,
  COMPOSITION_VERSION,
  EFFECT_TYPES,
  EasingSchema,
  FpsSchema,
  isSupportedAudioSrc,
  isSupportedVideoSrc,
} from "../schema/zod.js";
import { strictObject } from "../schema/strict.js";
import { MCPToolError } from "./errors.js";
import {
  renderPreviewFrame,
  renderThumbnailStrip,
  THUMBNAIL_STRIP_MAX_COUNT,
  type PreviewResult,
  type PreviewSkiaModule,
  type ThumbnailStripResult,
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
// returns from `GET /api/library`. Mirroring the HTTP response shape means
// agents see exactly what humans see in the Library panel. Thumbnails are
// fetched on demand via the `get_library_thumbnail` tool (returns base64
// inline) — relative HTTP URLs are useless to MCP clients with no base.

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

export interface LibraryThumbnailArgs {
  kind: MCPLibraryItemKind;
  id: string;
}

export interface MCPLibraryThumbnail {
  /** Base64-encoded PNG. */
  image: string;
  mimeType: "image/png";
  width: number;
  height: number;
  /** True when the renderer fell back to a synthesized placeholder. */
  placeholder: boolean;
}

export interface LibraryControls {
  list(args: LibraryListArgs): Promise<MCPLibraryCatalog> | MCPLibraryCatalog;
  thumbnail(
    args: LibraryThumbnailArgs,
  ): Promise<MCPLibraryThumbnail> | MCPLibraryThumbnail;
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
  codec?: VideoCodec;
  crf?: number;
  preset?: string;
  pixFmt?: string;
  movflagsFaststart?: boolean;
  colorProfile?: ColorProfile;
  /** Render only `[from, to)` seconds of the timeline (v1.1 S12). */
  range?: RenderRange;
}

export interface RenderControls {
  start(args: MCPRenderStartArgs): Promise<MCPRenderJobSnapshot> | MCPRenderJobSnapshot;
  get(jobId: string): Promise<MCPRenderJobSnapshot | null> | MCPRenderJobSnapshot | null;
  list(): Promise<MCPRenderJobSnapshot[]> | MCPRenderJobSnapshot[];
  /** Resolves once the job is terminal (done or error). Never rejects. */
  waitFor(jobId: string): Promise<MCPRenderJobSnapshot>;
  /**
   * Cancel a non-terminal job. Returns the post-cancel snapshot (terminal
   * status). Resolves to `null` if the jobId is unknown so handlers can
   * surface E_NOT_FOUND uniformly.
   *
   * The underlying ffmpeg subprocess may continue running until it exits on
   * its own — the editor's worker marks the job terminal immediately and
   * leaves the orphan output behind, matching the project-switch abort path.
   */
  cancel(
    jobId: string,
    reason?: string,
  ): Promise<MCPRenderJobSnapshot | null> | MCPRenderJobSnapshot | null;
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
  // Audio metadata probe for `register_asset` (v0.2 §S2). Injected by tests to
  // avoid spawning ffprobe; production leaves it unset and the tool spawns the
  // bundled `ffprobe-static` binary via the node driver.
  probeAudio?: (src: string) => Promise<AudioMetadata>;
  // Video metadata probe for `register_asset` (v0.2 §S6). Same injection
  // contract as `probeAudio`.
  probeVideo?: (src: string) => Promise<VideoMetadata>;
  // R-29 idle TTL the standalone server was started with (`--session-ttl`);
  // surfaced by `list_engine_capabilities.server.sessionIdleSeconds`.
  sessionIdleSeconds?: number;
}

function requireProjectControls(deps: ToolDeps): ProjectControls {
  if (!deps.projectControls) {
    throw new MCPToolError(
      "E_FEATURE_UNAVAILABLE",
      "Project lifecycle tools are not available on this MCP server.",
      "Connect through the editor (`davidup edit`) — the standalone engine server has no project concept.",
    );
  }
  return deps.projectControls;
}

function requireLibraryControls(deps: ToolDeps): LibraryControls {
  if (!deps.libraryControls) {
    throw new MCPToolError(
      "E_FEATURE_UNAVAILABLE",
      "Library tools are not available on this MCP server.",
      "Connect through the editor (`davidup edit`) — the standalone engine server has no library service.",
    );
  }
  return deps.libraryControls;
}

function requireRenderControls(deps: ToolDeps): RenderControls {
  if (!deps.renderControls) {
    throw new MCPToolError(
      "E_FEATURE_UNAVAILABLE",
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

export interface ToolImageContent {
  data: string; // base64
  mimeType: string;
}

export interface ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  // Handlers receive args already parsed by the SDK against inputSchema.
  // We re-validate with our own object here so direct callers (tests,
  // examples) can use the dispatcher without going through the SDK.
  handler: (args: z.infer<z.ZodObject<Shape>>, deps: ToolDeps) => Promise<unknown> | unknown;
  // R-17 — optional escape hatch for tools whose payload embeds base64 image
  // bytes (preview / thumbnail renders). The handler's return value stays a
  // plain, transport-agnostic object (so direct callers and tests keep
  // seeing `{ image, mimeType, ... }`); `toImages` tells server.ts — the one
  // place that knows about MCP `CallToolResult` shape — how to split that
  // object into real MCP image content blocks plus a base64-free metadata
  // object for the trailing text block / structuredContent. Without this,
  // image bytes sit inert inside a JSON text blob: vision-capable MCP
  // clients don't render that as an image, and it doubles response size for
  // clients that do read structuredContent.
  toImages?: (result: unknown) => { images: ToolImageContent[]; metadata: unknown };
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
// Text v2 (v1.1 S13/S14) — mirrors TextItemSchema in src/schema/zod.ts.
const FONT_WEIGHT = z
  .union([z.enum(["normal", "bold"]), z.number().int().min(1).max(1000)])
  .describe('"normal" | "bold" | 1..1000');
const FONT_STYLE = z.enum(["normal", "italic", "oblique"]);
const TEXT_SHADOW = z
  .object({
    color: HEX_COLOR,
    blur: z.number().nonnegative().optional(),
    offsetX: z.number().optional(),
    offsetY: z.number().optional(),
  })
  .describe("Drop shadow cast by the fill. Offsets are canvas px, unaffected by rotation/scale.");
// Per-item effects (v1.1 S21) — mirrors EffectSchema in src/schema/zod.ts.
// Each variant spelled out here (not reused) so the tool JSON Schema carries
// the descriptions instead of a bare `$ref`.
const EFFECT = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("blur"),
      radius: z.number().nonnegative().describe("Gaussian σ in canvas px (CSS blur() radius)"),
    }),
    z.object({
      type: z.literal("shadow"),
      color: HEX_COLOR,
      blur: z.number().nonnegative().optional().describe("Canvas2D shadowBlur (2σ), like the text shadow"),
      offsetX: z.number().optional(),
      offsetY: z.number().optional(),
    }),
    z.object({
      type: z.literal("glow"),
      color: HEX_COLOR,
      radius: z.number().nonnegative().describe("Halo σ in canvas px"),
    }),
  ])
  .describe(
    "One visual effect. Lengths are canvas px, unaffected by the item's rotation/scale.",
  );
const EFFECTS = z
  .array(EFFECT)
  .describe(
    "Ordered effect stack, applied to the flattened item (a group with all its children) " +
      "before its opacity: a shadow listed after a blur is cast by the blurred item; two glows stack. " +
      "Tween a parameter with property `effects.<index>.<field>`, e.g. `effects.0.radius`.",
  );
const POINTS = z
  .array(z.tuple([z.number(), z.number()]))
  .describe("Polygon points as [[x,y], ...]");

// ──────────────── 4.1 Composition lifecycle ────────────────

const createComposition = defineTool({
  name: "create_composition",
  title: "Create composition",
  description:
    "Create a new composition. Becomes the default composition if none exists. Returns the assigned compositionId. " +
    "State lives in the server process, so an E_DUPLICATE_ID on an `id` you haven't used means a previous " +
    "conversation left it behind — call `reset` (or pass a fresh `id`). " +
    "width and height must be EVEN (the H.264/yuv420p encoder rejects odd sizes); an odd or >4096px size still " +
    "creates the composition but the response carries `issues` (E_DIMENSION_ODD) / `warnings` (W_DIMENSION_LARGE) " +
    "— the same codes `validate` reports, and E_DIMENSION_ODD blocks rendering.",
  inputSchema: {
    width: z.number().int().positive().describe("Canvas width in px. Must be even."),
    height: z.number().int().positive().describe("Canvas height in px. Must be even."),
    fps: FpsSchema.describe(
      'Frames per second: a positive number (24, 30, 60) or an exact rational string "N/D" ' +
        '("24000/1001", "30000/1001", "60000/1001" for NTSC 23.976 / 29.97 / 59.94).',
    ),
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
    return { compositionId, ...dimensionIssues(args.width, args.height) };
  },
});

// Eager B-2 feedback: the dimension subset of `validate`, attached to the
// create/set response only when non-empty so a clean call's shape is unchanged.
function dimensionIssues(
  width: number,
  height: number,
): { issues?: ValidationError[]; warnings?: ValidationWarning[] } {
  const { errors, warnings } = checkDimensions(width, height);
  return {
    ...(errors.length > 0 ? { issues: errors } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

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
    "Update one of width/height/fps/duration/background/audioMaster on the composition. fps takes a positive number or an " +
    'exact rational string "N/D" (e.g. "30000/1001"). audioMaster takes `{ limiter?: boolean, targetLufs?: number }` ' +
    "(or null to reset): the master bus after all audio tracks are mixed — a -1 dBFS limiter, ON unless `limiter: false`, " +
    "and an optional two-pass loudness normalisation to `targetLufs` in [-70, -5] (e.g. -14 streaming, -16 web, -23 broadcast; " +
    "costs one extra ffmpeg analysis pass at render). width and height must be EVEN " +
    "(H.264/yuv420p); after a width/height change that leaves an odd or >4096px canvas the response carries " +
    "`issues` (E_DIMENSION_ODD, blocks rendering) / `warnings` (W_DIMENSION_LARGE).",
  inputSchema: {
    property: z.enum(["width", "height", "fps", "duration", "background", "audioMaster"]),
    value: z.union([
      z.number(),
      z.string(),
      z
        .object({
          limiter: z.boolean().optional(),
          targetLufs: z.number().min(-70).max(-5).optional(),
        })
        .strict(),
      z.null(),
    ]),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    store.setMetaProperty(
      args.property as SetMetaPropertyName,
      args.value,
      args.compositionId,
    );
    if (args.property !== "width" && args.property !== "height") {
      return { ok: true as const };
    }
    const { width, height } = store.toJSON(args.compositionId).composition;
    return { ok: true as const, ...dimensionIssues(width, height) };
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
  title: "Reset server state",
  description:
    "Start clean. With no arguments, drops every composition AND the user templates, scenes and behaviors defined " +
    "this session (`scope: \"compositions\"` keeps those registries). With `compositionId`, drops only that " +
    "composition. State lives in the server process and can outlive a conversation (unless the server runs with " +
    "an idle TTL — see `list_engine_capabilities.server.sessionIdleSeconds`), so call this first if you can't " +
    "assume a clean slate.",
  inputSchema: {
    compositionId: COMPOSITION_ID,
    scope: z
      .enum(["compositions", "all"])
      .optional()
      .describe('What to clear when no compositionId is given. Default "all" (compositions + user registries).'),
  },
  handler: (args, { store }) => {
    store.reset(args.compositionId, args.scope ?? "all");
    return { ok: true as const };
  },
});

// ──────────────── 4.2 Assets ────────────────

// Video warning policy (v0.2 §S6). All bounds are advisory — the asset still
// registers; `register_asset` just surfaces a `warnings` entry so the author
// knows the clip may be heavy to decode/render:
//   - resolution at or above 4K UHD (3840×2160) — large frames are expensive
//   - duration beyond 60s — long clips inflate render time and memory
//   - an exotic codec that commonly lacks hardware decode (notably AV1)
const VIDEO_WARN_WIDTH = 3840;
const VIDEO_WARN_HEIGHT = 2160;
const VIDEO_WARN_DURATION_S = 60;
const EXOTIC_VIDEO_CODECS = new Set(["av1"]);

/** Warnings derived from probed video metadata (resolution / duration / codec). */
function videoMetadataWarnings(meta: VideoMetadata): string[] {
  const warnings: string[] = [];
  if (
    (meta.width !== undefined && meta.width >= VIDEO_WARN_WIDTH) ||
    (meta.height !== undefined && meta.height >= VIDEO_WARN_HEIGHT)
  ) {
    warnings.push(
      `Video resolution ${meta.width ?? "?"}×${meta.height ?? "?"} is at or above 4K ` +
        `(${VIDEO_WARN_WIDTH}×${VIDEO_WARN_HEIGHT}) — large frames slow decode and render.`,
    );
  }
  if (meta.duration !== undefined && meta.duration > VIDEO_WARN_DURATION_S) {
    warnings.push(
      `Video duration ${meta.duration.toFixed(1)}s exceeds ${VIDEO_WARN_DURATION_S}s — ` +
        "long clips increase render time and memory.",
    );
  }
  if (meta.codec !== undefined && EXOTIC_VIDEO_CODECS.has(meta.codec)) {
    warnings.push(
      `Video codec "${meta.codec}" may lack hardware decode on the target machine — ` +
        "decoding can be slow; consider transcoding to H.264 if playback stutters.",
    );
  }
  return warnings;
}

const registerAsset = defineTool({
  name: "register_asset",
  title: "Register asset",
  description:
    "Register an image, font, audio, or video asset by id. Font assets require a `family`. " +
    `Audio assets accept ${AUDIO_ASSET_EXTENSIONS.join(", ")} and are probed with ffprobe to ` +
    "extract duration, sampleRate, channels, and codec. " +
    `Video assets accept ${VIDEO_ASSET_EXTENSIONS.join(", ")} and are probed for duration, width, ` +
    "height, fps, hasAlpha, codec, pixelFormat, and hasAudio; a `warnings` entry flags >=4K resolution, " +
    ">60s duration, or an exotic codec (e.g. AV1). For audio and video, if ffprobe is unavailable " +
    "the asset is registered without metadata and a `warnings` entry is returned.",
  inputSchema: {
    id: z.string().min(1),
    type: z.enum(["image", "font", "audio", "video"]),
    src: z.string().min(1),
    family: z.string().min(1).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: async (args, deps) => {
    const { store } = deps;
    if (args.type === "audio") {
      const warnings: string[] = [];
      let metadata: AudioMetadata = {};
      // Probe only supported containers — an unsupported src is rejected by
      // store.registerAsset below, so skip the wasted subprocess.
      if (isSupportedAudioSrc(args.src)) {
        const probe = deps.probeAudio ?? defaultProbeAudio;
        try {
          metadata = await probe(args.src);
        } catch (err) {
          if (err instanceof FfprobeUnavailableError) {
            warnings.push(
              "ffprobe not found — audio asset registered without metadata " +
                "(duration, sampleRate, channels, codec). Install ffmpeg/ffprobe to enable extraction.",
            );
          } else {
            warnings.push(
              `ffprobe could not read "${args.src}": ${
                err instanceof Error ? err.message : String(err)
              }. Audio asset registered without metadata.`,
            );
          }
        }
      }
      store.registerAsset(
        { id: args.id, type: "audio", src: args.src, ...metadata },
        args.compositionId,
      );
      return warnings.length > 0
        ? { ok: true as const, warnings }
        : { ok: true as const };
    }

    if (args.type === "video") {
      const warnings: string[] = [];
      let metadata: VideoMetadata = {};
      // Probe only supported containers — an unsupported src is rejected by
      // store.registerAsset below, so skip the wasted subprocess.
      if (isSupportedVideoSrc(args.src)) {
        const probe = deps.probeVideo ?? defaultProbeVideo;
        try {
          metadata = await probe(args.src);
        } catch (err) {
          if (err instanceof FfprobeUnavailableError) {
            warnings.push(
              "ffprobe not found — video asset registered without metadata " +
                "(duration, width, height, fps, hasAlpha, codec, pixelFormat). " +
                "Install ffmpeg/ffprobe to enable extraction.",
            );
          } else {
            warnings.push(
              `ffprobe could not read "${args.src}": ${
                err instanceof Error ? err.message : String(err)
              }. Video asset registered without metadata.`,
            );
          }
        }
      }
      // Advisory limit warnings only make sense once the probe succeeded.
      warnings.push(...videoMetadataWarnings(metadata));
      store.registerAsset(
        { id: args.id, type: "video", src: args.src, ...metadata },
        args.compositionId,
      );
      return warnings.length > 0
        ? { ok: true as const, warnings }
        : { ok: true as const };
    }

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
    "Add a layer with z-index. Optional opacity, blendMode, visible/locked flags, explicit id.",
  inputSchema: {
    id: z.string().min(1).optional(),
    z: z.number(),
    opacity: z.number().min(0).max(1).optional(),
    blendMode: BlendModeSchema.optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    name: z.string().max(80).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const layerId = store.addLayer(
      {
        z: args.z,
        ...(args.id !== undefined ? { id: args.id } : {}),
        ...(args.opacity !== undefined ? { opacity: args.opacity } : {}),
        ...(args.blendMode !== undefined ? { blendMode: args.blendMode } : {}),
        ...(args.visible !== undefined ? { visible: args.visible } : {}),
        ...(args.locked !== undefined ? { locked: args.locked } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
      },
      args.compositionId,
    );
    return { layerId };
  },
});

const updateLayer = defineTool({
  name: "update_layer",
  title: "Update layer",
  description:
    "Patch a layer's z, opacity, blendMode, visibility, or lock state. " +
    "`visible: false` hides the layer (and everything in it) from the renderer; " +
    "`locked: true` is a hint to the editor that the layer's contents should not " +
    "be edited (the engine ignores it).",
  inputSchema: {
    id: z.string().min(1),
    props: z.object({
      z: z.number().optional(),
      opacity: z.number().min(0).max(1).optional(),
      blendMode: BlendModeSchema.optional(),
      visible: z.boolean().optional(),
      locked: z.boolean().optional(),
      name: z.string().max(80).optional(),
      enter: z.number().nonnegative().optional(),
      exit: z.number().positive().optional(),
    }),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const props: UpdateLayerProps = {};
    if (args.props.z !== undefined) props.z = args.props.z;
    if (args.props.opacity !== undefined) props.opacity = args.props.opacity;
    if (args.props.blendMode !== undefined) props.blendMode = args.props.blendMode;
    if (args.props.visible !== undefined) props.visible = args.props.visible;
    if (args.props.locked !== undefined) props.locked = args.props.locked;
    if (args.props.name !== undefined) props.name = args.props.name;
    if (args.props.enter !== undefined) props.enter = args.props.enter;
    if (args.props.exit !== undefined) props.exit = args.props.exit;
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
  description:
    "Add a sprite item to a layer. Coordinates `x`/`y` are in pixels with origin at the composition's top-left and positive y pointing down. `anchorX`/`anchorY` are fractional in 0..1 of the item's width/height (0=left/top, 0.5=center, 1=right/bottom) and act as the pivot for rotation and scale. `rotation` is in radians, clockwise — multiply degrees by Math.PI/180.",
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
    name: z.string().max(80).optional(),
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
        ...(args.name !== undefined ? { name: args.name } : {}),
      },
      args.compositionId,
    );
    return { itemId };
  },
});

const addText = defineTool({
  name: "add_text",
  title: "Add text item",
  description:
    "Add a text item to a layer. `font` is optional: omit it (or pass `\"font:default\"`) to use the bundled Inter Regular, " +
    "which needs no `register_asset`. Otherwise `font` is the `id` of a font asset registered via `register_asset` " +
    '(`type: "font"`) or present in the editor Library — NOT a CSS font-family name like "Arial" or "sans-serif". ' +
    "`list_fonts` shows what's available. Coordinates `x`/`y` are in pixels with origin at the composition's top-left and positive y pointing down. " +
    "`text` may contain `\\n` line breaks. Layout has two modes: POINT mode (no `maxWidth`, anchor 0,0) puts the first line's " +
    "baseline at (x, y) with lines aligned around x per `align`; BOX mode (`maxWidth` set, or any non-zero anchor) makes (x, y) the " +
    "top-left of the text block, word-wraps at `maxWidth`, and `anchorX`/`anchorY` become fractions of the measured block " +
    "(0.5/0.5 centres the block on x,y) acting as the pivot for rotation and scale. `lineHeight` is a multiple of fontSize " +
    "(default 1.2); `letterSpacing` is extra px between glyphs; `strokeColor`/`strokeWidth` outline the glyphs over the fill; " +
    "`shadow` casts a drop shadow. `letterSpacing`, `lineHeight` and `strokeWidth` are tweenable. `rotation` is in radians, clockwise — multiply degrees by Math.PI/180.",
  inputSchema: {
    layerId: z.string().min(1),
    text: z.string(),
    font: z.string().min(1).optional(),
    fontSize: z.number().positive(),
    color: HEX_COLOR,
    x: z.number(),
    y: z.number(),
    anchorX: z.number().optional(),
    anchorY: z.number().optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    maxWidth: z.number().positive().optional(),
    lineHeight: z.number().positive().optional(),
    letterSpacing: z.number().optional(),
    fontWeight: FONT_WEIGHT.optional(),
    fontStyle: FONT_STYLE.optional(),
    strokeColor: HEX_COLOR.optional(),
    strokeWidth: z.number().nonnegative().optional(),
    shadow: TEXT_SHADOW.optional(),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    id: z.string().min(1).optional(),
    name: z.string().max(80).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const itemId = store.addText(
      {
        layerId: args.layerId,
        text: args.text,
        font: args.font ?? DEFAULT_FONT_ID,
        fontSize: args.fontSize,
        color: args.color,
        x: args.x,
        y: args.y,
        ...(args.anchorX !== undefined ? { anchorX: args.anchorX } : {}),
        ...(args.anchorY !== undefined ? { anchorY: args.anchorY } : {}),
        ...(args.align !== undefined ? { align: args.align } : {}),
        ...(args.maxWidth !== undefined ? { maxWidth: args.maxWidth } : {}),
        ...(args.lineHeight !== undefined ? { lineHeight: args.lineHeight } : {}),
        ...(args.letterSpacing !== undefined ? { letterSpacing: args.letterSpacing } : {}),
        ...(args.fontWeight !== undefined ? { fontWeight: args.fontWeight } : {}),
        ...(args.fontStyle !== undefined ? { fontStyle: args.fontStyle } : {}),
        ...(args.strokeColor !== undefined ? { strokeColor: args.strokeColor } : {}),
        ...(args.strokeWidth !== undefined ? { strokeWidth: args.strokeWidth } : {}),
        ...(args.shadow !== undefined ? { shadow: args.shadow } : {}),
        ...(args.rotation !== undefined ? { rotation: args.rotation } : {}),
        ...(args.opacity !== undefined ? { opacity: args.opacity } : {}),
        ...(args.id !== undefined ? { id: args.id } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
      },
      args.compositionId,
    );
    return { itemId };
  },
});

const addShape = defineTool({
  name: "add_shape",
  title: "Add shape item",
  description:
    "Add a rect / circle / polygon shape item. Coordinates `x`/`y` are in pixels with origin at the composition's top-left and positive y pointing down. `anchorX`/`anchorY` (set via `update_item`) are fractional in 0..1 of the shape's bounding box (0=left/top, 0.5=center, 1=right/bottom) and act as the pivot for rotation and scale. `rotation` is in radians, clockwise — multiply degrees by Math.PI/180.",
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
    anchorX: z.number().optional(),
    anchorY: z.number().optional(),
    id: z.string().min(1).optional(),
    name: z.string().max(80).optional(),
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
        ...(args.anchorX !== undefined ? { anchorX: args.anchorX } : {}),
        ...(args.anchorY !== undefined ? { anchorY: args.anchorY } : {}),
        ...(args.id !== undefined ? { id: args.id } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
      },
      args.compositionId,
    );
    return { itemId };
  },
});

const addGroup = defineTool({
  name: "add_group",
  title: "Add group item",
  description:
    "Add a group item with optional initial child items list. Coordinates `x`/`y` are in pixels with origin at the composition's top-left and positive y pointing down; children are drawn relative to this group origin. The group's `anchorX`/`anchorY` (set via `update_item`) are fractional in 0..1 of the group's box (0=left/top, 0.5=center, 1=right/bottom) and pivot the group's rotation/scale. `rotation` (set via `update_item`) is in radians, clockwise — multiply degrees by Math.PI/180. " +
    "By default a group's opacity multiplies into each child separately, so fading a group with overlapping children shows their seams; set `isolate: true` to flatten the children first and fade the result once, as one layer. `blendMode` composites the group against what is already painted (once, if isolated; per child otherwise).",
  inputSchema: {
    layerId: z.string().min(1),
    x: z.number(),
    y: z.number(),
    childItemIds: z.array(z.string().min(1)).optional(),
    isolate: z.boolean().optional(),
    blendMode: BlendModeSchema.optional(),
    ...TRANSFORM_INPUT,
    id: z.string().min(1).optional(),
    name: z.string().max(80).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const itemId = store.addGroup(
      {
        layerId: args.layerId,
        x: args.x,
        y: args.y,
        ...(args.childItemIds !== undefined ? { childItemIds: args.childItemIds } : {}),
        ...(args.isolate !== undefined ? { isolate: args.isolate } : {}),
        ...(args.blendMode !== undefined ? { blendMode: args.blendMode } : {}),
        ...(args.anchorX !== undefined ? { anchorX: args.anchorX } : {}),
        ...(args.anchorY !== undefined ? { anchorY: args.anchorY } : {}),
        ...(args.rotation !== undefined ? { rotation: args.rotation } : {}),
        ...(args.opacity !== undefined ? { opacity: args.opacity } : {}),
        ...(args.scaleX !== undefined ? { scaleX: args.scaleX } : {}),
        ...(args.scaleY !== undefined ? { scaleY: args.scaleY } : {}),
        ...(args.id !== undefined ? { id: args.id } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
      },
      args.compositionId,
    );
    return { itemId };
  },
});

// Strict (v1.1 S23, R-23): a typo'd key (`opacty`) is E_INVALID_PROPERTY with
// a "did you mean" instead of being silently dropped — see dispatch.ts.
const ITEM_PROP_SHAPE = strictObject(
  {
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
    // Text v2. `null` clears maxWidth (back to point mode) / removes shadow.
    maxWidth: z.number().positive().nullable(),
    lineHeight: z.number().positive(),
    letterSpacing: z.number(),
    fontWeight: FONT_WEIGHT,
    fontStyle: FONT_STYLE,
    shadow: TEXT_SHADOW.nullable(),
    fillColor: z.string(),
    strokeColor: z.string(),
    strokeWidth: z.number().nonnegative(),
    cornerRadius: z.number().nonnegative(),
    points: POINTS,
    items: z.array(z.string().min(1)),
    // Group compositing (v1.1 S18). `isolate: false` / `blendMode: "normal"`
    // put the group back on the default multiplicative path.
    isolate: z.boolean(),
    blendMode: BlendModeSchema,
    // Per-item effects (v1.1 S21), every item type. Replaces the whole
    // stack; `null` or `[]` removes it.
    effects: EFFECTS.nullable(),
    // §M flags. Setting `visible: false` keeps the renderer from drawing the
    // item; `locked: true` is purely a hint to the editor.
    visible: z.boolean(),
    locked: z.boolean(),
    // §P friendly label — display-only; never replaces the id.
    name: z.string().max(80),
    // Lifespan: half-open [enter, exit) seconds on the composition timeline.
    // Out-of-window items are skipped by the renderer.
    enter: z.number().nonnegative(),
    exit: z.number().positive(),
  },
  { extensions: false },
).partial();

const updateItem = defineTool({
  name: "update_item",
  title: "Update item",
  description:
    "Patch an item's transform fields and/or type-specific properties. An unknown key, or one the item type " +
    "doesn't take, is E_INVALID_PROPERTY (with a \"did you mean\" for typos). " +
    "Text items accept the text v2 fields (maxWidth, lineHeight, letterSpacing, fontWeight, fontStyle, strokeColor, " +
    "strokeWidth, shadow — see add_text); pass `maxWidth: null` to drop back to point mode or `shadow: null` to remove the shadow. " +
    "Group items accept `isolate` and `blendMode` (see add_group). " +
    "Every item type accepts `effects`, an ordered stack of `{type:\"blur\",radius}`, " +
    "`{type:\"shadow\",color,blur?,offsetX?,offsetY?}` and `{type:\"glow\",color,radius}` — it replaces the " +
    "whole stack, and `null` or `[]` removes it. Tween an effect with property `effects.<index>.<field>`.",
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

const EASING_DESCRIPTION =
  "Easing curve, default linear: a name from list_easings, { bezier: [x1, y1, x2, y2] } (CSS cubic-bezier; x1 and x2 in [0, 1], y may overshoot) or { steps: n } (CSS steps(n), integer n ≥ 1).";

// Fresh copies so an in-process caller can't mutate the shared descriptors.
function parametricEasings() {
  return PARAMETRIC_EASINGS.map((p) => ({ ...p, example: structuredClone(p.example) }));
}

const addTween = defineTool({
  name: "add_tween",
  title: "Add tween",
  description:
    "Add a property tween. Errors if it overlaps another tween on the same (target, property). " +
    "An item's effect parameters tween as `effects.<index>.<field>` (see update_item).",
  inputSchema: {
    target: z.string().min(1),
    property: z.string().min(1),
    from: TWEEN_VALUE,
    to: TWEEN_VALUE,
    start: z.number().nonnegative(),
    duration: z.number().positive(),
    easing: EasingSchema.optional().describe(EASING_DESCRIPTION),
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
        easing: EasingSchema.describe(EASING_DESCRIPTION),
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

// ──────────────── 4.5a Audio tracks (v0.2 §S3) ────────────────

// Audio is composition-level (a sibling of `tweens`, not an item): every track
// is an explicitly declared external asset, never derived from video. `[start,
// end)` are composition seconds; an omitted `end` plays the asset out to its
// natural duration (resolved at mux time, S4). The store rejects a track that
// references a missing or non-audio asset (E_NOT_FOUND / E_ASSET_TYPE_MISMATCH)
// but only *warns* when the track runs past the composition end — placement is
// trimmed at mux, not rejected (plan Q6).
const AUDIO_VOLUME = z
  .number()
  .min(0)
  .max(2)
  .describe("Linear gain multiplier in [0, 2] (1 = unchanged, 0 = silent, 2 = +6dB).");
const AUDIO_FADE = z
  .number()
  .nonnegative()
  .describe("Fade ramp length in seconds.");
const AUDIO_LOOP = z
  .boolean()
  .describe(
    "Repeat the source (from `trimIn`) until `end`, or until the composition end when `end` is omitted — for music beds under a longer clip.",
  );

const addAudioTrack = defineTool({
  name: "add_audio_track",
  title: "Add audio track",
  description:
    "Add an external audio track to the composition timeline. `asset` must be a registered audio asset (E_NOT_FOUND if unknown, E_ASSET_TYPE_MISMATCH if it isn't audio). `end` is optional — omit it to play the asset out to its natural duration. `trimIn` seeks into the source file before playback starts, independent of timeline placement — e.g. `{ start: 2, trimIn: 10 }` places the clip at composition second 2 but begins reading the source file at its 10s mark. `loop: true` repeats the source until `end` (or the composition end). All tracks are summed through a master limiter so overlaps can't clip — see set_composition_property `audioMaster`. Returns the assigned `audioTrackId`, plus a `warnings` array when the track extends past the composition end (it is trimmed at mux time, never rejected).",
  inputSchema: {
    asset: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().optional(),
    trimIn: z.number().nonnegative().optional().describe(
      "Seconds into the source file to start reading from (in-source offset — a track can start mid-file). Independent of `start`/`end`, which place the clip on the composition timeline.",
    ),
    volume: AUDIO_VOLUME.optional(),
    fadeIn: AUDIO_FADE.optional(),
    fadeOut: AUDIO_FADE.optional(),
    loop: AUDIO_LOOP.optional(),
    id: z.string().min(1).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const { id, warnings } = store.addAudioTrack(
      {
        asset: args.asset,
        start: args.start,
        ...(args.end !== undefined ? { end: args.end } : {}),
        ...(args.trimIn !== undefined ? { trimIn: args.trimIn } : {}),
        ...(args.volume !== undefined ? { volume: args.volume } : {}),
        ...(args.fadeIn !== undefined ? { fadeIn: args.fadeIn } : {}),
        ...(args.fadeOut !== undefined ? { fadeOut: args.fadeOut } : {}),
        ...(args.loop !== undefined ? { loop: args.loop } : {}),
        ...(args.id !== undefined ? { id: args.id } : {}),
      },
      args.compositionId,
    );
    return warnings.length > 0
      ? { audioTrackId: id, warnings }
      : { audioTrackId: id };
  },
});

const updateAudioTrack = defineTool({
  name: "update_audio_track",
  title: "Update audio track",
  description:
    "Patch fields on an existing audio track. Re-checks the (new) asset is audio and re-evaluates the past-composition-end warning. Returns `{ ok: true }`, plus a `warnings` array when the resulting placement extends past the composition end.",
  inputSchema: {
    id: z.string().min(1),
    props: z
      .object({
        asset: z.string().min(1),
        start: z.number().nonnegative(),
        end: z.number(),
        trimIn: z.number().nonnegative(),
        volume: AUDIO_VOLUME,
        fadeIn: AUDIO_FADE,
        fadeOut: AUDIO_FADE,
        loop: AUDIO_LOOP,
      })
      .partial(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const { warnings } = store.updateAudioTrack(
      args.id,
      stripUndefined(args.props),
      args.compositionId,
    );
    return warnings.length > 0
      ? { ok: true as const, warnings }
      : { ok: true as const };
  },
});

const removeAudioTrack = defineTool({
  name: "remove_audio_track",
  title: "Remove audio track",
  description: "Remove an audio track by id.",
  inputSchema: {
    id: z.string().min(1),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    store.removeAudioTrack(args.id, args.compositionId);
    return { ok: true as const };
  },
});

const listAudioTracks = defineTool({
  name: "list_audio_tracks",
  title: "List audio tracks",
  description:
    "List the composition's audio tracks in declaration order, optionally filtered by `asset`.",
  inputSchema: {
    asset: z.string().min(1).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const filter: { asset?: string } = {};
    if (args.asset !== undefined) filter.asset = args.asset;
    return { audioTracks: store.listAudioTracks(filter, args.compositionId) };
  },
});

// ──────────────── 4.4a Video items (v0.2 §S9) ────────────────

// A video item is spatially a sprite (same `x`/`y` + `width`/`height` box +
// transform) plus a temporal window on the composition timeline and a trim into
// the source. Silent by default (audio comes from add_audio_track); `keepAudio`
// (v1.1 S11) muxes the clip's own audio stream instead. Generic update_item
// still patches the spatial surface; update_video below is the full-fidelity patcher that also reaches the
// temporal/display fields. remove_item / move_item_to_layer work unchanged
// (they address any item by id). Tween x/y/opacity/width/height via add_tween
// exactly like a sprite (see list_engine_capabilities.tweenable.video).
const VIDEO_FIT = z
  .enum(VIDEO_FIT_MODES)
  .describe(
    "How the decoded frame fills the [width, height] box (CSS object-fit): cover | contain (default) | fill | none.",
  );

const addVideo = defineTool({
  name: "add_video",
  title: "Add video item",
  description:
    "Add a video clip item to a layer. `asset` must be a registered video asset (E_NOT_FOUND if unknown, E_ASSET_TYPE_MISMATCH if it isn't video). Coordinates `x`/`y` are pixels from the composition top-left (y down). `width`/`height` default to the composition size (so the clip fills the frame; with fit=contain it letterboxes, never overflows). `start` (default 0) and optional `end` are composition seconds; `trimIn`/`trimOut` slice [trimIn, trimOut) out of the source; `fit` defaults to \"contain\"; `loop` (default false) replays the trimmed source when `end` outlasts it; `keepAudio` (default false) muxes the clip's own audio stream at render, mirroring start/end/trimIn/trimOut (no separate add_audio_track needed). `layerId` is optional — omit it to drop the clip on the topmost layer. Returns the assigned `itemId`, plus a `warnings` array when the clip's window extends past the composition end (cut at render, never rejected).",
  inputSchema: {
    layerId: z.string().min(1).optional(),
    asset: z.string().min(1),
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative().optional(),
    height: z.number().nonnegative().optional(),
    ...TRANSFORM_INPUT,
    start: z.number().nonnegative().optional(),
    end: z.number().positive().optional(),
    trimIn: z.number().nonnegative().optional(),
    trimOut: z.number().positive().optional(),
    fit: VIDEO_FIT.optional(),
    loop: z.boolean().optional(),
    keepAudio: z.boolean().optional(),
    id: z.string().min(1).optional(),
    name: z.string().max(80).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const { itemId, warnings } = store.addVideo(
      {
        asset: args.asset,
        x: args.x,
        y: args.y,
        ...(args.layerId !== undefined ? { layerId: args.layerId } : {}),
        ...(args.width !== undefined ? { width: args.width } : {}),
        ...(args.height !== undefined ? { height: args.height } : {}),
        ...(args.anchorX !== undefined ? { anchorX: args.anchorX } : {}),
        ...(args.anchorY !== undefined ? { anchorY: args.anchorY } : {}),
        ...(args.rotation !== undefined ? { rotation: args.rotation } : {}),
        ...(args.opacity !== undefined ? { opacity: args.opacity } : {}),
        ...(args.scaleX !== undefined ? { scaleX: args.scaleX } : {}),
        ...(args.scaleY !== undefined ? { scaleY: args.scaleY } : {}),
        ...(args.start !== undefined ? { start: args.start } : {}),
        ...(args.end !== undefined ? { end: args.end } : {}),
        ...(args.trimIn !== undefined ? { trimIn: args.trimIn } : {}),
        ...(args.trimOut !== undefined ? { trimOut: args.trimOut } : {}),
        ...(args.fit !== undefined ? { fit: args.fit } : {}),
        ...(args.loop !== undefined ? { loop: args.loop } : {}),
        ...(args.keepAudio !== undefined ? { keepAudio: args.keepAudio } : {}),
        ...(args.id !== undefined ? { id: args.id } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
      },
      args.compositionId,
    );
    return warnings.length > 0 ? { itemId, warnings } : { itemId };
  },
});

const updateVideo = defineTool({
  name: "update_video",
  title: "Update video item",
  description:
    "Patch any field of a video item — spatial (`x`/`y`/`scaleX`/`scaleY`/`rotation`/`anchorX`/`anchorY`/`opacity`/`width`/`height`/`asset`), temporal (`start`/`end`/`trimIn`/`trimOut`), display (`fit`/`loop`), audio (`keepAudio`), and flags (`visible`/`locked`/`name`/`enter`/`exit`). Errors with E_NOT_FOUND if the id is unknown, E_INVALID_PROPERTY if it isn't a video item or a prop key is unknown, E_ASSET_TYPE_MISMATCH if a new `asset` isn't video, and E_INVALID_VALUE on a bad trim/timing window. Returns `{ ok: true }`, plus a `warnings` array when the resulting window extends past the composition end.",
  inputSchema: {
    id: z.string().min(1),
    props: strictObject(
      {
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
        start: z.number().nonnegative(),
        end: z.number().positive(),
        trimIn: z.number().nonnegative(),
        trimOut: z.number().positive(),
        fit: VIDEO_FIT,
        loop: z.boolean(),
        keepAudio: z.boolean(),
        visible: z.boolean(),
        locked: z.boolean(),
        name: z.string().max(80),
        enter: z.number().nonnegative(),
        exit: z.number().positive(),
      },
      { extensions: false },
    ).partial(),
    compositionId: COMPOSITION_ID,
  },
  handler: (args, { store }) => {
    const { warnings } = store.updateVideo(
      args.id,
      stripUndefined(args.props),
      args.compositionId,
    );
    return warnings.length > 0
      ? { ok: true as const, warnings }
      : { ok: true as const };
  },
});

// ──────────────── 4.5b Behaviors (§6.7) ────────────────

const applyBehavior = defineTool({
  name: "apply_behavior",
  title: "Apply behavior",
  description:
    "Expand a behavior into one or more tweens — a built-in, a library behavior, or one defined in this session with define_user_behavior. Each emitted tween is added to the store under a deterministic id; ordinary overlap and property-validity checks apply. A behavior registered without a `tweens` body is catalog metadata and throws E_BEHAVIOR_UNKNOWN.",
  inputSchema: {
    target: z.string().min(1),
    behavior: z.string().min(1),
    start: z.number().nonnegative(),
    duration: z.number().positive(),
    params: z.record(z.string(), z.unknown()).optional(),
    easing: EasingSchema.optional().describe(
      `${EASING_DESCRIPTION} Applies to every emitted tween that doesn't pin its own.`,
    ),
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
    // Session definitions shadow the process-global registry, so one MCP
    // session's `define_user_behavior` never leaks into another's expansion.
    const tweens = expandBehavior(block, {
      behaviors: store.userBehaviorRecord(),
    });
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
    "List the behaviors available for apply_behavior — built-ins and library behaviors from the process-global registry merged with any session-scoped definitions added via define_user_behavior (session entries shadow globals on name collision). Each descriptor carries its parameters, the tween suffixes it produces, and `executable`: false means it is catalog metadata with no `tweens` body and apply_behavior will throw E_BEHAVIOR_UNKNOWN.",
  inputSchema: {},
  handler: (_args, { store }) => {
    const merged = new Map<string, BehaviorDescriptor>();
    for (const d of listBehaviors()) merged.set(d.name, d);
    for (const d of store.listUserBehaviors()) merged.set(d.name, d);
    return { behaviors: Array.from(merged.values()) };
  },
});

const BEHAVIOR_PARAM_TYPE = z.enum(["number", "string", "color", "colorArray", "axis"]);

const BEHAVIOR_PARAM_DESCRIPTOR = z.object({
  name: z.string().min(1),
  type: BEHAVIOR_PARAM_TYPE,
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  description: z.string().optional(),
});

const defineUserBehavior = defineTool({
  name: "define_user_behavior",
  title: "Define user behavior",
  description:
    "Register a user-authored behavior scoped to this MCP session — define once, apply_behavior it N times. Last write wins per name, and session definitions take precedence over the built-in / library-loaded global registry on the same name. Definitions do not leak to other MCP sessions sharing the same backend. " +
    "Give it a `tweens` body and it expands for real; omit the body and it stays catalog metadata that apply_behavior rejects with E_BEHAVIOR_UNKNOWN (unless the name shadows a built-in, whose expansion it then keeps).",
  inputSchema: {
    name: z.string().min(1),
    description: z.string().optional(),
    params: z.array(BEHAVIOR_PARAM_DESCRIPTOR).optional(),
    tweens: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe(
        "Executable body: the tweens one apply_behavior call emits. Each entry takes `property`, `from`, `to` and optional `start` / `duration` / `easing` / `suffix` / `target`, and may interpolate `${params.X}` (declared params) and `${$.X}` where `$` is the applied block's `start`, `duration`, `end` and `target`. Times are ABSOLUTE: `start` defaults to `${$.start}`, `duration` defaults to the rest of the block, so `{ \"property\": \"transform.opacity\", \"from\": 0, \"to\": 1 }` fills the whole block. Ids are `<blockId>__<suffix>`, suffix defaulting to the entry's index. A `$repeat` block is allowed in place of a tween for echo/stagger behaviors. Emitted tweens must not overlap each other on the same target+property.",
      ),
    produces: z
      .union([z.literal("dynamic"), z.array(z.string().min(1))])
      .optional()
      .describe(
        "Either the suffix list each call appends to the parent block id, or the string \"dynamic\" when the suffix count varies with parameters. Defaults to []. Ignored when `tweens` is given — the suffix list is derived from the body instead.",
      ),
    version: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Opaque version stamp echoed back by list_behaviors. Reserved for library locking; not interpreted in v1.1.",
      ),
  },
  handler: (args, { store }) => {
    const params: BehaviorParamDescriptor[] = (args.params ?? []).map((p) => {
      const desc: BehaviorParamDescriptor = {
        name: p.name,
        type: p.type,
        required: p.required ?? false,
        description: p.description ?? "",
      };
      if (Object.prototype.hasOwnProperty.call(p, "default")) {
        desc.default = p.default;
      }
      return desc;
    });
    const descriptor: BehaviorDescriptor = {
      name: args.name,
      description: args.description ?? "",
      params,
      produces: args.produces ?? [],
      ...(args.tweens !== undefined ? { tweens: args.tweens } : {}),
      ...(args.version !== undefined ? { version: args.version } : {}),
    };
    // Validates the body's shape and derives `produces` from it; param values
    // aren't known until apply_behavior, so expression errors surface there.
    store.setUserBehavior(descriptor);
    const stored = store.listUserBehaviors().find((d) => d.name === args.name);
    return {
      name: args.name,
      executable: stored?.executable ?? false,
      produces: stored?.produces ?? [],
    };
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
      expandBehaviors({ tweens: expanded.tweens }, {
        behaviors: store.userBehaviorRecord(),
      }) as { tweens: Tween[] }
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

const removeUserTemplate = defineTool({
  name: "remove_user_template",
  title: "Remove user template",
  description:
    "Drop a template previously registered in this MCP session by define_user_template. Process-global entries (built-ins, editor library) are not removable from a session and removing them is rejected. Existing template-instance expansions in compositions are unaffected — already-expanded items live on as canonical items.",
  inputSchema: {
    templateId: z.string().min(1),
  },
  handler: (args, { store }) => {
    if (!store.removeUserTemplate(args.templateId)) {
      throw new MCPToolError(
        "E_NOT_FOUND",
        `No template "${args.templateId}" in this session's registry.`,
        "Session-scoped removal only affects templates defined via define_user_template in this MCP session.",
      );
    }
    return { ok: true as const };
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
    strict: z.boolean().optional(),
  }),
  z.object({
    mode: z.literal("loop"),
    count: z.number().int().min(1),
  }),
  z.object({
    mode: z.literal("timeScale"),
    scale: z.number().positive(),
  }),
  z.object({ mode: z.literal("reverse") }),
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
    enter?: number;
    exit?: number;
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
    ...(args.enter !== undefined ? { enter: args.enter } : {}),
    ...(args.exit !== undefined ? { exit: args.exit } : {}),
  };
  // Pass the session's scene record into the expander so any nested scene
  // references inside this scene also resolve session-first.
  const expanded = expandSceneInstance(args.instanceId, sceneInstance, {
    scenes: store.userSceneRecord(),
  });

  // Run the §10.4 behavior pass on the scene's tween array so any
  // `$behavior` blocks the scene emitted resolve to literal tweens.
  const literalTweens = (
    expandBehaviors({ tweens: expanded.tweens }, {
      behaviors: store.userBehaviorRecord(),
    }) as { tweens: Tween[] }
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
    const wrapperGroup = expanded.groupItem as {
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
      items: string[];
      enter?: number;
      exit?: number;
    };
    store.addRawGroup(
      {
        id: args.instanceId,
        layerId: args.layerId,
        childItemIds: wrapperGroup.items,
        transform: { ...wrapperGroup.transform },
        ...(wrapperGroup.enter !== undefined ? { enter: wrapperGroup.enter } : {}),
        ...(wrapperGroup.exit !== undefined ? { exit: wrapperGroup.exit } : {}),
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
    "Place a scene in the composition's timeline. Expands the scene into a synthetic group (placed in `layerId` at the optional `transform`) plus prefixed inner items and time-shifted tweens. In `transform`, `x`/`y` are in pixels with origin at the composition's top-left and positive y pointing down; `anchorX`/`anchorY` are fractional in 0..1 of the synthetic group's box (0=left/top, 0.5=center, 1=right/bottom) and pivot the scene's rotation/scale; `rotation` is in radians, clockwise — multiply degrees by Math.PI/180. The optional `time` field controls how the scene's tween timeline maps onto the parent: \"identity\" (default), \"clip\" with fromTime/toTime, \"loop\" with count, \"timeScale\" with scale, or \"reverse\" to play the scene backwards. A clip window that cuts across a tween trims it, sampling the tween's own easing at the cut so the value there matches the untrimmed scene; pass `strict: true` on the clip to reject such a tween with E_TIME_MAPPING_TWEEN_SPLIT instead. The synthetic group's visibility defaults to `[start, start + effectiveDuration)` (effectiveDuration follows `time`'s mode) so the instance disappears when its own scene ends; pass explicit `enter`/`exit` (absolute composition-timeline seconds, same axis as `start`) to override either bound, e.g. to keep the instance's last frame held past its own duration. Scene-declared assets are merged into the root composition; conflicts on id with different content error. The whole expansion is atomic — any failure rolls back every item, tween, and asset added during this call.",
  inputSchema: {
    sceneId: z.string().min(1),
    layerId: z.string().min(1),
    start: z.number().nonnegative().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    transform: SCENE_TRANSFORM.optional(),
    time: TIME_MAPPING_SCHEMA.optional(),
    enter: z.number().nonnegative().optional(),
    exit: z.number().positive().optional(),
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
      ...(args.enter !== undefined ? { enter: args.enter } : {}),
      ...(args.exit !== undefined ? { exit: args.exit } : {}),
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
        enter: args.enter,
        exit: args.exit,
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
    "Patch a scene instance's params / transform / start / time / enter / exit. The instance is removed and re-expanded under the same id; rolled back to the previous state on any error. Omitted fields keep their previous value (including a previous explicit `enter`/`exit` override); `start`/`time` changes recompute the default visibility window unless `enter`/`exit` were explicitly set.",
  inputSchema: {
    instanceId: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
    transform: SCENE_TRANSFORM.optional(),
    start: z.number().nonnegative().optional(),
    time: TIME_MAPPING_SCHEMA.optional(),
    enter: z.number().nonnegative().optional(),
    exit: z.number().positive().optional(),
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
    const nextEnter = args.enter ?? prev.enter;
    const nextExit = args.exit ?? prev.exit;

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
        ...(nextEnter !== undefined ? { enter: nextEnter } : {}),
        ...(nextExit !== undefined ? { exit: nextExit } : {}),
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
          enter: nextEnter,
          exit: nextExit,
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
          ...(prev.enter !== undefined ? { enter: prev.enter } : {}),
          ...(prev.exit !== undefined ? { exit: prev.exit } : {}),
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
            enter: prev.enter,
            exit: prev.exit,
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
    "Drop a previously-added scene instance: removes the wrapper group, all prefixed inner items, and only the tweens added by the original expansion (or the most recent update_scene_instance). Tweens authored separately — even ones targeting the instance's synthetic group, the one target parent tweens are allowed to use — are never touched, no matter what id they target. Assets contributed by the instance are removed only if no item still references them.",
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
    "Render a single frame at time t and return it as a real MCP image content block (PNG/JPEG) " +
    "so vision-capable clients (and you, watching the agent work) can see it directly — not just " +
    "base64 text an agent can't view. `mimeType`/`width`/`height` are also returned as metadata " +
    "alongside the image block. Video items are composited from the shared frame-extraction cache; " +
    "the first preview of an uncached clip extracts its frames (slower) and says so in `warnings`. " +
    "Validates first.",
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
  toImages: (result) => {
    const { image, ...metadata } = result as PreviewResult;
    return { images: [{ data: image, mimeType: metadata.mimeType }], metadata };
  },
});

const renderThumbnailStripTool = defineTool({
  name: "render_thumbnail_strip",
  title: "Render thumbnail strip",
  description:
    "Render `count` frames uniformly sampled across the timeline and return each as a real MCP " +
    "image content block (not base64 buried in JSON), alongside the parallel `times` sample array " +
    `and mimeType/width/height metadata. \`count\` is capped at ${THUMBNAIL_STRIP_MAX_COUNT} per ` +
    "call — a higher value returns a structured E_INVALID_VALUE with a hint instead of flooding " +
    "the response with dozens of images; sample a narrower time range with `from`/`to` or call again for the rest. " +
    "`from`/`to` (seconds, default the whole timeline) bound the sampled window, endpoints included. " +
    "Video items are composited (frames extracted once per strip, cached across calls; see `warnings`).",
  inputSchema: {
    count: z.number().int().positive(),
    from: z.number().nonnegative().optional().describe("Start of the sampled window in seconds. Default 0."),
    to: z.number().positive().optional().describe("End of the sampled window in seconds. Default the composition duration."),
    format: z.enum(["png", "jpeg"]).optional(),
    compositionId: COMPOSITION_ID,
  },
  handler: async (args, { store, skiaCanvas }) => {
    ensureValidForRender(store, args.compositionId);
    const comp = store.toJSON(args.compositionId);
    const result = await renderThumbnailStrip(comp, {
      count: args.count,
      ...(args.from !== undefined ? { from: args.from } : {}),
      ...(args.to !== undefined ? { to: args.to } : {}),
      ...(args.format !== undefined ? { format: args.format } : {}),
      ...(skiaCanvas !== undefined ? { skiaCanvas } : {}),
    });
    return result;
  },
  toImages: (result) => {
    const { images, ...metadata } = result as ThumbnailStripResult;
    return {
      images: images.map((data) => ({ data, mimeType: metadata.mimeType })),
      metadata,
    };
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
    "`from`/`to` (seconds) render only that window of the timeline — frame-aligned, clamped to the duration, audio cut to match. " +
    "For transparent overlays set `composition.background` to `\"transparent\"` and pick an alpha codec: " +
    "`prores_ks` (ProRes 4444, `.mov`) or `libvpx-vp9` (`.webm`); a mismatched extension fails with E_CONTAINER_CODEC. " +
    "Always returns the same shape: " +
    "`{ jobId, status, outputPath, relativeOutputPath, totalFrames, startedAt, eventsUrl?, result }`. " +
    "`result` is `null` until the job completes; on success it carries `{ outputPath, relativeOutputPath, durationMs, frameCount }`. " +
    "Default is async — the editor enqueues a job and returns immediately with `result: null`; " +
    "poll `get_render` or pass `wait: true` to block until the render completes (then `result` is populated). " +
    "The standalone engine has no queue; calls always block and the response carries `status: \"done\"` with `result` populated. " +
    "On render failure the handler throws `E_RENDER_FAILED` rather than resolving with `status: \"error\"`.",
  inputSchema: {
    outputPath: z.string().min(1),
    codec: z
      .enum(VIDEO_CODECS as [VideoCodec, ...VideoCodec[]])
      .optional()
      .describe(
        "Video encoder. `libx264` (default) / `libx265` → .mp4. Alpha: `prores_ks` (ProRes 4444, yuva444p10le) → .mov, `libvpx-vp9` (yuva420p) → .webm. Omitting the extension picks the codec's container in the editor.",
      ),
    // libx264 / libx265 both top out at 51; values above silently bork the
    // encoder. Clamp at the codec ceiling so a stray crf:60 surfaces as a
    // clean E_INVALID_VALUE up front instead of an opaque E_RENDER_FAILED.
    crf: z.number().int().min(0).max(51).optional(),
    preset: z.string().optional(),
    pixFmt: z.string().optional(),
    colorProfile: z
      .enum(COLOR_PROFILES as [ColorProfile, ...ColorProfile[]])
      .optional()
      .describe(
        "Output colour tagging. `bt709` (default) converts RGB→YUV with the BT.709 matrix at TV range and tags the stream to match, so NLEs and players don't guess. `untagged` is the legacy output: implicit BT.601 matrix, no colour metadata.",
      ),
    movflagsFaststart: z
      .boolean()
      .optional()
      .describe(
        "Append `-movflags +faststart` so MP4 metadata is moved to the front of the file (lets browsers begin playback before the whole file downloads). Defaults to true for the standalone engine and editor render queue.",
      ),
    from: z
      .number()
      .nonnegative()
      .optional()
      .describe("Render from this time in seconds (frame-aligned down). Default 0."),
    to: z
      .number()
      .positive()
      .optional()
      .describe("Render up to this time in seconds (exclusive). Default the composition duration."),
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
    const containerError = checkContainerCodec(args.outputPath, args.codec);
    if (containerError !== undefined) {
      throw new MCPToolError(
        "E_CONTAINER_CODEC",
        containerError,
        "Use .mov for prores_ks, .webm for libvpx-vp9, and .mp4 for libx264/libx265.",
      );
    }
    if (args.from !== undefined && args.to !== undefined && args.to <= args.from) {
      throw new MCPToolError(
        "E_INVALID_VALUE",
        `render range ${args.from}..${args.to} is empty.`,
        "Pass `to` greater than `from`.",
      );
    }
    const range: RenderRange | undefined =
      args.from !== undefined || args.to !== undefined
        ? {
            ...(args.from !== undefined ? { from: args.from } : {}),
            ...(args.to !== undefined ? { to: args.to } : {}),
          }
        : undefined;
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
      if (args.colorProfile !== undefined) startArgs.colorProfile = args.colorProfile;
      if (range !== undefined) startArgs.range = range;
      if (args.movflagsFaststart !== undefined) {
        startArgs.movflagsFaststart = args.movflagsFaststart;
      }

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
        // Default to faststart on MP4 outputs so browsers can begin playback
        // before the whole file downloads. Callers can opt out by passing
        // `movflagsFaststart: false` (e.g. when targeting a non-MP4 container).
        movflagsFaststart: args.movflagsFaststart ?? true,
        ...(args.codec !== undefined ? { codec: args.codec } : {}),
        ...(args.crf !== undefined ? { crf: args.crf } : {}),
        ...(args.preset !== undefined ? { preset: args.preset } : {}),
        ...(args.pixFmt !== undefined ? { pixFmt: args.pixFmt } : {}),
        ...(args.colorProfile !== undefined ? { colorProfile: args.colorProfile } : {}),
        ...(range !== undefined ? { range } : {}),
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
      if (err instanceof RangeError && range !== undefined) {
        throw new MCPToolError(
          "E_INVALID_VALUE",
          err.message,
          "Pick `from`/`to` inside the composition duration.",
        );
      }
      if (err instanceof RefResolutionError) {
        throw new MCPToolError(
          err.code,
          err.message,
          "Resolve the broken `$ref` (check the path, JSON pointer, or cycle) and try again.",
          {
            details: {
              ...(err.ref !== undefined ? { ref: err.ref } : {}),
              ...(err.chain !== undefined ? { chain: [...err.chain] } : {}),
            },
          },
        );
      }
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
    "Errors E_NOT_FOUND if the jobId is unknown, or E_FEATURE_UNAVAILABLE if the MCP server is not hosted inside an editor.",
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
    "Errors E_FEATURE_UNAVAILABLE if the MCP server is not hosted inside an editor.",
  inputSchema: {},
  handler: async (_args, deps) => {
    const ctrl = requireRenderControls(deps);
    const jobs = await ctrl.list();
    return { jobs };
  },
});

const cancelRender = defineTool({
  name: "cancel_render",
  title: "Cancel render job",
  description:
    "Cancel a non-terminal render job started by `render_to_video`. The job is marked terminal (`status: \"error\"`) immediately and any SSE subscribers receive a clean shutdown event. The underlying ffmpeg subprocess may continue running until it exits on its own — the orphan output is left in the project's `renders/` directory. " +
    "Calling cancel on an already-terminal job (`done` or `error`) is a no-op and returns the existing snapshot. " +
    "Errors E_NOT_FOUND if the jobId is unknown, or E_FEATURE_UNAVAILABLE if the MCP server is not hosted inside an editor.",
  inputSchema: {
    jobId: z.string().min(1),
    reason: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Human-readable reason recorded on the job's terminal error event. Defaults to a generic 'cancelled by MCP client' message.",
      ),
  },
  handler: async (args, deps) => {
    const ctrl = requireRenderControls(deps);
    const reason = args.reason ?? "Render cancelled by MCP client.";
    const snap = await ctrl.cancel(args.jobId, reason);
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

// ──────────────── 4.7 Project lifecycle (polish §20.29) ────────────────

const currentProject = defineTool({
  name: "current_project",
  title: "Current project",
  description:
    "Return information about the project currently loaded by the editor (root, paths, loadedAt). Returns `{ project: null }` when no project is loaded. Errors with E_FEATURE_UNAVAILABLE if the MCP server is not hosted inside an editor.",
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
    "Return the editor's list of recently-opened projects, sorted newest first. Entries whose directory no longer exists are pruned. Errors with E_FEATURE_UNAVAILABLE if the MCP server is not hosted inside an editor.",
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
    "Load a project from a directory on disk and make it the editor's active composition. Routes through the same controller path as POST /api/project in the UI (same validation, same path guard, same project-switch reset). Errors with E_NOT_FOUND if no composition.json exists at `path`, E_INVALID_VALUE if `path` is malformed or in a protected system location, or E_FEATURE_UNAVAILABLE if the MCP server is not hosted inside an editor.",
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
    "Return the merged Library catalog the editor's `GET /api/library` exposes: every template / behavior / scene / asset / font from the global pool (`~/.davidup/library` by default) AND the active project's `library/` directory. Each item carries `scope` (`project` | `global`) and an `overridden: true` flag on the *loser* of a (kind, id) collision (project beats global). Optional filters: `q` (substring over id/name/description), `kind`, `scope`. Call `get_library_thumbnail` with the item's `kind` + `id` to fetch a base64 PNG preview. Errors with E_FEATURE_UNAVAILABLE if the MCP server is not hosted inside an editor.",
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

const getLibraryThumbnail = defineTool({
  name: "get_library_thumbnail",
  title: "Get library thumbnail",
  description:
    "Return a base64-encoded PNG preview for a single Library item identified by `kind` + `id` (as returned by `list_library`). The first call synthesizes a tiny composition exercising the item and renders frame 0.5 via the same path the Library panel uses; subsequent calls hit an in-memory cache. When synthesis isn't viable the renderer falls back to a deterministic placeholder PNG and sets `placeholder: true`. Errors with E_NOT_FOUND if no item with that (kind, id) is in the current catalog, or E_FEATURE_UNAVAILABLE if the MCP server is not hosted inside an editor.",
  inputSchema: {
    kind: LIBRARY_ITEM_KIND,
    id: z.string().min(1),
  },
  handler: async (args, deps) => {
    const ctrl = requireLibraryControls(deps);
    return ctrl.thumbnail({ kind: args.kind, id: args.id });
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

// ──────────────── 4.9 Engine discovery (M5) ────────────────

// Cheap, side-effect-free discovery tools so agents don't have to round-trip
// through `E_INVALID_VALUE` (or the design doc) to learn the engine's
// vocabulary. Mirrors the existing list_behaviors / list_templates pattern.

const listEasingsTool = defineTool({
  name: "list_easings",
  title: "List easings",
  description:
    "List the easings accepted by `add_tween` / `update_tween` / `apply_behavior`. `easings` are the named curves — pass one verbatim as the `easing` field. `parametric` documents the two object forms: `{ bezier: [x1, y1, x2, y2] }` (CSS cubic-bezier, x1 and x2 in [0, 1]) and `{ steps: n }` (CSS steps(n), jump-end). Identical across compositions and across standalone vs. editor servers.",
  inputSchema: {},
  handler: () => {
    return { easings: [...EASING_NAMES], parametric: parametricEasings() };
  },
});

const listFontsTool = defineTool({
  name: "list_fonts",
  title: "List fonts",
  description:
    "List fonts available to `add_text`. `bundled` is the font that ships with davidup — `font:default` (Inter Regular, `bundled: true`), usable from any composition with no `register_asset`; it is also what `add_text` uses when `font` is omitted. `composition` lists font assets registered on the composition (pass their `id` as the text item's `font` field; `family` is the underlying CSS family name). When the MCP server is hosted by an editor, `library` also enumerates fonts in the merged Library (project + global) — register one with `register_asset` before referencing it from `add_text`. " +
    "When only the bundled font is available, the response carries a `hint` explaining how to register another typeface.",
  inputSchema: {
    compositionId: COMPOSITION_ID,
  },
  handler: async (args, deps) => {
    const assets = deps.store.listAssets(args.compositionId);
    const composition = assets
      .filter((a): a is FontAsset => a.type === "font")
      .map((a) => ({ id: a.id, family: a.family, src: a.src }));
    // R-30 — the bundled default font is always resolvable. A composition
    // asset that reuses the `font:default` id shadows it.
    const bundled = [
      {
        id: DEFAULT_FONT_ID,
        family: DEFAULT_FONT_FAMILY,
        bundled: true as const,
        ...(isBundledFontId(DEFAULT_FONT_ID, assets) ? {} : { overridden: true }),
      },
    ];
    const library: {
      id: string;
      name?: string;
      scope: "project" | "global";
      source: string;
      overridden?: boolean;
    }[] = [];
    if (deps.libraryControls) {
      try {
        const catalog = await deps.libraryControls.list({ kind: "font" });
        for (const item of catalog.items) {
          library.push({
            id: item.id,
            ...(item.name !== undefined ? { name: item.name } : {}),
            scope: item.scope,
            source: item.source,
            ...(item.overridden !== undefined ? { overridden: item.overridden } : {}),
          });
        }
      } catch {
        // Library lookup is best-effort; an unavailable editor service must
        // not block composition-scoped discovery.
      }
    }
    if (composition.length === 0 && library.length === 0) {
      return {
        bundled,
        composition,
        library,
        hint:
          'Only the bundled font is available: omit `font` in `add_text` (or pass "font:default") ' +
          "to use Inter Regular. For another typeface call `register_asset` with " +
          '`type: "font"`, a `family` name, and `src` pointing at a .ttf/.otf/.woff(2) file on ' +
          "disk, then pass that asset's `id` (not `family`) as `add_text`'s `font` field.",
      };
    }
    return { bundled, composition, library };
  },
});

const listEngineCapabilitiesTool = defineTool({
  name: "list_engine_capabilities",
  title: "List engine capabilities",
  description:
    "Single-call discovery of the engine's capability surface: composition schema version, easing names and the parametric `{ bezier }` / `{ steps }` forms, blend modes, item types, shape kinds, supported audio/video containers, and the tweenable property paths per item type. Use this to construct valid tweens and items without hitting `E_INVALID_VALUE` to learn the vocabulary. " +
    "Also reports `server.flavor` (`\"standalone\"` | `\"editor\"`) so you know up front whether project_*/library_*/render-queue tools are available — check that instead of learning the hard way via `E_FEATURE_UNAVAILABLE`.",
  inputSchema: {},
  handler: (_args, deps) => {
    return {
      // R-28 — tell the agent which optional surfaces this server hosts
      // instead of making it discover the gaps one E_FEATURE_UNAVAILABLE at
      // a time. `projectControls`/`libraryControls`/`renderControls` are
      // only ever injected by the editor's mcp_bridge (see ToolDeps in this
      // file); their absence is exactly what makes a server "standalone".
      server: {
        flavor: deps.projectControls ? ("editor" as const) : ("standalone" as const),
        hasProjectLifecycle: Boolean(deps.projectControls),
        hasLibrary: Boolean(deps.libraryControls),
        hasRenderQueue: Boolean(deps.renderControls),
        // R-29 — seconds of inactivity after which the server resets all
        // state; 0 = never (the default, and always for the editor).
        sessionIdleSeconds: deps.sessionIdleSeconds ?? 0,
      },
      schemaVersion: COMPOSITION_VERSION,
      easings: [...EASING_NAMES],
      // v1.1 S17 — object forms accepted wherever `easing` is (see list_easings).
      parametricEasings: parametricEasings(),
      blendModes: [...BLEND_MODES],
      // Group compositing (v1.1 S18). `isolate` flattens a group's children
      // onto a scratch surface and composites once — the fix for a faded
      // group showing its children's overlap seams; `blendMode` sets how that
      // composite (or, un-isolated, each child) blends with the backdrop.
      groups: {
        isolate: true,
        blendMode: true,
      },
      itemTypes: ["sprite", "text", "shape", "group", "video"] as const,
      shapeKinds: ["rect", "circle", "polygon"] as const,
      // Audio support (v0.2 §S3): external tracks on the composition timeline via
      // add_audio_track. `extensions` are the containers register_asset accepts
      // for `type: "audio"`. Mux into the rendered MP4 lands in S4.
      audio: {
        tracks: true,
        extensions: [...AUDIO_ASSET_EXTENSIONS],
      },
      // Video support (v0.2 §S9): silent texture items via add_video / update_video.
      // `extensions` are the containers register_asset accepts for `type: "video"`;
      // `fitModes` are the object-fit values; `loop` advertises end-outlasts-source
      // replay. Tween x/y/opacity/width/height like a sprite (see tweenable.video).
      video: {
        items: true,
        extensions: [...VIDEO_ASSET_EXTENSIONS],
        fitModes: [...VIDEO_FIT_MODES],
        loop: true,
      },
      // Per-item effects (v1.1 S21), on every item type via update_item.
      // `tweenable` lists each type's fields, animated as
      // `effects.<index>.<field>`. Blur runs in-engine so node and browser
      // agree; shadow/glow are the Canvas2D shadow.
      effects: {
        types: [...EFFECT_TYPES],
        tweenable: Object.fromEntries(
          Object.entries(EFFECT_TWEENABLE).map(([type, ds]) => [
            type,
            ds.map((d) => ({ field: d.path, kind: d.kind })),
          ]),
        ),
        propertyPattern: "effects.<index>.<field>",
      },
      tweenable: {
        sprite: listTweenable("sprite"),
        text: listTweenable("text"),
        shape: listTweenable("shape"),
        group: listTweenable("group"),
        video: listTweenable("video"),
      },
      // Param-type vocabularies accepted by each descriptor surface. Use these
      // when constructing `params` for define_user_behavior / define_user_template /
      // define_scene without hitting E_INVALID_VALUE.
      paramTypes: {
        behavior: ["number", "string", "color", "colorArray", "axis"] as const,
        template: ["number", "string", "color", "boolean"] as const,
        scene: ["number", "string", "color", "boolean"] as const,
      },
    };
  },
});

const getSourceMap = defineTool({
  name: "get_source_map",
  title: "Get composition source map",
  description:
    "Return the precompiled composition plus its source map: an authorship trail keyed by resolved item / tween id. " +
    "For each id, the map carries `{ file, jsonPointer, originKind }` where `originKind` ∈ \"literal\" | \"ref\" | \"template\" | \"behavior\" | \"scene\" | \"background\" | \"repeat\". " +
    "Compositions built imperatively through the MCP tools have no `$ref` / `$template` / `$behavior` markers, so every entry's `originKind` is `literal` and `file` is the literal string `\"<root>\"`. " +
    "Errors with `E_REF_*` if the comp ever does carry $refs that can't be resolved.",
  inputSchema: {
    compositionId: COMPOSITION_ID,
  },
  handler: async (args, { store }) => {
    const comp = store.toJSON(args.compositionId);
    try {
      const result = await precompile(comp, { emitSourceMap: true });
      return { sourceMap: result.sourceMap };
    } catch (err) {
      if (err instanceof RefResolutionError) {
        throw new MCPToolError(
          err.code,
          err.message,
          "Resolve the broken `$ref` (check the path, JSON pointer, or cycle) and try again.",
          {
            details: {
              ...(err.ref !== undefined ? { ref: err.ref } : {}),
              ...(err.chain !== undefined ? { chain: [...err.chain] } : {}),
            },
          },
        );
      }
      throw err;
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
  // 4.4a — video items (v0.2 §S9)
  addVideo,
  updateVideo,
  // 4.5
  addTween,
  updateTween,
  removeTween,
  listTweens,
  // 4.5a — audio tracks (v0.2 §S3)
  addAudioTrack,
  updateAudioTrack,
  removeAudioTrack,
  listAudioTracks,
  // 4.5b — behaviors
  applyBehavior,
  listBehaviorsTool,
  defineUserBehavior,
  // 4.5c — templates
  applyTemplate,
  listTemplatesTool,
  defineUserTemplate,
  removeUserTemplate,
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
  cancelRender,
  // 4.7 — project lifecycle (polish §20.29)
  currentProject,
  listProjects,
  openProject,
  createProject,
  // 4.8 — library (polish §20.30)
  listLibrary,
  getLibraryThumbnail,
  // 4.9 — engine discovery (M5)
  listEasingsTool,
  listFontsTool,
  listEngineCapabilitiesTool,
  getSourceMap,
];

export const TOOL_NAMES: ReadonlyArray<string> = TOOLS.map((t) => t.name);
