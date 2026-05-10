// Structured error contract used by every MCP tool handler (per design-doc §4.7).
//
// Tool responses always have shape `{ ok: ... }` on success or
// `{ error: { code, message, hint? } }` on failure. The `MCPToolError` class
// carries the structured fields up out of any deeper helper that throws; the
// tool dispatcher catches it and serialises it into the response envelope.

export const MCP_ERROR_CODES = [
  "E_NO_COMPOSITION",
  "E_DUPLICATE_ID",
  "E_NOT_FOUND",
  "E_VALIDATION_FAILED",
  "E_TWEEN_OVERLAP",
  "E_INVALID_PROPERTY",
  "E_LAYER_NOT_EMPTY",
  "E_ASSET_IN_USE",
  "E_ASSET_TYPE_MISMATCH",
  "E_INVALID_VALUE",
  "E_RENDER_FAILED",
  "E_BEHAVIOR_UNKNOWN",
  "E_BEHAVIOR_PARAM_MISSING",
  "E_BEHAVIOR_PARAM_TYPE",
  "E_TEMPLATE_UNKNOWN",
  "E_TEMPLATE_PARAM_MISSING",
  "E_TEMPLATE_PARAM_TYPE",
  "E_UNKNOWN",
] as const;

export type MCPErrorCode = (typeof MCP_ERROR_CODES)[number];

export interface MCPErrorBody {
  code: MCPErrorCode;
  message: string;
  hint?: string;
}

export class MCPToolError extends Error {
  readonly code: MCPErrorCode;
  readonly hint: string | undefined;

  constructor(code: MCPErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "MCPToolError";
    this.code = code;
    this.hint = hint;
  }

  toBody(): MCPErrorBody {
    const body: MCPErrorBody = { code: this.code, message: this.message };
    if (this.hint !== undefined) body.hint = this.hint;
    return body;
  }
}

export function isMCPToolError(value: unknown): value is MCPToolError {
  return value instanceof MCPToolError;
}

export function toErrorBody(value: unknown): MCPErrorBody {
  if (isMCPToolError(value)) return value.toBody();
  if (value instanceof Error) {
    return { code: "E_UNKNOWN", message: value.message };
  }
  return { code: "E_UNKNOWN", message: String(value) };
}
