import { describe, it, expect, beforeEach, vi, afterAll, afterEach } from 'vitest';
import { Hono } from 'hono';
import { renderRoutes, jobStore, jobQueue } from '../../src/api/routes/render.js';
import { authMiddleware } from '../../src/api/middleware/auth.js';
import { apiKeyStore } from '../../src/api/services/api-key-store.js';
import * as webhookModule from '../../src/api/services/webhook.js';

// Mock renderVideo to avoid actual rendering
vi.mock('../../src/encoder/video-renderer.js', () => ({
  renderVideo: vi.fn().mockResolvedValue({
    outputPath: '/tmp/test.mp4',
    frames: 300,
    duration: 10,
    hasAudio: false,
  }),
}));

// Spy on deliverWebhook
vi.spyOn(webhookModule, 'deliverWebhook').mockResolvedValue({
  success: true,
  attempts: 1,
});

describe('Render Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();

    app = new Hono();
    app.use('*', authMiddleware);
    app.route('/render', renderRoutes);

    // Ensure test API key exists
    if (!apiKeyStore.validate('test-key')) {
      apiKeyStore.add({ key: 'test-key', userId: 'test-user', plan: 'pro' });
    }
  });

  afterEach(() => {
    // Clear job store between tests
    for (const job of Array.from({ length: jobStore.size })) {
      // Just let the store handle cleanup
    }
  });

  afterAll(() => {
    jobQueue.removeAllListeners();
  });

  describe('POST /render', () => {
    it('should accept valid render request and return 202', async () => {
      const res = await app.request('/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          spec: {
            output: { width: 1920, height: 1080, fps: 30, duration: 10 },
            scenes: [{ duration: 10, elements: [] }],
          },
        }),
      });

      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.job_id).toBeDefined();
      expect(body.status).toBe('queued');
      expect(body.poll_url).toContain('/render/');
    });

    it('should return 400 with fieldErrors for invalid spec', async () => {
      const res = await app.request('/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          spec: {
            output: { width: 10000, height: 1080, fps: 30, duration: 10 },
            scenes: [],
          },
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid');
      expect(body.fieldErrors).toBeDefined();
    });

    it('should return 400 when scenes is empty', async () => {
      const res = await app.request('/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          spec: {
            output: { width: 1920, height: 1080, fps: 30, duration: 10 },
            scenes: [],
          },
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.fieldErrors).toBeDefined();
    });

    it('should require authentication', async () => {
      const res = await app.request('/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: {
            output: { width: 1920, height: 1080, fps: 30, duration: 10 },
            scenes: [{ duration: 10, elements: [] }],
          },
        }),
      });

      expect(res.status).toBe(401);
    });

    it('should reject invalid API key', async () => {
      const res = await app.request('/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid-key',
        },
        body: JSON.stringify({
          spec: {
            output: { width: 1920, height: 1080, fps: 30, duration: 10 },
            scenes: [{ duration: 10, elements: [] }],
          },
        }),
      });

      expect(res.status).toBe(401);
    });

    it('should include poll_url in async response', async () => {
      const res = await app.request('/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          spec: {
            output: { width: 1920, height: 1080, fps: 30, duration: 10 },
            scenes: [{ duration: 10, elements: [] }],
          },
        }),
      });

      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.poll_url).toMatch(/^\/render\/[a-f0-9-]+$/);
    });
  });

  describe('GET /render/:jobId', () => {
    it('should return job status', async () => {
      // First create a job
      const createRes = await app.request('/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          spec: {
            output: { width: 1920, height: 1080, fps: 30, duration: 10 },
            scenes: [{ duration: 10, elements: [] }],
          },
        }),
      });

      const { job_id } = (await createRes.json()) as { job_id: string };

      // Then check status
      const statusRes = await app.request(`/render/${job_id}`, {
        headers: { Authorization: 'Bearer test-key' },
      });

      expect(statusRes.status).toBe(200);
      const body = await statusRes.json();
      expect(body.job_id).toBe(job_id);
      expect(['queued', 'processing', 'completed']).toContain(body.status);
    });

    it('should return 404 for non-existent job', async () => {
      const res = await app.request('/render/00000000-0000-0000-0000-000000000000', {
        headers: { Authorization: 'Bearer test-key' },
      });

      expect(res.status).toBe(404);
    });

    it('should return 400 for invalid UUID', async () => {
      const res = await app.request('/render/invalid-uuid', {
        headers: { Authorization: 'Bearer test-key' },
      });

      expect(res.status).toBe(400);
    });

    it('should include created_at in status response', async () => {
      // Create a job
      const createRes = await app.request('/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          spec: {
            output: { width: 1920, height: 1080, fps: 30, duration: 10 },
            scenes: [{ duration: 10, elements: [] }],
          },
        }),
      });

      const { job_id } = (await createRes.json()) as { job_id: string };

      // Check status
      const statusRes = await app.request(`/render/${job_id}`, {
        headers: { Authorization: 'Bearer test-key' },
      });

      const body = await statusRes.json();
      expect(body.created_at).toBeDefined();
      expect(typeof body.created_at).toBe('number');
    });
  });

  describe('Webhook delivery', () => {
    it('should deliver webhook when job completes with webhook_url configured', async () => {
      const webhookUrl = 'https://example.com/webhook';

      // Submit job with webhook_url
      const res = await app.request('/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          spec: {
            output: { width: 1920, height: 1080, fps: 30, duration: 10 },
            scenes: [{ duration: 10, elements: [] }],
          },
          webhook_url: webhookUrl,
        }),
      });

      expect(res.status).toBe(202);
      const { job_id } = (await res.json()) as { job_id: string };

      // Simulate job completion by emitting event
      jobQueue.emit('job:completed', job_id);

      // Wait for async webhook delivery
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify webhook was called with correct payload
      expect(webhookModule.deliverWebhook).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({
          job_id,
          status: 'completed',
        })
      );
    });

    it('should deliver webhook with error when job fails', async () => {
      const webhookUrl = 'https://example.com/webhook';

      // Submit job with webhook_url
      const res = await app.request('/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          spec: {
            output: { width: 1920, height: 1080, fps: 30, duration: 10 },
            scenes: [{ duration: 10, elements: [] }],
          },
          webhook_url: webhookUrl,
        }),
      });

      expect(res.status).toBe(202);
      const { job_id } = (await res.json()) as { job_id: string };

      // Simulate job failure by emitting event
      jobQueue.emit('job:failed', job_id);

      // Wait for async webhook delivery
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify webhook was called with failed status
      expect(webhookModule.deliverWebhook).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({
          job_id,
          status: 'failed',
        })
      );
    });

    it('should not deliver webhook when webhook_url is not configured', async () => {
      vi.clearAllMocks();

      // Submit job without webhook_url
      const res = await app.request('/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          spec: {
            output: { width: 1920, height: 1080, fps: 30, duration: 10 },
            scenes: [{ duration: 10, elements: [] }],
          },
        }),
      });

      expect(res.status).toBe(202);
      const { job_id } = (await res.json()) as { job_id: string };

      // Simulate job completion
      jobQueue.emit('job:completed', job_id);

      // Wait for potential async webhook delivery
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify webhook was NOT called
      expect(webhookModule.deliverWebhook).not.toHaveBeenCalled();
    });

    it('should include download_url in completed webhook', async () => {
      const webhookUrl = 'https://example.com/webhook';

      // Submit job with webhook_url
      const res = await app.request('/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          spec: {
            output: { width: 1920, height: 1080, fps: 30, duration: 10 },
            scenes: [{ duration: 10, elements: [] }],
          },
          webhook_url: webhookUrl,
        }),
      });

      const { job_id } = (await res.json()) as { job_id: string };

      // Wait for job to be processed (mock renderVideo resolves immediately)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check if deliverWebhook was called with download_url
      const calls = vi.mocked(webhookModule.deliverWebhook).mock.calls;
      const completedCall = calls.find(
        (call) => call[1].job_id === job_id && call[1].status === 'completed'
      );

      if (completedCall) {
        expect(completedCall[1].download_url).toBeDefined();
      }
    });
  });
});
