import { useRef, useCallback } from 'react';
import { useChatStore, type Message } from '@/stores/chatStore';

interface SendMessageOptions {
  conversationId: string | null;
  message: string;
  history: Message[];
}

interface SSEEvent {
  type: 'chunk' | 'done' | 'error';
  content?: string;
  conversationId?: string;
  template?: object;
  error?: string;
}

export function useChatStream() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const {
    setIsGenerating,
    appendToCurrentMessage,
    finalizeAssistantMessage,
    setError,
    setConversationId,
  } = useChatStore();

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  }, [setIsGenerating]);

  const sendMessage = useCallback(
    async ({ conversationId, message, history }: SendMessageOptions) => {
      // Abort any existing request
      abort();

      // Create new AbortController
      abortControllerRef.current = new AbortController();

      setIsGenerating(true);

      try {
        const response = await fetch('/studio/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            conversationId,
            message,
            history: history.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || `HTTP ${response.status}`);
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep incomplete event in buffer

          for (const line of lines) {
            if (!line.startsWith('data: ')) {
              continue;
            }

            const jsonStr = line.slice(6); // Remove 'data: ' prefix

            try {
              const event: SSEEvent = JSON.parse(jsonStr);

              switch (event.type) {
                case 'chunk':
                  if (event.content) {
                    appendToCurrentMessage(event.content);
                  }
                  // Update conversationId if provided (first chunk)
                  if (event.conversationId) {
                    setConversationId(event.conversationId);
                  }
                  break;

                case 'done':
                  finalizeAssistantMessage(event.template);
                  break;

                case 'error':
                  setError(event.error || 'Unknown error');
                  break;
              }
            } catch {
              // Ignore JSON parse errors for malformed events
              console.warn('Failed to parse SSE event:', jsonStr);
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          // Request was aborted, not an error
          return;
        }

        const message = error instanceof Error ? error.message : 'Unknown error';
        setError(message);
      } finally {
        abortControllerRef.current = null;
      }
    },
    [
      abort,
      setIsGenerating,
      appendToCurrentMessage,
      finalizeAssistantMessage,
      setError,
      setConversationId,
    ]
  );

  return { sendMessage, abort };
}
