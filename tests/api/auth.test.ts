import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from '../../src/api/middleware/auth.js';
import { apiKeyStore } from '../../src/api/services/api-key-store.js';
import { errorHandler } from '../../src/api/middleware/error-handler.js';

describe('authMiddleware', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.onError(errorHandler);
    app.use('*', authMiddleware);
    app.get('/protected', (c) => c.json({ userId: c.get('userId'), plan: c.get('plan') }));

    // Add test key
    apiKeyStore.add({ key: 'valid-key', userId: 'user-123', plan: 'pro' });
  });

  it('should reject request without Authorization header', async () => {
    const res = await app.request('/protected');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Missing');
  });

  it('should reject request with invalid format', async () => {
    const res = await app.request('/protected', {
      headers: { Authorization: 'Basic abc123' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Invalid Authorization format');
  });

  it('should reject request with invalid API key', async () => {
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer invalid-key' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Invalid API key');
  });

  it('should allow request with valid API key', async () => {
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer valid-key' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('user-123');
    expect(body.plan).toBe('pro');
  });

  it('should set context variables for downstream handlers', async () => {
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer valid-key' },
    });
    const body = await res.json();
    expect(body.userId).toBe('user-123');
    expect(body.plan).toBe('pro');
  });
});

describe('ApiKeyStore', () => {
  it('should validate existing keys', () => {
    const key = apiKeyStore.validate('valid-key');
    expect(key).toBeDefined();
    expect(key?.userId).toBe('user-123');
  });

  it('should return undefined for non-existent keys', () => {
    const key = apiKeyStore.validate('nonexistent-key');
    expect(key).toBeUndefined();
  });

  it('should add and remove keys', () => {
    apiKeyStore.add({ key: 'temp-key', userId: 'temp-user', plan: 'free' });
    expect(apiKeyStore.validate('temp-key')).toBeDefined();

    apiKeyStore.remove('temp-key');
    expect(apiKeyStore.validate('temp-key')).toBeUndefined();
  });
});
