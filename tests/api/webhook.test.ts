import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deliverWebhook, type WebhookPayload } from '../../src/api/services/webhook.js';

describe('deliverWebhook', () => {
  const mockPayload: WebhookPayload = {
    job_id: 'test-job',
    status: 'completed',
    download_url: '/download/test-job.mp4',
    timestamp: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should deliver webhook successfully', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('OK', { status: 200 }));

    const resultPromise = deliverWebhook('https://example.com/webhook', mockPayload);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(mockPayload),
      })
    );
  });

  it('should include correct headers', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('OK', { status: 200 }));

    const resultPromise = deliverWebhook('https://example.com/webhook', mockPayload);
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'GameMotion-Webhook/1.0',
        },
      })
    );
  });

  it('should retry on 5xx errors', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('Error', { status: 500 }))
      .mockResolvedValueOnce(new Response('OK', { status: 200 }));

    const resultPromise = deliverWebhook('https://example.com/webhook', mockPayload);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('should not retry on 4xx errors', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Bad Request', { status: 400 }));

    const resultPromise = deliverWebhook('https://example.com/webhook', mockPayload);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.error).toContain('400');
  });

  it('should not retry on 404 errors', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not Found', { status: 404 }));

    const resultPromise = deliverWebhook('https://example.com/webhook', mockPayload);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.error).toContain('404');
  });

  it('should return failure after max retries on persistent 5xx', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Error', { status: 500 }));

    const resultPromise = deliverWebhook('https://example.com/webhook', mockPayload);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(6); // Initial + 5 retries
    expect(result.error).toContain('500');
  });

  it('should handle failed webhook payload correctly', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('OK', { status: 200 }));

    const failedPayload: WebhookPayload = {
      job_id: 'test-job',
      status: 'failed',
      error: 'Render failed: out of memory',
      timestamp: new Date().toISOString(),
    };

    const resultPromise = deliverWebhook('https://example.com/webhook', failedPayload);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        body: JSON.stringify(failedPayload),
      })
    );
  });

  it('should handle network errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const resultPromise = deliverWebhook('https://example.com/webhook', mockPayload);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });
});
