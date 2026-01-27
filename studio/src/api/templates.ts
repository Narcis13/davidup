import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Types matching backend/database schema
export interface StudioTemplate {
  id: string;
  name: string;
  spec: string; // JSON string of VideoSpec
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateInput {
  name: string;
  spec: object;
  conversationId?: string;
}

export interface UpdateTemplateInput {
  id: string;
  name: string;
}

// Query keys for cache management
export const templateKeys = {
  all: ['studio-templates'] as const,
  list: () => [...templateKeys.all, 'list'] as const,
  detail: (id: string) => [...templateKeys.all, 'detail', id] as const,
};

// Fetch all templates
export function useTemplates() {
  return useQuery({
    queryKey: templateKeys.list(),
    queryFn: async (): Promise<StudioTemplate[]> => {
      const response = await fetch('/studio/templates');
      if (!response.ok) throw new Error('Failed to fetch templates');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes (project decision from 08-02)
  });
}

// Fetch single template
export function useTemplate(id: string) {
  return useQuery({
    queryKey: templateKeys.detail(id),
    queryFn: async (): Promise<StudioTemplate> => {
      const response = await fetch(`/studio/templates/${id}`);
      if (!response.ok) throw new Error('Failed to fetch template');
      return response.json();
    },
    enabled: !!id,
  });
}

// Create template (save from chat)
export function useCreateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTemplateInput): Promise<StudioTemplate> => {
      const response = await fetch('/studio/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error('Failed to save template');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.list() });
    },
  });
}

// Update template (rename)
export function useUpdateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateTemplateInput): Promise<StudioTemplate> => {
      const response = await fetch(`/studio/templates/${input.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: input.name }),
      });
      if (!response.ok) throw new Error('Failed to update template');
      return response.json();
    },
    // Optimistic update
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: templateKeys.list() });
      const previous = queryClient.getQueryData<StudioTemplate[]>(
        templateKeys.list()
      );

      queryClient.setQueryData<StudioTemplate[]>(templateKeys.list(), (old) =>
        old?.map((t) => (t.id === input.id ? { ...t, name: input.name } : t))
      );

      return { previous };
    },
    onError: (_, __, context) => {
      if (context?.previous) {
        queryClient.setQueryData(templateKeys.list(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.list() });
    },
  });
}

// Delete template
export function useDeleteTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const response = await fetch(`/studio/templates/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete template');
    },
    // Optimistic update
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: templateKeys.list() });
      const previous = queryClient.getQueryData<StudioTemplate[]>(
        templateKeys.list()
      );

      queryClient.setQueryData<StudioTemplate[]>(templateKeys.list(), (old) =>
        old?.filter((t) => t.id !== id)
      );

      return { previous };
    },
    onError: (_, __, context) => {
      if (context?.previous) {
        queryClient.setQueryData(templateKeys.list(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.list() });
    },
  });
}
