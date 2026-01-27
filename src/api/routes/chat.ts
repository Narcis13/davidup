/**
 * Chat API routes with SSE streaming.
 * Provides conversational AI interface for video template generation.
 * No auth required - this is a local development tool.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { callOpenRouter, DEFAULT_MODEL } from '../services/ai-client.js';
import db from '../services/studio-db.js';

export const chatRoutes = new Hono();

/**
 * Request format for chat endpoint.
 */
interface ChatRequest {
  conversationId?: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * Build system prompt for the AI assistant.
 * Explains the assistant's role and the VideoSpec JSON format.
 */
function buildSystemPrompt(): string {
  return `You are a video template generator assistant for GameMotion.

When the user describes a video they want to create, generate a valid VideoSpec JSON template.

## VideoSpec JSON Structure

A VideoSpec defines a video with:
- **output**: { width, height, fps, format } - Video dimensions and settings
- **scenes**: Array of scenes, each with:
  - **duration**: Duration in milliseconds
  - **layers**: Array of visual elements (text, image, shape, video)
  - **animations**: Optional array of animation effects

## Example VideoSpec:

\`\`\`json
{
  "output": { "width": 1080, "height": 1920, "fps": 30, "format": "mp4" },
  "scenes": [
    {
      "duration": 5000,
      "layers": [
        {
          "type": "text",
          "text": "{{headline}}",
          "position": { "x": 540, "y": 960 },
          "style": {
            "fontSize": 72,
            "fontFamily": "Inter",
            "color": "#FFFFFF",
            "textAlign": "center"
          }
        }
      ],
      "animations": [
        {
          "target": 0,
          "keyframes": [
            { "time": 0, "opacity": 0 },
            { "time": 500, "opacity": 1 }
          ]
        }
      ]
    }
  ]
}
\`\`\`

## Variable Syntax

Use \`{{variableName}}\` syntax for user-customizable content. Examples:
- \`{{headline}}\` - Main title text
- \`{{productName}}\` - Product name
- \`{{price}}\` - Price value
- \`{{logoUrl}}\` - URL to logo image

## Guidelines

1. For new template requests, create a complete VideoSpec JSON
2. For refinement requests like "make it shorter" or "change the font", modify the previous template
3. Include a brief explanation before the JSON if helpful
4. Always respond with valid, parseable JSON for the template portion
5. Use realistic dimensions: 1080x1920 for vertical (TikTok/Reels), 1920x1080 for horizontal
6. Keep durations reasonable: 3000-15000ms for short videos

When providing a template, wrap the JSON in a code block like:

\`\`\`json
{ ... }
\`\`\``;
}

/**
 * Extract JSON template from AI response content.
 * Handles both pure JSON and JSON embedded in markdown code blocks.
 */
function extractTemplate(content: string): object | null {
  // Try to extract JSON from markdown code block
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Not valid JSON in code block
    }
  }

  // Try to parse the whole content as JSON
  try {
    return JSON.parse(content);
  } catch {
    // Not valid JSON
  }

  return null;
}

/**
 * POST /chat - Streaming chat endpoint for AI template generation.
 *
 * Accepts a message, calls OpenRouter, and streams the response via SSE.
 * Creates/updates conversation and persists messages in SQLite.
 */
chatRoutes.post('/chat', async (c) => {
  const body = await c.req.json<ChatRequest>();
  const { message, history = [] } = body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return c.json({ error: 'Message is required' }, 400);
  }

  // Create or get conversation
  let conversationId = body.conversationId;
  if (!conversationId) {
    conversationId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO conversations (id, title) VALUES (?, ?)
    `).run(conversationId, message.slice(0, 50));
  }

  // Save user message
  const userMessageId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content)
    VALUES (?, ?, 'user', ?)
  `).run(userMessageId, conversationId, message);

  // Update conversation timestamp
  db.prepare(`
    UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
  `).run(conversationId);

  // Build messages array for OpenRouter
  // Include system prompt, conversation history, and current message
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: buildSystemPrompt() },
    ...history.slice(-10).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: message },
  ];

  return streamSSE(c, async (stream) => {
    try {
      // Call OpenRouter API
      const response = await callOpenRouter({
        model: DEFAULT_MODEL,
        messages,
        max_tokens: 4096,
      });

      const content = response.choices[0]?.message?.content ?? '';

      if (!content) {
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', message: 'No response from AI' }),
          event: 'message',
        });
        return;
      }

      // Stream the response in chunks (simulated streaming for non-streaming API)
      // Break into ~50 character chunks for typing effect
      // Use [\s\S] instead of . with s flag for cross-line matching (ES2018 flag compatibility)
      const chunks = content.match(/[\s\S]{1,50}/g) ?? [content];
      for (const chunk of chunks) {
        await stream.writeSSE({
          data: JSON.stringify({ type: 'chunk', content: chunk }),
          event: 'message',
        });
        await stream.sleep(20); // Small delay for typing effect
      }

      // Save assistant message to database
      const assistantMessageId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO messages (id, conversation_id, role, content)
        VALUES (?, ?, 'assistant', ?)
      `).run(assistantMessageId, conversationId, content);

      // Update conversation timestamp
      db.prepare(`
        UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
      `).run(conversationId);

      // Extract template JSON if present
      const template = extractTemplate(content);

      // Send done event with metadata
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'done',
          conversationId,
          messageId: assistantMessageId,
          template,
        }),
        event: 'message',
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('[chat] Error:', errorMessage);

      await stream.writeSSE({
        data: JSON.stringify({
          type: 'error',
          message: errorMessage,
        }),
        event: 'error',
      });
    }
  });
});
