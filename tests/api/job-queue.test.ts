import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobQueueService } from '../../src/api/services/job-queue.js';
import { JobStore } from '../../src/api/services/job-store.js';
import type { Job } from '../../src/api/types.js';

// Mock renderVideo to avoid actual rendering
vi.mock('../../src/encoder/video-renderer.js', () => ({
  renderVideo: vi.fn().mockResolvedValue({
    outputPath: '/tmp/test-output.mp4',
    frames: 300,
    duration: 10,
    hasAudio: false,
  }),
}));

describe('JobQueueService', () => {
  let store: JobStore;
  let queue: JobQueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new JobStore();
    queue = new JobQueueService(store, { concurrency: 1 });
  });

  describe('enqueue', () => {
    it('should create job in store with queued status', async () => {
      const jobId = 'test-job-1';
      await queue.enqueue({
        id: jobId,
        spec: {
          output: { width: 1920, height: 1080, fps: 30, duration: 10 },
          scenes: [{ duration: 10, elements: [] }],
        },
        userId: 'user-1',
      });

      // Wait for queue to process
      await queue.onIdle();

      const job = store.get(jobId);
      expect(job).toBeDefined();
      expect(job?.status).toBe('completed');
    });

    it('should emit job:processing when job starts', async () => {
      const processingHandler = vi.fn();
      queue.on('job:processing', processingHandler);

      await queue.enqueue({
        id: 'test-job-2',
        spec: {
          output: { width: 1920, height: 1080, fps: 30, duration: 10 },
          scenes: [{ duration: 10, elements: [] }],
        },
        userId: 'user-1',
      });

      await queue.onIdle();
      expect(processingHandler).toHaveBeenCalledWith('test-job-2');
    });

    it('should emit job:completed with result on success', async () => {
      const completedHandler = vi.fn();
      queue.on('job:completed', completedHandler);

      await queue.enqueue({
        id: 'test-job-3',
        spec: {
          output: { width: 1920, height: 1080, fps: 30, duration: 10 },
          scenes: [{ duration: 10, elements: [] }],
        },
        userId: 'user-1',
      });

      await queue.onIdle();
      expect(completedHandler).toHaveBeenCalledWith('test-job-3', expect.objectContaining({
        outputPath: expect.any(String),
      }));
    });

    it('should emit job:failed on render error', async () => {
      // Override mock for this test
      const { renderVideo } = await import('../../src/encoder/video-renderer.js');
      vi.mocked(renderVideo).mockRejectedValueOnce(new Error('Render failed'));

      const failedHandler = vi.fn();
      queue.on('job:failed', failedHandler);

      await queue.enqueue({
        id: 'test-job-4',
        spec: {
          output: { width: 1920, height: 1080, fps: 30, duration: 10 },
          scenes: [{ duration: 10, elements: [] }],
        },
        userId: 'user-1',
      });

      await queue.onIdle();
      expect(failedHandler).toHaveBeenCalledWith('test-job-4', expect.any(Error));

      const job = store.get('test-job-4');
      expect(job?.status).toBe('failed');
      expect(job?.error).toBe('Render failed');
    });
  });

  describe('getJob', () => {
    it('should delegate to job store', () => {
      const job: Job = { id: 'job-1', status: 'queued', created_at: Date.now() };
      store.create(job);
      expect(queue.getJob('job-1')).toEqual(job);
    });
  });

  describe('queue metrics', () => {
    it('should report size and pending counts', async () => {
      expect(queue.size).toBe(0);
      expect(queue.pending).toBe(0);
    });
  });
});
