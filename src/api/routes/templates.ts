/**
 * Templates routes - GET /templates, GET /templates/:id, POST /templates/:id/render
 *
 * Access built-in templates and render with variable substitution.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { templateStore } from '../services/template-store.js';
import { substituteVariables } from '../services/variable-substitution.js';
import { JobQueueService } from '../services/job-queue.js';
import { JobStore } from '../services/job-store.js';
import { deliverWebhook } from '../services/webhook.js';
import { validateVideoSpec } from '../../validators/spec-validator.js';
import type { PlanTier } from '../types.js';
import type { VideoSpec } from '../../types/index.js';

// Re-use job infrastructure from render routes
const jobStore = new JobStore();
const jobQueue = new JobQueueService(jobStore);

// Wire up webhooks
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

// Validation schemas
const TemplateIdSchema = z.object({
  id: z.string().min(1),
});

const RenderTemplateRequestSchema = z.object({
  variables: z.record(z.string()).default({}),
  webhook_url: z.string().url().optional(),
  sync: z.boolean().default(false),
});

export const templateRoutes = new Hono<{
  Variables: { userId: string; plan: PlanTier };
}>();

/**
 * GET /templates - List all built-in templates
 */
templateRoutes.get('/', async (c) => {
  const templates = templateStore.list();

  return c.json({
    templates: templates.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      platform: t.platform,
      style: t.style,
      variables: t.variables,
    })),
  });
});

/**
 * GET /templates/:id - Get template details with full spec
 */
templateRoutes.get('/:id', zValidator('param', TemplateIdSchema), async (c) => {
  const { id } = c.req.valid('param');
  const template = templateStore.get(id);

  if (!template) {
    return c.json({ error: 'Template not found' }, 404);
  }

  return c.json({
    id: template.id,
    name: template.name,
    description: template.description,
    platform: template.platform,
    style: template.style,
    variables: template.variables,
    spec: template.spec,
  });
});

/**
 * POST /templates/:id/render - Render template with variable substitution
 */
templateRoutes.post(
  '/:id/render',
  zValidator('param', TemplateIdSchema),
  zValidator('json', RenderTemplateRequestSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { variables, webhook_url, sync } = c.req.valid('json');
    const userId = c.get('userId');

    // Get template
    const template = templateStore.get(id);
    if (!template) {
      return c.json({ error: 'Template not found' }, 404);
    }

    // Substitute variables
    const spec = substituteVariables(template.spec as VideoSpec, variables);

    // Validate substituted spec
    const validationResult = validateVideoSpec(spec);
    if (!validationResult.success) {
      return c.json({
        error: 'Invalid video specification after variable substitution',
        fieldErrors: validationResult.error.fieldErrors,
      }, 400);
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
            resolve(c.json({
              job_id: jobId,
              status: job?.status,
              result: job?.result,
            }, 200));
          }
        };

        const handleFailed = (failedJobId: string) => {
          if (failedJobId === jobId) {
            cleanup();
            const job = jobStore.get(jobId);
            resolve(c.json({
              job_id: jobId,
              status: 'failed',
              error: job?.error,
            }, 500));
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
          resolve(c.json({
            job_id: jobId,
            status: 'timeout',
            error: 'Sync mode timed out',
          }, 504));
        }, 5 * 60 * 1000);
      });
    }

    // Async mode: return immediately
    return c.json({
      job_id: jobId,
      status: 'queued',
      poll_url: `/render/${jobId}`,
    }, 202);
  }
);

// Export for testing
export { jobStore, jobQueue };
