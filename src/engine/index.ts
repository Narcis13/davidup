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
  VideoFrameRequest,
} from "./types.js";
export {
  computeStateAt,
  indexTweens,
  lerp,
  type ResolvedScene,
  type TweenIndex,
} from "./resolver.js";
export {
  applyTextStyle,
  computeFitRects,
  drawItem,
  drawScene,
  prepareVideoFrames,
  renderFrame,
  videoFrameIndex,
  type FitRects,
  type VideoRenderContext,
} from "./render.js";
export {
  DEFAULT_LINE_HEIGHT,
  TEXT_ASCENT_RATIO,
  TEXT_LAYOUT_VERSION,
  isBoxText,
  layoutText,
  textFontString,
  wrapText,
  type MeasureText,
  type TextLayout,
  type TextLine,
} from "./textLayout.js";
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
