// Pure handler dispatch for MCP tools — independent of the MCP SDK transport.
//
// Why a separate layer: we want to drive tool handlers from three places:
//   1. The real MCP server (server.ts wraps each ToolDef with this dispatcher
//      and registers via @modelcontextprotocol/sdk).
//   2. Unit tests (call dispatchTool directly without spawning a process).
//   3. Future programmatic API consumers.
//
// dispatchTool turns any handler outcome into the canonical envelope:
//   success → { ok: true, result: <payload> }
//   failure → { ok: false, error: { code, message, hint? } }
// Tools that already return `{ok:true}` payloads keep their shape inside
// `result` — the outer envelope just exposes a uniform error path.
//
// Routing (step 07): the optional `router` lets an embedder intercept a tool
// call after input validation but before the default handler runs. The editor
// uses this to redirect every *mutating* tool through its CommandBus so MCP
// edits and UI edits share one store. If the router returns a DispatchResult
// the handler is skipped; returning `null` falls through to the default path.

import { z } from "zod";

import { MCPToolError, toErrorBody, type MCPErrorBody } from "./errors.js";
import type { ToolDef, ToolDeps } from "./tools.js";

export type DispatchResult =
  | { ok: true; result: unknown }
  | { ok: false; error: MCPErrorBody };

export type DispatchRouter = (
  tool: ToolDef<z.ZodRawShape>,
  parsedArgs: Record<string, unknown>,
  deps: ToolDeps,
) => Promise<DispatchResult | null> | DispatchResult | null;

export async function dispatchTool(
  tool: ToolDef<z.ZodRawShape>,
  rawArgs: unknown,
  deps: ToolDeps,
  router?: DispatchRouter,
): Promise<DispatchResult> {
  // Re-parse with the tool's own input schema. The SDK already does this when
  // calls come from MCP clients, but direct callers (tests) skip that. Doing
  // it here makes both paths behave identically.
  const schema = z.object(tool.inputSchema);
  const parsed = schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "E_INVALID_VALUE",
        message: parsed.error.issues[0]?.message ?? "Invalid arguments.",
        hint: formatIssuePath(parsed.error.issues),
      },
    };
  }
  try {
    if (router) {
      const intercepted = await router(
        tool,
        parsed.data as Record<string, unknown>,
        deps,
      );
      if (intercepted !== null && intercepted !== undefined) {
        return intercepted;
      }
    }
    const result = await tool.handler(parsed.data as never, deps);
    return { ok: true, result };
  } catch (err) {
    if (err instanceof MCPToolError) {
      return { ok: false, error: err.toBody() };
    }
    return { ok: false, error: toErrorBody(err) };
  }
}

function formatIssuePath(issues: ReadonlyArray<{ path: ReadonlyArray<unknown> }>): string {
  if (issues.length === 0) return "Invalid arguments.";
  const path = issues[0]?.path?.join(".") ?? "";
  return path ? `Invalid value at "${path}".` : "Invalid arguments.";
}
