/**
 * Render routes - POST /render, GET /render/:jobId
 *
 * Handles video render job submission and status polling.
 * Integrates with JobQueueService for async job processing
 * and WebhookService for completion notifications.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { validateVideoSpec } from '../../validators/spec-validator.js';
import { JobQueueService } from '../services/job-queue.js';
import { JobStore } from '../services/job-store.js';
import { deliverWebhook } from '../services/webhook.js';
import type { Job } from '../types.js';

// Request validation schemas
const RenderRequestSchema = z.object({
  spec: z.any(), // Validated manually with validateVideoSpec for better error messages
  webhook_url: z.string().url().optional(),
  sync: z.boolean().default(false),
});

const JobIdSchema = z.object({
  jobId: z.string().uuid(),
});

// Create shared instances (will be replaced with DI in production)
const jobStore = new JobStore();
const jobQueue = new JobQueueService(jobStore);

// Wire up webhook delivery on job completion
jobQueue.on('job:completed', async (jobId: string) => {
  const job = jobStore.get(jobId);
  if (job?.webhook_url) {
    await deliverWebhook(job.webhook_url, {
      job_id: jobId,
      status: 'completed',
      download_url: job.result?.download_url,
      timestamp: new Date().toISOString(),
    });
  }
});

jobQueue.on('job:failed', async (jobId: string) => {
  const job = jobStore.get(jobId);
  if (job?.webhook_url) {
    await deliverWebhook(job.webhook_url, {
      job_id: jobId,
      status: 'failed',
      error: job.error,
      timestamp: new Date().toISOString(),
    });
  }
});

// Create router
export const renderRoutes = new Hono<{
  Variables: { userId: string; plan: 'free' | 'pro' };
}>();

/**
 * POST /render - Submit render job
 *
 * Accepts JSON spec, validates it, queues job, returns job ID.
 * If sync=true and video <30s, waits for completion.
 */
renderRoutes.post(
  '/',
  zValidator('json', RenderRequestSchema),
  async (c) => {
    const { spec, webhook_url, sync } = c.req.valid('json');
    const userId = c.get('userId');

    // Validate spec with our detailed validator
    const validationResult = validateVideoSpec(spec);
    if (!validationResult.success) {
      return c.json(
        {
          error: 'Invalid video specification',
          fieldErrors: validationResult.error.fieldErrors,
        },
        400
      );
    }

    const validSpec = validationResult.data;
    const jobId = randomUUID();

    // Calculate total duration for sync mode check
    const totalDuration = validSpec.scenes.reduce((sum, scene) => sum + scene.duration, 0);
    const isShortVideo = totalDuration <= 30;

    // Queue the job
    await jobQueue.enqueue({
      id: jobId,
      spec: validSpec,
      webhookUrl: webhook_url,
      userId,
    });

    // Sync mode: wait for completion (only for short videos)
    if (sync && isShortVideo) {
      return new Promise<Response>((resolve) => {
        const handleComplete = (completedJobId: string) => {
          if (completedJobId === jobId) {
            cleanup();
            const job = jobStore.get(jobId);
            resolve(
              c.json(
                {
                  job_id: jobId,
                  status: job?.status,
                  result: job?.result,
                },
                200
              )
            );
          }
        };

        const handleFailed = (failedJobId: string) => {
          if (failedJobId === jobId) {
            cleanup();
            const job = jobStore.get(jobId);
            resolve(
              c.json(
                {
                  job_id: jobId,
                  status: 'failed',
                  error: job?.error,
                },
                500
              )
            );
          }
        };

        const cleanup = () => {
          jobQueue.off('job:completed', handleComplete);
          jobQueue.off('job:failed', handleFailed);
        };

        jobQueue.on('job:completed', handleComplete);
        jobQueue.on('job:failed', handleFailed);

        // Timeout after 5 minutes
        setTimeout(() => {
          cleanup();
          resolve(
            c.json(
              {
                job_id: jobId,
                status: 'timeout',
                error: 'Sync mode timed out',
              },
              504
            )
          );
        }, 5 * 60 * 1000);
      });
    }

    // Async mode: return immediately
    return c.json(
      {
        job_id: jobId,
        status: 'queued',
        poll_url: `/render/${jobId}`,
      },
      202
    );
  }
);

/**
 * GET /render/:jobId - Get job status
 */
renderRoutes.get('/:jobId', zValidator('param', JobIdSchema), async (c) => {
  const { jobId } = c.req.valid('param');
  const job = jobStore.get(jobId);

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  const response: Record<string, unknown> = {
    job_id: job.id,
    status: job.status,
    created_at: job.created_at,
  };

  if (job.progress !== undefined) {
    response.progress = job.progress;
  }

  if (job.status === 'completed' && job.result) {
    response.result = job.result;
    response.completed_at = job.completed_at;
  }

  if (job.status === 'failed') {
    response.error = job.error;
    response.completed_at = job.completed_at;
  }

  return c.json(response);
});

// Export for testing
export { jobStore, jobQueue };
