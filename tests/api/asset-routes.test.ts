/**
 * Tests for asset upload routes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { Hono } from 'hono';
import { assetRoutes } from '../../src/api/routes/assets.js';
import { authMiddleware } from '../../src/api/middleware/auth.js';
import { apiKeyStore } from '../../src/api/services/api-key-store.js';

describe('Asset Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.use('*', authMiddleware);
    app.route('/assets', assetRoutes);

    // Add test API key
    apiKeyStore.add({ key: 'test-key', userId: 'test-user', plan: 'pro' });
  });

  afterEach(async () => {
    await fs.rm('./uploads', { recursive: true, force: true }).catch(() => {});
  });

  describe('POST /assets', () => {
    it('should upload a valid PNG file', async () => {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['fake png data'], { type: 'image/png' }),
        'test.png'
      );

      const res = await app.request('/assets', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.asset_id).toBeDefined();
      expect(body.type).toBe('image/png');
      expect(body.original_name).toBe('test.png');
    });

    it('should upload a valid JPEG file', async () => {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['fake jpeg data'], { type: 'image/jpeg' }),
        'photo.jpg'
      );

      const res = await app.request('/assets', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.type).toBe('image/jpeg');
    });

    it('should upload a valid WebP file', async () => {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['fake webp data'], { type: 'image/webp' }),
        'image.webp'
      );

      const res = await app.request('/assets', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.type).toBe('image/webp');
    });

    it('should upload a valid MP3 file (audio/mpeg)', async () => {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['fake mp3 data'], { type: 'audio/mpeg' }),
        'music.mp3'
      );

      const res = await app.request('/assets', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.type).toBe('audio/mpeg');
    });

    it('should upload a valid WAV file', async () => {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['fake wav data'], { type: 'audio/wav' }),
        'audio.wav'
      );

      const res = await app.request('/assets', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.type).toBe('audio/wav');
    });

    it('should reject invalid file type', async () => {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['evil'], { type: 'application/octet-stream' }),
        'bad.exe'
      );

      const res = await app.request('/assets', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid file type');
      expect(body.allowed).toBeDefined();
      expect(body.received).toBe('application/octet-stream');
    });

    it('should reject text/html files', async () => {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['<script>alert("xss")</script>'], { type: 'text/html' }),
        'malicious.html'
      );

      const res = await app.request('/assets', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid file type');
    });

    it('should reject request without file', async () => {
      const formData = new FormData();

      const res = await app.request('/assets', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('No file');
      expect(body.hint).toBeDefined();
    });

    it('should reject request with non-file field', async () => {
      const formData = new FormData();
      formData.append('file', 'not a file');

      const res = await app.request('/assets', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('No file');
    });

    it('should require authentication', async () => {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['png'], { type: 'image/png' }),
        'test.png'
      );

      const res = await app.request('/assets', {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(401);
    });

    it('should reject invalid API key', async () => {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['png'], { type: 'image/png' }),
        'test.png'
      );

      const res = await app.request('/assets', {
        method: 'POST',
        headers: { Authorization: 'Bearer invalid-key' },
        body: formData,
      });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /assets/:assetId', () => {
    it('should return asset info', async () => {
      // First upload
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['png data'], { type: 'image/png' }),
        'test.png'
      );

      const uploadRes = await app.request('/assets', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
        body: formData,
      });
      const { asset_id } = await uploadRes.json();

      // Then get info
      const res = await app.request(`/assets/${asset_id}`, {
        headers: { Authorization: 'Bearer test-key' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.asset_id).toBe(asset_id);
      expect(body.type).toBe('image/png');
      expect(body.original_name).toBe('test.png');
      expect(body.created_at).toBeDefined();
    });

    it('should return 404 for non-existent asset', async () => {
      const res = await app.request('/assets/non-existent-id', {
        headers: { Authorization: 'Bearer test-key' },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Asset not found');
    });

    it('should require authentication', async () => {
      const res = await app.request('/assets/some-id');
      expect(res.status).toBe(401);
    });
  });
});
