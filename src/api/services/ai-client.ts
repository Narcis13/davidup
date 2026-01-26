/**
 * OpenRouter AI Client - API client for AI model access
 *
 * Provides retry-capable fetch wrapper for OpenRouter API calls
 * with proper error handling and timeout support.
 */
import asyncRetry from 'async-retry';
import type { Options as RetryOptions } from 'async-retry';

/**
 * Message format for OpenRouter API
 */
export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Request format for OpenRouter API
 */
export interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  response_format?: { type: 'json_object' };
  temperature?: number;
  max_tokens?: number;
}

/**
 * Response format from OpenRouter API
 */
export interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Default model for template generation
 */
export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT = 60000; // 60 seconds

/**
 * Call OpenRouter API with retry and error handling
 *
 * @param request Request payload for OpenRouter
 * @returns OpenRouter API response
 * @throws Error if API key is missing or API call fails
 */
export async function callOpenRouter(request: OpenRouterRequest): Promise<OpenRouterResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY environment variable is not set. ' +
        'Get your API key from https://openrouter.ai/keys'
    );
  }

  const timeout = Number(process.env.OPENROUTER_TIMEOUT) || DEFAULT_TIMEOUT;
  const appUrl = process.env.APP_URL ?? 'https://gamemotion.dev';

  return asyncRetry(
    async (bail: (err: Error) => void) => {
      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': appUrl,
          'X-Title': 'GameMotion',
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unknown error');

        // Don't retry on 4xx client errors (except 429 rate limiting)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          bail(
            new Error(
              `OpenRouter API error (${response.status}): ${errorBody}`
            )
          );
          // TypeScript requires return after bail, though bail throws
          throw new Error('Unreachable');
        }

        // Retry on 5xx server errors and 429 rate limiting
        throw new Error(
          `OpenRouter API error (${response.status}): ${errorBody}`
        );
      }

      return response.json() as Promise<OpenRouterResponse>;
    },
    {
      retries: 2,
      factor: 2,
      minTimeout: 1000,
    }
  );
}
