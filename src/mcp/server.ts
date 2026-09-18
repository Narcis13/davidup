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

import {
  dispatchTool,
  type DispatchResult,
  type DispatchRouter,
} from "./dispatch.js";
import { CompositionStore } from "./store.js";
import { TOOLS, type ToolDef, type ToolDeps } from "./tools.js";

export interface CreateServerOptions {
  store?: CompositionStore;
  // Server identity surfaced via the `initialize` handshake.
  name?: string;
  version?: string;
  // Optional per-call deps factory — lets embedders (the editor) re-hydrate
  // a fresh store from the canonical document for each call so read-only
  // tools (validate / get_composition / list_* / render_*) always see the
  // latest state. When omitted, every call uses the same `{ store }`.
  depsFactory?: (toolName: string) => ToolDeps | Promise<ToolDeps>;
  // Optional router — intercepts a tool call after input validation. The
  // editor uses this to redirect mutating tools through its CommandBus.
  router?: DispatchRouter;
  // R-29 — idle TTL in seconds. When > 0, the server auto-`reset`s the
  // default store (compositions AND user registries) after this many seconds
  // without a tool call, so a long-lived standalone process doesn't hand one
  // conversation's state to the next. 0 / omitted = never. Only meaningful
  // for the default `{ store }` deps — embedders with a `depsFactory` own
  // their own lifecycle.
  sessionTtlSeconds?: number;
  // Where the idle reset is logged. Defaults to stderr (stdout carries the
  // JSON-RPC framing). Injected by tests.
  log?: (message: string) => void;
}

export interface DavidupServer {
  mcp: McpServer;
  store: CompositionStore;
  start(): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_NAME = "davidup";
const DEFAULT_VERSION = "1.0.0";

export function createServer(options: CreateServerOptions = {}): DavidupServer {
  const store = options.store ?? new CompositionStore();
  const sessionIdleSeconds = normaliseTtl(options.sessionTtlSeconds);
  const defaultDeps: ToolDeps = { store, sessionIdleSeconds };
  const baseFactory =
    options.depsFactory ?? ((_toolName: string) => defaultDeps);
  const router = options.router;
  const idle = createIdleReset(store, sessionIdleSeconds, options.log);
  const depsFactory = idle
    ? (toolName: string) => {
        idle.touch();
        return baseFactory(toolName);
      }
    : baseFactory;

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
    registerTool(mcp, tool, depsFactory, router);
  }

  const transport = new StdioServerTransport();

  return {
    mcp,
    store,
    async start() {
      await mcp.connect(transport);
    },
    async close() {
      idle?.cancel();
      await mcp.close();
    },
  };
}

function registerTool(
  mcp: McpServer,
  tool: ToolDef,
  depsFactory: (toolName: string) => ToolDeps | Promise<ToolDeps>,
  router: DispatchRouter | undefined,
): void {
  mcp.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    async (args: unknown) => {
      const deps = await depsFactory(tool.name);
      const outcome = await dispatchTool(tool, args, deps, router);
      return toCallToolResult(tool, outcome);
    },
  );
}

function toCallToolResult(tool: ToolDef, outcome: DispatchResult): CallToolResult {
  if (outcome.ok) {
    if (tool.toImages) {
      const { images, metadata } = tool.toImages(outcome.result);
      return {
        content: [
          ...images.map((img) => ({
            type: "image" as const,
            data: img.data,
            mimeType: img.mimeType,
          })),
          { type: "text" as const, text: jsonStringify(metadata) },
        ],
        structuredContent: asStructured(metadata),
      };
    }
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

// ──────────────── R-29 idle TTL ────────────────

export const SESSION_TTL_ENV = "DAVIDUP_SESSION_TTL";

function normaliseTtl(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

export interface IdleReset {
  // Re-arm the timer; called on every tool call.
  touch(): void;
  cancel(): void;
}

// Idle timer that wipes `store` (compositions + user registries) once
// `seconds` pass without a `touch()`. Armed on the first call — an untouched
// server has nothing to forget. Returns null when the TTL is disabled.
export function createIdleReset(
  store: CompositionStore,
  seconds: number,
  log: (message: string) => void = (m) => console.error(m),
): IdleReset | null {
  if (!(seconds > 0)) return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    touch() {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        store.reset(undefined, "all");
        log(`[davidup] session idle for ${seconds}s — state reset (compositions + user registries)`);
      }, seconds * 1000);
      // Never keep the process alive just to run the reset.
      (timer as { unref?: () => void }).unref?.();
    },
    cancel,
  };
}

// Resolve the TTL for the standalone bin: `--session-ttl <s>` /
// `--session-ttl=<s>` wins over `DAVIDUP_SESSION_TTL`; absent → 0 (forever).
// Throws on a malformed value so a typo doesn't silently disable the TTL.
export function resolveSessionTtl(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): number {
  let raw: string | undefined;
  let source = "--session-ttl";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--session-ttl") raw = argv[++i];
    else if (arg.startsWith("--session-ttl=")) raw = arg.slice("--session-ttl=".length);
  }
  if (raw === undefined) {
    raw = env[SESSION_TTL_ENV];
    source = SESSION_TTL_ENV;
  }
  if (raw === undefined || raw.trim() === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${source} must be a non-negative number of seconds, got "${raw}"`);
  }
  return n;
}
