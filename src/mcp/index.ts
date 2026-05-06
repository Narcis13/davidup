// Public entrypoints for the MCP layer.
//
// `createServer` wires the in-memory composition store to the MCP SDK and
// returns a handle whose `start()` connects over stdio. Tool definitions
// (TOOLS) and the dispatcher (dispatchTool) are exported so consumers can
// drive the same handlers directly from tests or programmatic code without
// going through a transport.

export { CompositionStore } from "./store.js";
export type {
  AddGroupInput,
  AddLayerInput,
  AddShapeInput,
  AddSpriteInput,
  AddTextInput,
  AddTweenInput,
  CreateCompositionInput,
  RegisterAssetInput,
  SetMetaPropertyName,
  UpdateItemProps,
  UpdateLayerProps,
  UpdateTweenProps,
  ListTweensFilter,
} from "./store.js";

export {
  MCPToolError,
  isMCPToolError,
  toErrorBody,
  MCP_ERROR_CODES,
  type MCPErrorBody,
  type MCPErrorCode,
} from "./errors.js";

export {
  TOOLS,
  TOOL_NAMES,
  type ToolDef,
  type ToolDeps,
} from "./tools.js";

export {
  dispatchTool,
  type DispatchResult,
} from "./dispatch.js";

export {
  createServer,
  type CreateServerOptions,
  type MotionForgeServer,
} from "./server.js";

export {
  renderPreviewFrame,
  renderThumbnailStrip,
  sampleTimes,
  type PreviewFormat,
  type PreviewResult,
  type ThumbnailStripResult,
} from "./render.js";

export async function main(): Promise<void> {
  const { createServer } = await import("./server.js");
  const server = createServer();
  await server.start();
  // McpServer listens until the transport closes (stdin EOF). Process exit is
  // handled implicitly by the runtime once the event loop empties.
}
