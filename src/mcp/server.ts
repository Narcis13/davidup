// MCP server wiring (per design-doc §4 + plan §8).
//
// Builds an `McpServer` over stdio transport, registers every tool from
// `TOOLS`, and turns each handler outcome into the canonical CallToolResult
// shape:
//   - success → { content:[{type:"text", text:JSON}], structuredContent }
//   - failure → { content:[...], structuredContent:{error}, isError:true }
//
// The structured content carries our `{ error: { code, message, hint? } }`
// envelope verbatim, so MCP clients that prefer JSON-shaped results read
// the same body the design doc spec'd. The text variant is the same JSON
// stringified for clients that only render text content.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { dispatchTool, type DispatchResult } from "./dispatch.js";
import { CompositionStore } from "./store.js";
import { TOOLS, type ToolDef, type ToolDeps } from "./tools.js";

export interface CreateServerOptions {
  store?: CompositionStore;
  // Server identity surfaced via the `initialize` handshake.
  name?: string;
  version?: string;
}

export interface DavidupServer {
  mcp: McpServer;
  store: CompositionStore;
  start(): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_NAME = "davidup";
const DEFAULT_VERSION = "0.1.0";

export function createServer(options: CreateServerOptions = {}): DavidupServer {
  const store = options.store ?? new CompositionStore();
  const deps: ToolDeps = { store };

  const mcp = new McpServer(
    {
      name: options.name ?? DEFAULT_NAME,
      version: options.version ?? DEFAULT_VERSION,
    },
    {
      capabilities: { tools: {} },
    },
  );

  for (const tool of TOOLS) {
    registerTool(mcp, tool, deps);
  }

  const transport = new StdioServerTransport();

  return {
    mcp,
    store,
    async start() {
      await mcp.connect(transport);
    },
    async close() {
      await mcp.close();
    },
  };
}

function registerTool(
  mcp: McpServer,
  tool: ToolDef,
  deps: ToolDeps,
): void {
  mcp.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    async (args: unknown) => {
      const outcome = await dispatchTool(tool, args, deps);
      return toCallToolResult(outcome);
    },
  );
}

function toCallToolResult(outcome: DispatchResult): CallToolResult {
  if (outcome.ok) {
    const payload = outcome.result;
    return {
      content: [{ type: "text", text: jsonStringify(payload) }],
      structuredContent: asStructured(payload),
    };
  }
  const errPayload = { error: outcome.error };
  return {
    content: [{ type: "text", text: jsonStringify(errPayload) }],
    structuredContent: errPayload,
    isError: true,
  };
}

function asStructured(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function jsonStringify(value: unknown): string {
  // Pretty-printed but compact: easier for humans inspecting tool output in
  // MCP clients, still trivial to parse on the consumer side.
  return JSON.stringify(value, null, 2);
}
