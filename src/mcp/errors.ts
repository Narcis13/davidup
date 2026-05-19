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
  "E_SCENE_UNKNOWN",
  "E_SCENE_PARAM_MISSING",
  "E_SCENE_PARAM_TYPE",
  "E_SCENE_RECURSION",
  "E_SCENE_INSTANCE_DEEP_TARGET",
  "E_ASSET_CONFLICT",
  "E_TIME_MAPPING_INVALID",
  "E_TIME_MAPPING_TWEEN_SPLIT",
  "E_UNKNOWN",
] as const;

export type MCPErrorCode = (typeof MCP_ERROR_CODES)[number];

/**
 * One row in `MCPErrorBody.issues[]` / `.warnings[]`. Shape is the lowest
 * common denominator between Zod issues (`path: (string|number)[]`,
 * `code: string`), the engine validator's `ValidationError` (`code`, `path`,
 * `message`), and command-bus `CommandValidationError` issues (`path`,
 * `message`). Consumers should treat any unknown `code` as informational.
 */
export interface MCPIssue {
  message: string;
  path?: string;
  code?: string;
}

export interface MCPErrorBody {
  code: MCPErrorCode;
  message: string;
  hint?: string;
  /** Validation failures that caused the error — one entry per failing rule. */
  issues?: ReadonlyArray<MCPIssue>;
  /** Non-fatal validator output (e.g. W_TWEEN_TRUNCATED) attached for context. */
  warnings?: ReadonlyArray<MCPIssue>;
  /** Error-specific structured context (conflicting ids, rejected values, …). */
  details?: Record<string, unknown>;
}

export interface MCPToolErrorExtras {
  issues?: ReadonlyArray<MCPIssue>;
  warnings?: ReadonlyArray<MCPIssue>;
  details?: Record<string, unknown>;
}

export class MCPToolError extends Error {
  readonly code: MCPErrorCode;
  readonly hint: string | undefined;
  readonly issues: ReadonlyArray<MCPIssue> | undefined;
  readonly warnings: ReadonlyArray<MCPIssue> | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: MCPErrorCode,
    message: string,
    hint?: string,
    extras?: MCPToolErrorExtras,
  ) {
    super(message);
    this.name = "MCPToolError";
    this.code = code;
    this.hint = hint;
    this.issues = extras?.issues;
    this.warnings = extras?.warnings;
    this.details = extras?.details;
  }

  toBody(): MCPErrorBody {
    const body: MCPErrorBody = { code: this.code, message: this.message };
    if (this.hint !== undefined) body.hint = this.hint;
    if (this.issues !== undefined && this.issues.length > 0) body.issues = this.issues;
    if (this.warnings !== undefined && this.warnings.length > 0) body.warnings = this.warnings;
    if (this.details !== undefined) body.details = this.details;
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
