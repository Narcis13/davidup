import { create } from 'zustand';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  template?: object;  // Extracted JSON template if present
  createdAt: string;
}

interface ChatState {
  // State
  conversationId: string | null;
  messages: Message[];
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

export const useChatStore = create<ChatState>((set) => ({
  // Initial state
  conversationId: null,
  messages: [],
  currentStreamingMessage: '',
  isGenerating: false,
  error: null,

  // Actions
  setConversationId: (id) => set({ conversationId: id }),

  addUserMessage: (content) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: crypto.randomUUID(),
          role: 'user',
          content,
          createdAt: new Date().toISOString(),
        },
      ],
      error: null,
    })),

  appendToCurrentMessage: (chunk) =>
    set((state) => ({
      currentStreamingMessage: state.currentStreamingMessage + chunk,
    })),

  finalizeAssistantMessage: (template) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: state.currentStreamingMessage,
          template,
          createdAt: new Date().toISOString(),
        },
      ],
      currentStreamingMessage: '',
      isGenerating: false,
    })),

  setIsGenerating: (value) => set({ isGenerating: value }),

  setError: (error) =>
    set({
      error,
      isGenerating: false,
      currentStreamingMessage: '',
    }),

  clearConversation: () =>
    set({
      conversationId: null,
      messages: [],
      currentStreamingMessage: '',
      isGenerating: false,
      error: null,
    }),

  loadConversation: (id, messages) =>
    set({
      conversationId: id,
      messages,
      currentStreamingMessage: '',
      isGenerating: false,
      error: null,
    }),
}));
