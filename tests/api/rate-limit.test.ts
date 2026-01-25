import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from '../../src/api/middleware/auth.js';
import { rateLimitMiddleware } from '../../src/api/middleware/rate-limit.js';
import { apiKeyStore } from '../../src/api/services/api-key-store.js';
import { errorHandler } from '../../src/api/middleware/error-handler.js';

describe('rateLimitMiddleware', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();

    // Error handler for consistent JSON responses
    app.onError(errorHandler);

    // Auth first (sets plan), then rate limit
    app.use('*', authMiddleware);
    app.use('*', rateLimitMiddleware);
    app.get('/api', (c) => c.json({ ok: true }));

    // Add test keys with unique userIds to avoid rate limit state leaking between tests
    const freeUserId = `free-user-${Date.now()}-${Math.random()}`;
    const proUserId = `pro-user-${Date.now()}-${Math.random()}`;
    apiKeyStore.add({ key: 'free-key', userId: freeUserId, plan: 'free' });
    apiKeyStore.add({ key: 'pro-key', userId: proUserId, plan: 'pro' });
  });

  it('should return rate limit headers', async () => {
    const res = await app.request('/api', {
      headers: { Authorization: 'Bearer free-key' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('RateLimit-Limit')).toBeDefined();
    expect(res.headers.get('RateLimit-Remaining')).toBeDefined();
  });

  it('should apply different limits per plan', async () => {
    const freeRes = await app.request('/api', {
      headers: { Authorization: 'Bearer free-key' },
    });
    const proRes = await app.request('/api', {
      headers: { Authorization: 'Bearer pro-key' },
    });

    // Free: 10/min, Pro: 60/min
    expect(freeRes.headers.get('RateLimit-Limit')).toBe('10');
    expect(proRes.headers.get('RateLimit-Limit')).toBe('60');
  });

  it('should decrement remaining with each request', async () => {
    const res1 = await app.request('/api', {
      headers: { Authorization: 'Bearer free-key' },
    });
    const remaining1 = parseInt(res1.headers.get('RateLimit-Remaining') ?? '0', 10);

    const res2 = await app.request('/api', {
      headers: { Authorization: 'Bearer free-key' },
    });
    const remaining2 = parseInt(res2.headers.get('RateLimit-Remaining') ?? '0', 10);

    expect(remaining2).toBe(remaining1 - 1);
  });

  it('should return 429 when limit exceeded', async () => {
    // Create a unique key for this test to avoid state leaking
    const uniqueUserId = `limit-test-${Date.now()}-${Math.random()}`;
    apiKeyStore.add({ key: 'exhaust-key', userId: uniqueUserId, plan: 'free' });

    // Make 10 requests (limit is 10 for free)
    for (let i = 0; i < 10; i++) {
      const res = await app.request('/api', {
        headers: { Authorization: 'Bearer exhaust-key' },
      });
      expect(res.status).toBe(200);
    }

    // 11th request should be rate limited
    const res = await app.request('/api', {
      headers: { Authorization: 'Bearer exhaust-key' },
    });
    expect(res.status).toBe(429);
  });
});
