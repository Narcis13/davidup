// Spawns a real standalone `davidup-mcp` server subprocess and drives it
// over stdio via the MCP SDK client — the same transport a real AI-agent
// client (Claude Desktop, Claude Code, etc.) uses. Mirrors
// tests/mcp/server.integration.test.ts, but exposed as a reusable session
// for the eval runner instead of a one-off test fixture.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type Anthropic from "@anthropic-ai/sdk";
import { join } from "node:path";

import { REPO_ROOT } from "./assets.js";

const BIN_PATH = join(REPO_ROOT, "src", "mcp", "bin.ts");

export interface McpSession {
  client: Client;
  close(): Promise<void>;
}

export async function openMcpSession(): Promise<McpSession> {
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", BIN_PATH],
    cwd: REPO_ROOT,
    stderr: "pipe",
  });
  const client = new Client({ name: "davidup-agent-eval", version: "0.0.0" });
  await client.connect(transport);
  return {
    client,
    async close() {
      try {
        await client.close();
      } catch {
        // ignore — subprocess may already be gone
      }
      try {
        await transport.close();
      } catch {
        // ignore
      }
    },
  };
}

/** Convert the server's advertised MCP tools into Claude API tool definitions. */
export async function listClaudeTools(client: Client): Promise<Anthropic.Tool[]> {
  const { tools } = await client.listTools();
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    input_schema: (tool.inputSchema ?? { type: "object", properties: {} }) as Anthropic.Tool.InputSchema,
  }));
}

export interface McpToolOutcome {
  isError: boolean;
  structured: Record<string, unknown> | undefined;
  textBlocks: string[];
  imageBlocks: Array<{ data: string; mimeType: string }>;
}

interface RawToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
}

export async function callMcpTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolOutcome> {
  const result = (await client.callTool({ name, arguments: args })) as RawToolResult;
  const content = result.content ?? [];
  return {
    isError: result.isError === true,
    structured: result.structuredContent,
    textBlocks: content.filter((c) => c.type === "text").map((c) => c.text ?? ""),
    imageBlocks: content
      .filter((c) => c.type === "image")
      .map((c) => ({ data: c.data ?? "", mimeType: c.mimeType ?? "image/png" })),
  };
}
