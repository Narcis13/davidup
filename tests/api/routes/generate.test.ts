import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { generateRoutes } from '../../../src/api/routes/generate.js';
import { authMiddleware } from '../../../src/api/middleware/auth.js';
import { apiKeyStore } from '../../../src/api/services/api-key-store.js';
import * as templateGeneratorModule from '../../../src/api/services/template-generator.js';

// Mock template generator
vi.mock('../../../src/api/services/template-generator.js', () => ({
  templateGenerator: {
    generate: vi.fn(),
  },
}));

describe('Generate Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();

    app = new Hono();
    app.use('*', authMiddleware);
    app.route('/generate', generateRoutes);

    // Ensure test API key exists
    if (!apiKeyStore.validate('test-key')) {
      apiKeyStore.add({ key: 'test-key', userId: 'test-user', plan: 'pro' });
    }
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('POST /generate', () => {
    it('returns 201 with spec and variables on success', async () => {
      vi.mocked(templateGeneratorModule.templateGenerator.generate).mockResolvedValue({
        spec: {
          output: { width: 1080, height: 1920, fps: 30, duration: 15 },
          scenes: [{ duration: 15, background: '#000', elements: [] }],
        },
        variables: ['headline', 'imageUrl'],
      });

      const res = await app.request('/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          description: 'Create a TikTok video showcasing a new product',
          platform: 'tiktok',
          style: 'energetic',
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.spec).toBeDefined();
      expect(data.spec.output.width).toBe(1080);
      expect(data.variables).toHaveLength(2);
      expect(data.variables[0].name).toBe('headline');
      expect(data.variables[0].type).toBe('text');
      expect(data.variables[1].name).toBe('imageUrl');
      expect(data.variables[1].type).toBe('url'); // Contains 'url' in name
    });

    it('returns 400 for invalid request (description too short)', async () => {
      const res = await app.request('/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          description: 'short', // Less than 10 chars
          platform: 'tiktok',
          style: 'energetic',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid platform', async () => {
      const res = await app.request('/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          description: 'Create a video for my brand',
          platform: 'invalid-platform',
          style: 'energetic',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for missing required fields', async () => {
      const res = await app.request('/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          description: 'Create a video',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 503 when AI service is not configured', async () => {
      vi.mocked(templateGeneratorModule.templateGenerator.generate).mockRejectedValue(
        new Error('OPENROUTER_API_KEY not set')
      );

      const res = await app.request('/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          description: 'Create a TikTok video showcasing a new product',
          platform: 'tiktok',
          style: 'energetic',
        }),
      });

      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toBe('AI service not configured');
    });

    it('returns 504 on timeout', async () => {
      vi.mocked(templateGeneratorModule.templateGenerator.generate).mockRejectedValue(
        new Error('Request timeout')
      );

      const res = await app.request('/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          description: 'Create a TikTok video showcasing a new product',
          platform: 'tiktok',
          style: 'energetic',
        }),
      });

      expect(res.status).toBe(504);
      const data = await res.json();
      expect(data.error).toBe('AI service timeout');
    });

    it('returns 500 for generic errors', async () => {
      vi.mocked(templateGeneratorModule.templateGenerator.generate).mockRejectedValue(
        new Error('Something went wrong')
      );

      const res = await app.request('/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          description: 'Create a TikTok video showcasing a new product',
          platform: 'tiktok',
          style: 'energetic',
        }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Template generation failed');
      expect(data.details).toBe('Something went wrong');
    });

    it('requires authentication', async () => {
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'Create a video',
          platform: 'tiktok',
          style: 'energetic',
        }),
      });

      expect(res.status).toBe(401);
    });

    it('maps variable types based on name', async () => {
      vi.mocked(templateGeneratorModule.templateGenerator.generate).mockResolvedValue({
        spec: {
          output: { width: 1080, height: 1920, fps: 30, duration: 15 },
          scenes: [{ duration: 15, background: '#000', elements: [] }],
        },
        variables: ['title', 'productImage', 'backgroundUrl', 'price'],
      });

      const res = await app.request('/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          description: 'Create a product showcase video',
          platform: 'tiktok',
          style: 'professional',
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();

      // title -> text
      expect(data.variables.find((v: { name: string }) => v.name === 'title').type).toBe('text');
      // productImage -> url (contains 'image')
      expect(data.variables.find((v: { name: string }) => v.name === 'productImage').type).toBe('url');
      // backgroundUrl -> url (contains 'url')
      expect(data.variables.find((v: { name: string }) => v.name === 'backgroundUrl').type).toBe('url');
      // price -> text
      expect(data.variables.find((v: { name: string }) => v.name === 'price').type).toBe('text');
    });
  });
});
