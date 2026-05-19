// Re-export of the structured error contract used by every MCP tool handler.
//
// The implementation lives in `engine/errors.ts` so the compose layer (which
// sits below mcp) can throw structured errors without an upward `compose → mcp`
// import. MCP-layer code continues to import from `"./errors.js"` as before.

export {
  MCP_ERROR_CODES,
  MCPToolError,
  isMCPToolError,
  toErrorBody,
  type MCPErrorBody,
  type MCPErrorCode,
  type MCPIssue,
  type MCPToolErrorExtras,
} from "../engine/errors.js";
