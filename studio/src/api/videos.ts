import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';

// Types matching backend/database schema
export interface StudioVideo {
  id: string;
  template_id: string | null;
  template_name?: string; // Joined from templates table
  filename: string;
  file_path: string;
  thumbnail_path: string | null;
  duration_ms: number | null;
  file_size_bytes: number | null;
  status: 'rendering' | 'completed' | 'failed';
  created_at: string;
}

export interface VideoListOptions {
  templateId?: string | null;
}

export interface RenderProgress {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  error?: string;
  videoId?: string;
}

// Query keys for cache management
export const videoKeys = {
  all: ['studio-videos'] as const,
  list: (opts?: VideoListOptions) => [...videoKeys.all, 'list', opts] as const,
  detail: (id: string) => [...videoKeys.all, 'detail', id] as const,
};

// Fetch all videos with optional template filter
export function useVideos(options?: VideoListOptions) {
  return useQuery({
    queryKey: videoKeys.list(options),
    queryFn: async (): Promise<StudioVideo[]> => {
      const params = new URLSearchParams();
      if (options?.templateId) {
        params.set('templateId', options.templateId);
      }
      const url = params.toString()
        ? `/studio/videos?${params.toString()}`
        : '/studio/videos';
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch videos');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes (consistent with templates)
  });
}

// Delete single video
export function useDeleteVideo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const response = await fetch(`/studio/videos/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete video');
    },
    // Optimistic update
    onMutate: async (id) => {
      // Cancel in-flight queries to prevent race conditions
      await queryClient.cancelQueries({ queryKey: videoKeys.all });

      // Snapshot current data for rollback
      const previousVideos = queryClient.getQueriesData<StudioVideo[]>({
        queryKey: videoKeys.all,
      });

      // Optimistically remove the video from all matching queries
      queryClient.setQueriesData<StudioVideo[]>(
        { queryKey: videoKeys.all },
        (old) => old?.filter((v) => v.id !== id)
      );

      return { previousVideos };
    },
    onError: (_, __, context) => {
      // Rollback on error
      if (context?.previousVideos) {
        for (const [queryKey, data] of context.previousVideos) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: videoKeys.all });
    },
  });
}

// Batch delete videos
export function useBatchDeleteVideos() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]): Promise<{ deleted: number }> => {
      const response = await fetch('/studio/videos/delete-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error('Failed to delete videos');
      return response.json();
    },
    // Optimistic update
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: videoKeys.all });

      const previousVideos = queryClient.getQueriesData<StudioVideo[]>({
        queryKey: videoKeys.all,
      });

      // Optimistically remove all videos with matching ids
      const idsSet = new Set(ids);
      queryClient.setQueriesData<StudioVideo[]>(
        { queryKey: videoKeys.all },
        (old) => old?.filter((v) => !idsSet.has(v.id))
      );

      return { previousVideos };
    },
    onError: (_, __, context) => {
      if (context?.previousVideos) {
        for (const [queryKey, data] of context.previousVideos) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: videoKeys.all });
    },
  });
}

// Open video in system player
export function useOpenVideo() {
  return useMutation({
    mutationFn: async (id: string): Promise<{ success: boolean }> => {
      const response = await fetch(`/studio/videos/${id}/open`, {
        method: 'POST',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to open video');
      }
      return response.json();
    },
  });
}

// Render video from template with progress tracking
export function useRenderVideo(options?: {
  onComplete?: (videoId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup function for interval
  const clearPollInterval = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const pollForProgress = (jobId: string) => {
    // Clear any existing interval first
    clearPollInterval();

    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/studio/render/${jobId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch render status');
        }
        const job = await response.json();

        setProgress({
          status: job.status,
          progress: job.progress,
          error: job.error,
          videoId: job.video_id,
        });

        // Stop polling when complete or failed
        if (job.status === 'completed' || job.status === 'failed') {
          clearPollInterval();

          // Invalidate video list cache so new video appears
          queryClient.invalidateQueries({ queryKey: videoKeys.all });

          // Call onComplete callback if provided and successful
          if (job.status === 'completed' && job.video_id && options?.onComplete) {
            options.onComplete(job.video_id);
          }
        }
      } catch (error) {
        console.error('Failed to poll for render progress:', error);
        // Don't stop polling on network error - might be temporary
      }
    }, 1000); // Poll every second
  };

  const mutation = useMutation({
    mutationFn: async (templateId: string): Promise<{ jobId: string }> => {
      const response = await fetch(`/studio/templates/${templateId}/render`, {
        method: 'POST',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start render');
      }
      return response.json();
    },
    onSuccess: (data) => {
      // Start polling for progress
      setProgress({ status: 'queued' });
      pollForProgress(data.jobId);
    },
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearPollInterval();
    };
  }, []);

  const resetProgress = () => {
    clearPollInterval();
    setProgress(null);
  };

  return {
    render: mutation.mutate,
    renderAsync: mutation.mutateAsync,
    isRendering:
      mutation.isPending ||
      progress?.status === 'queued' ||
      progress?.status === 'processing',
    progress,
    resetProgress,
    error: mutation.error,
  };
}
