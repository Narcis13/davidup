export type {
  AssetRegistry,
  Canvas2DContext,
  OffscreenSurface,
  OriginKind,
  RenderOptions,
  SourceLocation,
  SourceMap,
  VideoClip,
  VideoFrameProvider,
} from "./types.js";
export {
  computeStateAt,
  indexTweens,
  lerp,
  type ResolvedScene,
  type TweenIndex,
} from "./resolver.js";
export {
  computeFitRects,
  drawItem,
  drawScene,
  renderFrame,
  videoFrameIndex,
  type FitRects,
  type VideoRenderContext,
} from "./render.js";
export {
  MCP_ERROR_CODES,
  MCPToolError,
  isMCPToolError,
  toErrorBody,
  type MCPErrorBody,
  type MCPErrorCode,
  type MCPIssue,
  type MCPToolErrorExtras,
} from "./errors.js";
