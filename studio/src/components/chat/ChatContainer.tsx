import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    clearConversation,
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
    <div className="h-screen flex flex-col bg-slate-950">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900">
        <h1 className="text-xl font-semibold bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
          GameMotion Studio
        </h1>
        <Button
          variant="outline"
          size="sm"
          onClick={clearConversation}
          className="gap-2"
        >
          <Plus className="size-4" />
          New Chat
        </Button>
      </header>

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
