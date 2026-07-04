// Drives Claude Opus 4.8 against a live MCP session as an authoring agent —
// a manual tool-use loop (not the SDK tool runner, since the "tools" here
// are dynamic, server-supplied MCP definitions rather than local functions).
//
// Per the `claude-api` skill: default to Opus 4.8 with adaptive thinking.
// Effort is pinned to "medium" rather than the "high" default — this loop
// runs nightly, unattended, across ~10 briefs, so cost/latency predictability
// matters more here than squeezing out the last bit of authoring quality.

import Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { callMcpTool } from "./mcpSession.js";
import type { AgentLoopResult } from "./types.js";

export const EVAL_MODEL = "claude-opus-4-8";

const MAX_TOOL_RESULT_TEXT_CHARS = 4000;
const MAX_FINAL_MESSAGE_CHARS = 2000;

export const SYSTEM_PROMPT = `You are authoring a short video using the davidup MCP tools. Every tool call \
acts on one implicit "current" composition held in the server process — there is no filesystem access, so any \
asset you need (fonts, images, audio, video) must be registered via \`register_asset\` using the exact absolute \
paths given to you in the brief.

Work through the brief using the tools available to you: start with \`create_composition\`, add layers and items, \
register any assets the brief names, animate with \`add_tween\` and/or \`apply_behavior\`/\`apply_template\`, and use \
\`list_easings\`/\`list_behaviors\`/\`list_templates\`/\`list_engine_capabilities\` to discover what's available rather \
than guessing. \`render_preview_frame\`/\`render_thumbnail_strip\` let you visually check your work as you go — use \
them if you want to confirm something looks right.

Call \`validate\` before you consider yourself done, and fix anything it reports. You do not need to render the \
final video yourself — that happens after you finish. When the composition is complete and validates cleanly, \
stop calling tools and reply with a short plain-text summary of what you built.`;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

function buildToolResultContent(
  outcome: Awaited<ReturnType<typeof callMcpTool>>,
): Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> {
  const blocks: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];
  for (const text of outcome.textBlocks) {
    if (text.length > 0) {
      blocks.push({ type: "text", text: truncate(text, MAX_TOOL_RESULT_TEXT_CHARS) });
    }
  }
  for (const image of outcome.imageBlocks) {
    const mediaType = image.mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: image.data },
    });
  }
  if (blocks.length === 0) {
    blocks.push({
      type: "text",
      text: outcome.isError ? "Tool call failed with no message." : "OK (no content returned).",
    });
  }
  return blocks;
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export async function runAgentLoop(options: {
  anthropic: Anthropic;
  mcpClient: Client;
  tools: Anthropic.Tool[];
  userPrompt: string;
  maxIterations: number;
}): Promise<AgentLoopResult> {
  const { anthropic, mcpClient, tools, userPrompt, maxIterations } = options;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];

  let toolCallCount = 0;
  let iterations = 0;
  let stopReason: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  const toolErrors: string[] = [];
  let finalMessage = "";

  while (iterations < maxIterations) {
    iterations++;
    const response = await anthropic.messages.create({
      model: EVAL_MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    stopReason = response.stop_reason;
    messages.push({ role: "assistant", content: response.content });

    const text = extractText(response.content);
    if (text) finalMessage = text;

    if (stopReason === "refusal") break;
    if (stopReason !== "tool_use") break;

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      toolCallCount++;
      try {
        const outcome = await callMcpTool(mcpClient, block.name, (block.input ?? {}) as Record<string, unknown>);
        if (outcome.isError) {
          toolErrors.push(`${block.name}: ${outcome.textBlocks.join(" ").slice(0, 300)}`);
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          is_error: outcome.isError,
          content: buildToolResultContent(outcome),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toolErrors.push(`${block.name}: ${message}`);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          is_error: true,
          content: [{ type: "text", text: `MCP call threw: ${message}` }],
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    toolCallCount,
    iterations,
    stopReason,
    finishedNaturally: stopReason === "end_turn",
    toolErrorCount: toolErrors.length,
    toolErrors,
    inputTokens,
    outputTokens,
    finalMessage: truncate(finalMessage, MAX_FINAL_MESSAGE_CHARS),
  };
}
