import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { useChatStore } from '@/stores/chatStore';
import { useChatStream } from '@/hooks/useChatStream';

export function ChatContainer() {
  const {
    messages,
    currentStreamingMessage,
    isGenerating,
    error,
    conversationId,
    addUserMessage,
  } = useChatStore();

  const { sendMessage } = useChatStream();

  const handleSend = async (message: string) => {
    // Add user message to store immediately (optimistic)
    addUserMessage(message);

    // Build history from current messages (only role and content needed for API)
    const history: { role: 'user' | 'assistant'; content: string }[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Send to backend
    await sendMessage({
      conversationId: conversationId ?? null,
      message,
      history,
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Message List */}
      <MessageList
        messages={messages}
        streamingContent={currentStreamingMessage}
        isGenerating={isGenerating}
        error={error}
        conversationId={conversationId}
      />

      {/* Chat Input */}
      <ChatInput onSend={handleSend} disabled={isGenerating} />
    </div>
  );
}
