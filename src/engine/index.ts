export type {
  AssetRegistry,
  Canvas2DContext,
  OffscreenSurface,
  OriginKind,
  RenderOptions,
  SourceLocation,
  SourceMap,
} from "./types.js";
export {
  computeStateAt,
  indexTweens,
  lerp,
  type ResolvedScene,
  type TweenIndex,
} from "./resolver.js";
export { drawItem, drawScene, renderFrame } from "./render.js";
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
