import { useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { Message } from './Message';
import { TypingIndicator } from './TypingIndicator';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import type { Message as MessageType } from '@/stores/chatStore';

interface MessageListProps {
  messages: MessageType[];
  streamingContent: string;
  isGenerating: boolean;
  error: string | null;
}

export function MessageList({
  messages,
  streamingContent,
  isGenerating,
  error,
}: MessageListProps) {
  const { containerRef, isAtBottom, scrollToBottom } = useAutoScroll<HTMLDivElement>();

  // Auto-scroll when new content arrives and user is at bottom
  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
  }, [messages, streamingContent, isAtBottom, scrollToBottom]);

  const hasMessages = messages.length > 0 || streamingContent;

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 space-y-4"
    >
      {!hasMessages && !isGenerating && (
        <div className="flex items-center justify-center h-full text-slate-500">
          <p>Start a conversation to create video templates</p>
        </div>
      )}

      {messages.map((msg) => (
        <Message
          key={msg.id}
          role={msg.role}
          content={msg.content}
          template={msg.template}
        />
      ))}

      {/* Streaming message in progress */}
      {streamingContent && (
        <Message role="assistant" content={streamingContent} />
      )}

      {/* Typing indicator when generating but no content yet */}
      {isGenerating && !streamingContent && <TypingIndicator />}

      {/* Error display */}
      {error && (
        <div className="flex items-start gap-3 bg-red-950 border border-red-800 rounded-lg p-4 text-red-200">
          <AlertCircle className="size-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Error</p>
            <p className="text-sm text-red-300">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}
