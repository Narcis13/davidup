/**
 * Webhook delivery service with exponential backoff retries.
 *
 * Delivers webhook notifications for job completion events with:
 * - 5 retries with exponential backoff (1s -> 2s -> 4s -> 8s -> 16s)
 * - Jitter to prevent thundering herd
 * - 10s timeout per attempt
 * - Bails on 4xx (client error, won't be fixed by retry)
 */
import retry from 'async-retry';

/**
 * Payload sent to webhook endpoints
 */
export interface WebhookPayload {
  /** The job ID this notification is for */
  job_id: string;
  /** Job completion status */
  status: 'completed' | 'failed';
  /** URL to download the rendered video (only on success) */
  download_url?: string;
  /** Error message (only on failure) */
  error?: string;
  /** ISO timestamp of when this notification was sent */
  timestamp: string;
}

/**
 * Result of a webhook delivery attempt
 */
export interface WebhookDeliveryResult {
  /** Whether delivery succeeded */
  success: boolean;
  /** Number of attempts made */
  attempts: number;
  /** Error message if delivery failed */
  error?: string;
}

/**
 * Deliver webhook notification with exponential backoff retries.
 *
 * @param url - The webhook URL to deliver to
 * @param payload - The notification payload
 * @returns Result indicating success/failure and attempt count
 *
 * @example
 * ```typescript
 * const result = await deliverWebhook('https://example.com/webhook', {
 *   job_id: 'abc-123',
 *   status: 'completed',
 *   download_url: '/download/abc-123.mp4',
 *   timestamp: new Date().toISOString(),
 * });
 *
 * if (result.success) {
 *   console.log(`Delivered in ${result.attempts} attempts`);
 * } else {
 *   console.error(`Failed after ${result.attempts} attempts: ${result.error}`);
 * }
 * ```
 */
export async function deliverWebhook(
  url: string,
  payload: WebhookPayload
): Promise<WebhookDeliveryResult> {
  let attemptCount = 0;

  try {
    await retry(
      async (bail) => {
        attemptCount++;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'GameMotion-Webhook/1.0',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          clearTimeout(timeout);

          // Don't retry 4xx errors (client error - problem with the webhook URL/config)
          if (res.status >= 400 && res.status < 500) {
            bail(new Error(`Webhook rejected: ${res.status} ${res.statusText}`));
            return;
          }

          // Retry 5xx errors (server error - might succeed on retry)
          if (!res.ok) {
            throw new Error(`Webhook failed: ${res.status} ${res.statusText}`);
          }
        } catch (error) {
          clearTimeout(timeout);
          throw error;
        }
      },
      {
        retries: 5,
        factor: 2,
        minTimeout: 1000,
        maxTimeout: 60_000,
        randomize: true, // Jitter to prevent thundering herd
      }
    );

    return { success: true, attempts: attemptCount };
  } catch (error) {
    return {
      success: false,
      attempts: attemptCount,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
