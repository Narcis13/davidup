import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Types matching backend response
export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: number;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  templateJson: string | null;
  createdAt: string;
}

// Query keys for cache management
export const chatKeys = {
  all: ['chat'] as const,
  conversations: () => [...chatKeys.all, 'conversations'] as const,
  conversationMessages: (id: string) =>
    [...chatKeys.all, 'messages', id] as const,
};

// Fetch all conversations
export function useConversations() {
  return useQuery({
    queryKey: chatKeys.conversations(),
    queryFn: async (): Promise<Conversation[]> => {
      const response = await fetch('/studio/conversations');
      if (!response.ok) {
        throw new Error('Failed to fetch conversations');
      }
      return response.json();
    },
  });
}

// Fetch messages for a specific conversation
export function useConversationMessages(conversationId: string | null) {
  return useQuery({
    queryKey: chatKeys.conversationMessages(conversationId || ''),
    queryFn: async (): Promise<ConversationMessage[]> => {
      if (!conversationId) {
        return [];
      }

      const response = await fetch(
        `/studio/conversations/${conversationId}/messages`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch messages');
      }
      return response.json();
    },
    enabled: !!conversationId,
  });
}

// Delete a conversation
export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: string): Promise<void> => {
      const response = await fetch(`/studio/conversations/${conversationId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete conversation');
      }
    },
    onSuccess: () => {
      // Invalidate conversations list to refetch
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
    },
  });
}
