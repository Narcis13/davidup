# Phase 8: Chat Interface - Research

**Researched:** 2026-01-27
**Domain:** React chat UI with SSE streaming, conversation state management, AI template refinement
**Confidence:** HIGH

## Summary

This phase implements a conversational AI interface for creating and refining video templates through natural language. The core technical challenge is handling SSE (Server-Sent Events) streaming from the backend AI integration (Phase 6) while maintaining conversation context in a reactive UI.

Research confirms the standard approach: use `fetch` + `ReadableStream` for SSE consumption (not `EventSource`, as noted in prior decisions - EventSource cannot POST), Zustand for UI/conversation state, and TanStack Query for mutations. The existing Hono backend already has the `streamSSE` helper available for the streaming endpoint. The frontend from Phase 7 already has shadcn/ui configured, which provides the building blocks for chat UI components.

The chat interface follows a standard pattern: bottom-sticky input, scrollable message history with visual distinction between user/AI messages, typing indicator during generation, and action buttons (copy JSON, new conversation). Context is maintained by storing conversation history in SQLite (schema already exists from Phase 7) and sending the full message array to OpenAI-compatible API on each request.

**Primary recommendation:** Build the chat as a single-page feature within the existing Studio app. Use Zustand for real-time streaming state (current message being generated, typing indicator), persist conversations via TanStack Query mutations to the existing `/studio/` API routes.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | ^19.2.0 | UI framework | Already installed in Phase 7 |
| zustand | ^5.x | Chat/streaming state | Project decision, minimal boilerplate, handles streaming well |
| @tanstack/react-query | ^5.x | Server state/mutations | Project decision, cache invalidation, optimistic updates |
| hono/streaming | built-in | Backend SSE | Already available in Hono, `streamSSE` helper |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | ^0.563.0 | Icons | Already installed, send/copy/new-chat icons |
| clsx + tailwind-merge | existing | Class utilities | Already in utils.ts from Phase 7 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zustand for streaming | TanStack Query alone | TanStack Query not designed for real-time streaming accumulation; Zustand simpler |
| fetch+ReadableStream | EventSource | EventSource cannot POST (needed for sending message body with auth) |
| Custom chat UI | Vercel AI SDK Elements | Extra dependency; shadcn components sufficient for MVP |
| useCopyToClipboard hook | navigator.clipboard directly | Hook provides better UX with feedback state |

**Installation:**

```bash
# In studio directory
npm install zustand @tanstack/react-query
```

## Architecture Patterns

### Recommended Project Structure

```
studio/src/
  components/
    chat/
      ChatContainer.tsx      # Main chat layout
      MessageList.tsx        # Scrollable message area
      Message.tsx            # Individual message bubble
      ChatInput.tsx          # Bottom-sticky input + send button
      TypingIndicator.tsx    # "AI is generating..." indicator
      TemplatePreview.tsx    # JSON template display with copy button
    ui/                      # Existing shadcn components
  hooks/
    useChatStream.ts         # SSE streaming hook
    useCopyToClipboard.ts    # Copy with feedback
    useAutoScroll.ts         # Scroll to bottom on new messages
  stores/
    chatStore.ts             # Zustand store for chat state
  api/
    chat.ts                  # TanStack Query hooks for mutations
  types/
    chat.ts                  # Chat-specific types
  App.tsx                    # Add chat route/view

src/api/routes/
  chat.ts                    # NEW: Streaming chat endpoint
```

### Pattern 1: SSE Streaming with fetch + ReadableStream

**What:** Consume SSE stream using fetch API instead of EventSource
**When to use:** All chat message submissions (POST with body required)
**Example:**

```typescript
// studio/src/hooks/useChatStream.ts
// Source: https://oneuptime.com/blog/post/2026-01-15-server-sent-events-sse-react/view

import { useCallback, useRef } from 'react';
import { useChatStore } from '@/stores/chatStore';

interface StreamOptions {
  conversationId: string;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export function useChatStream() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const { appendToCurrentMessage, setIsGenerating, setError } = useChatStore();

  const sendMessage = useCallback(async (options: StreamOptions) => {
    // Abort any existing request
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch('/studio/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          conversationId: options.conversationId,
          message: options.message,
          history: options.history,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Chat request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events (split on double newline)
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? ''; // Keep incomplete event in buffer

        for (const event of events) {
          if (!event.trim()) continue;

          // Parse SSE format: "data: {...}\n"
          const dataMatch = event.match(/^data: (.+)$/m);
          if (dataMatch) {
            const data = JSON.parse(dataMatch[1]);

            if (data.type === 'chunk') {
              appendToCurrentMessage(data.content);
            } else if (data.type === 'done') {
              // Final message with full template
              // Handled by TanStack Query invalidation
            } else if (data.type === 'error') {
              throw new Error(data.message);
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message);
      }
    } finally {
      setIsGenerating(false);
    }
  }, [appendToCurrentMessage, setIsGenerating, setError]);

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return { sendMessage, abort };
}
```

### Pattern 2: Zustand Store for Chat State

**What:** Manage real-time UI state for streaming messages
**When to use:** Current conversation, streaming state, typing indicator
**Example:**

```typescript
// studio/src/stores/chatStore.ts
// Source: https://github.com/pmndrs/zustand

import { create } from 'zustand';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  template?: object; // Extracted JSON template if present
  createdAt: string;
}

interface ChatState {
  // Conversation state
  conversationId: string | null;
  messages: Message[];

  // Streaming state
  currentStreamingMessage: string;
  isGenerating: boolean;
  error: string | null;

  // Actions
  setConversationId: (id: string | null) => void;
  addUserMessage: (content: string) => void;
  appendToCurrentMessage: (chunk: string) => void;
  finalizeAssistantMessage: (template?: object) => void;
  setIsGenerating: (value: boolean) => void;
  setError: (error: string | null) => void;
  clearConversation: () => void;
  loadConversation: (id: string, messages: Message[]) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: null,
  messages: [],
  currentStreamingMessage: '',
  isGenerating: false,
  error: null,

  setConversationId: (id) => set({ conversationId: id }),

  addUserMessage: (content) => set((state) => ({
    messages: [...state.messages, {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    }],
    currentStreamingMessage: '',
    error: null,
  })),

  appendToCurrentMessage: (chunk) => set((state) => ({
    currentStreamingMessage: state.currentStreamingMessage + chunk,
  })),

  finalizeAssistantMessage: (template) => set((state) => ({
    messages: [...state.messages, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: state.currentStreamingMessage,
      template,
      createdAt: new Date().toISOString(),
    }],
    currentStreamingMessage: '',
  })),

  setIsGenerating: (value) => set({ isGenerating: value }),
  setError: (error) => set({ error, isGenerating: false }),

  clearConversation: () => set({
    conversationId: null,
    messages: [],
    currentStreamingMessage: '',
    error: null,
  }),

  loadConversation: (id, messages) => set({
    conversationId: id,
    messages,
    currentStreamingMessage: '',
    error: null,
  }),
}));
```

### Pattern 3: Hono SSE Streaming Endpoint

**What:** Backend endpoint that streams AI responses via SSE
**When to use:** POST /studio/chat endpoint
**Example:**

```typescript
// src/api/routes/chat.ts
// Source: https://hono.dev/docs/helpers/streaming

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { callOpenRouter } from '../services/ai-client.js';
import db from '../services/studio-db.js';

export const chatRoutes = new Hono();

interface ChatRequest {
  conversationId?: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

chatRoutes.post('/chat', async (c) => {
  const body = await c.req.json<ChatRequest>();
  const { message, history = [] } = body;

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

  // Build messages array for AI
  const messages = [
    { role: 'system' as const, content: buildSystemPrompt() },
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message },
  ];

  return streamSSE(c, async (stream) => {
    try {
      // Note: For streaming, we'd need to modify ai-client to support streaming
      // This is a simplified pattern showing the SSE structure
      const response = await callOpenRouter({
        model: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4',
        messages,
        response_format: { type: 'json_object' },
        max_tokens: 4096,
      });

      const content = response.choices[0]?.message?.content ?? '';

      // Stream the response in chunks (simulated for non-streaming API)
      // In production, use OpenRouter's streaming endpoint
      const chunks = content.match(/.{1,50}/g) ?? [content];
      for (const chunk of chunks) {
        await stream.writeSSE({
          data: JSON.stringify({ type: 'chunk', content: chunk }),
          event: 'message',
        });
        await stream.sleep(20); // Simulate typing effect
      }

      // Save assistant message
      const assistantMessageId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO messages (id, conversation_id, role, content)
        VALUES (?, ?, 'assistant', ?)
      `).run(assistantMessageId, conversationId, content);

      // Extract template if valid JSON
      let template = null;
      try {
        template = JSON.parse(content);
      } catch {
        // Not a valid template
      }

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
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'error',
          message: (err as Error).message,
        }),
        event: 'error',
      });
    }
  });
});

function buildSystemPrompt(): string {
  return `You are a video template generator assistant for GameMotion.

When the user describes a video they want to create, generate a valid VideoSpec JSON.
Use {{variableName}} syntax for user-customizable content.

For refinement requests like "make it shorter" or "change the font", modify the previously
generated template based on the user's feedback.

Always respond with valid JSON. Include a brief explanation before the JSON if helpful.

Example output:
Here's a template for your TikTok product showcase:

{
  "output": { "width": 1080, "height": 1920, "fps": 30 },
  "scenes": [...]
}`;
}
```

### Pattern 4: Auto-Scroll Hook

**What:** Scroll to bottom when new messages arrive, unless user scrolled up
**When to use:** Message list container
**Example:**

```typescript
// studio/src/hooks/useAutoScroll.ts
// Source: https://tuffstuff9.hashnode.dev/intuitive-scrolling-for-chatbot-message-streaming

import { useEffect, useRef, useState, useCallback } from 'react';

export function useAutoScroll<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, []);

  // Track if user is at bottom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Consider "at bottom" if within 100px of bottom
      setIsAtBottom(scrollHeight - scrollTop - clientHeight < 100);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  return { containerRef, isAtBottom, scrollToBottom };
}
```

### Pattern 5: Copy to Clipboard Hook

**What:** Copy JSON template with visual feedback
**When to use:** Copy button on template preview
**Example:**

```typescript
// studio/src/hooks/useCopyToClipboard.ts
// Source: https://usehooks-ts.com/react-hook/use-copy-to-clipboard

import { useState, useCallback } from 'react';

export function useCopyToClipboard(resetDelay = 2000) {
  const [isCopied, setIsCopied] = useState(false);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), resetDelay);
      return true;
    } catch (err) {
      console.error('Failed to copy:', err);
      return false;
    }
  }, [resetDelay]);

  return { copy, isCopied };
}
```

### Pattern 6: TanStack Query for Conversation Persistence

**What:** Mutations for saving conversations, queries for loading history
**When to use:** Starting new conversation, loading previous conversations
**Example:**

```typescript
// studio/src/api/chat.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// Fetch all conversations
export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: async (): Promise<Conversation[]> => {
      const res = await fetch('/studio/conversations');
      if (!res.ok) throw new Error('Failed to fetch conversations');
      return res.json();
    },
  });
}

// Fetch messages for a conversation
export function useConversationMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['conversation', conversationId, 'messages'],
    queryFn: async (): Promise<Message[]> => {
      const res = await fetch(`/studio/conversations/${conversationId}/messages`);
      if (!res.ok) throw new Error('Failed to fetch messages');
      return res.json();
    },
    enabled: !!conversationId,
  });
}

// Delete conversation
export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: string) => {
      const res = await fetch(`/studio/conversations/${conversationId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete conversation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}
```

### Anti-Patterns to Avoid

- **Using EventSource for POST requests:** EventSource only supports GET. Use fetch with ReadableStream.
- **Storing streaming state in TanStack Query:** Query cache is for server state. Use Zustand for in-flight streaming content.
- **Not cleaning up SSE connections:** Always abort fetch on component unmount to prevent memory leaks.
- **Blocking scroll during streaming:** Let user scroll up to read history; auto-scroll only if already at bottom.
- **Sending full template on every keystroke:** Debounce input; only send on submit.
- **Not escaping user input in AI prompts:** Sanitize to prevent prompt injection.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE parsing | Custom line parser | Standard SSE format with `data:` prefix | Well-defined spec, consistent |
| Clipboard access | execCommand fallback | navigator.clipboard API | Modern browsers, simpler |
| Scroll position tracking | Manual scroll math | useAutoScroll hook pattern | Edge cases with resize, content changes |
| Typing animation | setInterval character-by-character | CSS animation for dots, actual content streaming | Streaming IS the typing effect |
| Message ID generation | Custom counter | crypto.randomUUID() | Built into Node.js/browsers, RFC compliant |
| JSON template extraction | Regex parsing | JSON.parse with try/catch | Handles edge cases, escaping |

**Key insight:** The streaming response from the AI IS the typing animation. Don't add artificial character-by-character display - just render chunks as they arrive. This is both simpler and more authentic.

## Common Pitfalls

### Pitfall 1: Memory Leaks from Unclosed SSE Connections

**What goes wrong:** Component unmounts but fetch continues, attempts to update unmounted state
**Why it happens:** No cleanup in useEffect, AbortController not used
**How to avoid:** Always use AbortController, call abort() in useEffect cleanup
**Warning signs:** "Can't perform state update on unmounted component" (React 17), memory growth in DevTools

### Pitfall 2: Lost Context Between Messages

**What goes wrong:** AI forgets previous conversation turns, gives inconsistent responses
**Why it happens:** Not sending message history in API request
**How to avoid:** Send full conversation history (or summarized context) with each message
**Warning signs:** AI says "I don't have context" or contradicts previous statements

### Pitfall 3: JSON Extraction Fails on Mixed Content

**What goes wrong:** AI response includes explanation text + JSON, JSON.parse fails
**Why it happens:** Model returns "Here's your template: {json}" instead of pure JSON
**How to avoid:** Parse JSON from code blocks, or prompt model to return JSON only
**Warning signs:** "Unexpected token" errors, templates showing as raw text

### Pitfall 4: SSE Buffer Handling Across Chunks

**What goes wrong:** Incomplete JSON in one chunk causes parse errors
**Why it happens:** Network chunks don't align with SSE event boundaries
**How to avoid:** Buffer incoming data, split on `\n\n`, keep incomplete events for next chunk
**Warning signs:** Intermittent JSON parse errors, missing content

### Pitfall 5: Auto-Scroll Interrupts User Reading

**What goes wrong:** User scrolls up to read old messages, new content yanks them to bottom
**Why it happens:** Unconditional scrollToBottom on every message
**How to avoid:** Track if user is at bottom; only auto-scroll if they are
**Warning signs:** User complaints about "losing place" in conversation

### Pitfall 6: Conversation State Split Between Zustand and TanStack Query

**What goes wrong:** UI shows stale data, messages appear twice or not at all
**Why it happens:** Same data managed in two places, out of sync
**How to avoid:** Clear pattern: Zustand for streaming/ephemeral, TanStack Query for persisted. Sync on stream completion.
**Warning signs:** Duplicate messages, disappearing content on refresh

## Code Examples

### Message Component with Copy Button

```typescript
// studio/src/components/chat/Message.tsx
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

interface MessageProps {
  role: 'user' | 'assistant';
  content: string;
  template?: object;
}

export function Message({ role, content, template }: MessageProps) {
  const { copy, isCopied } = useCopyToClipboard();

  return (
    <div className={cn(
      "flex gap-3 p-4",
      role === 'user' ? "justify-end" : "justify-start"
    )}>
      <div className={cn(
        "max-w-[80%] rounded-xl px-4 py-3",
        role === 'user'
          ? "bg-blue-600 text-white"
          : "bg-slate-800 text-slate-100"
      )}>
        <div className="whitespace-pre-wrap">{content}</div>

        {template && (
          <div className="mt-3 pt-3 border-t border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400">Generated Template</span>
              <button
                onClick={() => copy(JSON.stringify(template, null, 2))}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
              >
                {isCopied ? (
                  <>
                    <Check className="w-3 h-3" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    Copy JSON
                  </>
                )}
              </button>
            </div>
            <pre className="text-xs bg-slate-900 p-2 rounded overflow-x-auto max-h-40">
              {JSON.stringify(template, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
```

### Typing Indicator

```typescript
// studio/src/components/chat/TypingIndicator.tsx
// Source: https://dev.to/3mustard/create-a-typing-animation-in-react-17o0

export function TypingIndicator() {
  return (
    <div className="flex gap-3 p-4">
      <div className="bg-slate-800 rounded-xl px-4 py-3">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
        </div>
      </div>
    </div>
  );
}
```

### Chat Input Component

```typescript
// studio/src/components/chat/ChatInput.tsx
import { useState, FormEvent } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput('');
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="sticky bottom-0 border-t border-slate-800 bg-slate-950 p-4"
    >
      <div className="flex gap-2 max-w-3xl mx-auto">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe your video template..."
          disabled={disabled}
          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <Button type="submit" disabled={disabled || !input.trim()}>
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </form>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| EventSource API | fetch + ReadableStream | Always for POST | Enables sending request body |
| Redux for all state | TanStack Query + Zustand split | 2024-2025 | ~80% less boilerplate |
| Character-by-character typing animation | Stream chunks directly | With SSE/streaming AI | Authentic experience, simpler code |
| WebSockets for chat | SSE for server-to-client | SSE for unidirectional | Simpler, auto-reconnect, HTTP/2 friendly |

**Deprecated/outdated:**
- **EventSource for POST requests:** Never worked; use fetch
- **Redux for server state:** TanStack Query handles caching, refetching better
- **Manual reconnection logic:** SSE auto-reconnects; focus on AbortController for cleanup

## Open Questions

1. **Streaming directly from OpenRouter**
   - What we know: Current ai-client.ts uses non-streaming fetch; OpenRouter supports streaming
   - What's unclear: Best pattern for converting OpenRouter stream to SSE stream in Hono
   - Recommendation: For MVP, simulate streaming from non-streaming response (as shown in examples). Can optimize to true streaming later.

2. **Conversation context window management**
   - What we know: OpenAI models have token limits; long conversations will exceed
   - What's unclear: When to truncate/summarize history
   - Recommendation: For MVP, send last 10 messages. Add context summarization if conversations get long.

3. **Template validation in chat flow**
   - What we know: Generated templates need validation; existing VideoSpecSchema from Phase 1
   - What's unclear: Whether to validate in streaming endpoint or let frontend handle
   - Recommendation: Validate on backend before sending "done" event; return validation errors as chat messages.

## Sources

### Primary (HIGH confidence)
- [Hono Streaming Helper](https://hono.dev/docs/helpers/streaming) - streamSSE API, verified
- [Zustand GitHub](https://github.com/pmndrs/zustand) - Store patterns, React 19 support
- [TanStack Query Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations) - useMutation API

### Secondary (MEDIUM confidence)
- [OneUptime SSE in React (Jan 2026)](https://oneuptime.com/blog/post/2026-01-15-server-sent-events-sse-react/view) - fetch+ReadableStream pattern
- [Federated State Patterns](https://dev.to/martinrojas/federated-state-done-right-zustand-tanstack-query-and-the-patterns-that-actually-work-27c0) - Zustand + TanStack Query integration
- [usehooks-ts Copy to Clipboard](https://usehooks-ts.com/react-hook/use-copy-to-clipboard) - Clipboard hook pattern
- [Intuitive Chat Scrolling](https://tuffstuff9.hashnode.dev/intuitive-scrolling-for-chatbot-message-streaming) - Auto-scroll patterns

### Tertiary (LOW confidence)
- Various DEV.to articles on typing indicators and chat UI patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Builds on existing Phase 7 setup, well-documented libraries
- Architecture: HIGH - Follows established Zustand + TanStack Query patterns
- Streaming: MEDIUM - fetch+ReadableStream pattern verified, but OpenRouter-to-SSE bridge needs implementation
- Pitfalls: HIGH - Well-documented React/SSE issues with known solutions

**Research date:** 2026-01-27
**Valid until:** ~30 days (stable patterns, React 19 ecosystem settling)
