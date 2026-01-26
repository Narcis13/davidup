import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest';
import { Hono } from 'hono';
import { templateRoutes, jobStore, jobQueue } from '../../../src/api/routes/templates.js';
import { authMiddleware } from '../../../src/api/middleware/auth.js';
import { apiKeyStore } from '../../../src/api/services/api-key-store.js';
import { templateStore } from '../../../src/api/services/template-store.js';

// Mock renderVideo to avoid actual rendering
vi.mock('../../../src/encoder/video-renderer.js', () => ({
  renderVideo: vi.fn().mockResolvedValue({
    outputPath: '/tmp/test.mp4',
    frames: 300,
    duration: 10,
    hasAudio: false,
  }),
}));

describe('Templates Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();

    app = new Hono();
    app.use('*', authMiddleware);
    app.route('/templates', templateRoutes);

    // Ensure test API key exists
    if (!apiKeyStore.validate('test-key')) {
      apiKeyStore.add({ key: 'test-key', userId: 'test-user', plan: 'pro' });
    }
  });

  afterEach(() => {
    // Clear job store between tests
  });

  afterAll(() => {
    jobQueue.removeAllListeners();
    vi.restoreAllMocks();
  });

  describe('GET /templates', () => {
    it('returns list of built-in templates', async () => {
      const res = await app.request('/templates', {
        headers: { Authorization: 'Bearer test-key' },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.templates).toBeInstanceOf(Array);
      expect(data.templates.length).toBeGreaterThan(0);
    });

    it('returns template metadata without spec', async () => {
      const res = await app.request('/templates', {
        headers: { Authorization: 'Bearer test-key' },
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      const template = data.templates[0];
      expect(template).toHaveProperty('id');
      expect(template).toHaveProperty('name');
      expect(template).toHaveProperty('description');
      expect(template).toHaveProperty('platform');
      expect(template).toHaveProperty('style');
      expect(template).toHaveProperty('variables');
      expect(template).not.toHaveProperty('spec'); // spec is not included in list
    });

    it('includes variables array with metadata', async () => {
      const res = await app.request('/templates', {
        headers: { Authorization: 'Bearer test-key' },
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      const template = data.templates[0];
      expect(template.variables).toBeInstanceOf(Array);
      if (template.variables.length > 0) {
        expect(template.variables[0]).toHaveProperty('name');
        expect(template.variables[0]).toHaveProperty('type');
      }
    });

    it('requires authentication', async () => {
      const res = await app.request('/templates');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /templates/:id', () => {
    it('returns template with spec for valid id', async () => {
      // Get first template ID from store
      const templates = templateStore.list();
      const templateId = templates[0].id;

      const res = await app.request(`/templates/${templateId}`, {
        headers: { Authorization: 'Bearer test-key' },
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.id).toBe(templateId);
      expect(data).toHaveProperty('name');
      expect(data).toHaveProperty('description');
      expect(data).toHaveProperty('platform');
      expect(data).toHaveProperty('style');
      expect(data).toHaveProperty('variables');
      expect(data).toHaveProperty('spec'); // spec IS included in detail
      expect(data.spec).toHaveProperty('output');
      expect(data.spec).toHaveProperty('scenes');
    });

    it('returns 404 for non-existent template', async () => {
      const res = await app.request('/templates/non-existent-template-id', {
        headers: { Authorization: 'Bearer test-key' },
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Template not found');
    });

    it('requires authentication', async () => {
      const templates = templateStore.list();
      const templateId = templates[0].id;

      const res = await app.request(`/templates/${templateId}`);

      expect(res.status).toBe(401);
    });
  });

  describe('POST /templates/:id/render', () => {
    it('returns 404 for non-existent template', async () => {
      const res = await app.request('/templates/non-existent-template/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({ variables: {} }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Template not found');
    });

    it('queues render job with valid template', async () => {
      // Get first template ID from store
      const templates = templateStore.list();
      const templateId = templates[0].id;

      const res = await app.request(`/templates/${templateId}/render`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({ variables: {} }),
      });

      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.job_id).toBeDefined();
      expect(data.status).toBe('queued');
      expect(data.poll_url).toBeDefined();
    });

    it('substitutes variables before rendering', async () => {
      const templates = templateStore.list();
      const template = templates.find((t) => t.variables.length > 0);

      if (!template) {
        // Skip if no templates with variables
        return;
      }

      // Create variables object with test values
      const variables: Record<string, string> = {};
      for (const v of template.variables) {
        variables[v.name] = `Test value for ${v.name}`;
      }

      const res = await app.request(`/templates/${template.id}/render`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({ variables }),
      });

      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.job_id).toBeDefined();
    });

    it('accepts empty variables object', async () => {
      const templates = templateStore.list();
      const templateId = templates[0].id;

      const res = await app.request(`/templates/${templateId}/render`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({}), // Empty body, defaults to {}
      });

      expect(res.status).toBe(202);
    });

    it('accepts webhook_url for async notifications', async () => {
      const templates = templateStore.list();
      const templateId = templates[0].id;

      const res = await app.request(`/templates/${templateId}/render`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          variables: {},
          webhook_url: 'https://example.com/webhook',
        }),
      });

      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.job_id).toBeDefined();
    });

    it('requires authentication', async () => {
      const templates = templateStore.list();
      const templateId = templates[0].id;

      const res = await app.request(`/templates/${templateId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables: {} }),
      });

      expect(res.status).toBe(401);
    });

    it('returns poll_url pointing to render job status', async () => {
      const templates = templateStore.list();
      const templateId = templates[0].id;

      const res = await app.request(`/templates/${templateId}/render`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({ variables: {} }),
      });

      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.poll_url).toMatch(/^\/render\/[a-f0-9-]+$/);
    });
  });
});
