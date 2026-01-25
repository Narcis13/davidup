/**
 * ApiKeyStore - In-memory API key storage and validation
 *
 * MVP implementation that loads keys from environment variables.
 * Format: GAMEMOTION_API_KEYS=key1:user1:free,key2:user2:pro
 */
import type { ApiKey } from '../types.js';

export class ApiKeyStore {
  private keys = new Map<string, ApiKey>();

  constructor() {
    // Load keys from environment for MVP
    // Format: GAMEMOTION_API_KEYS=key1:user1:free,key2:user2:pro
    const envKeys = process.env.GAMEMOTION_API_KEYS ?? '';
    for (const entry of envKeys.split(',').filter(Boolean)) {
      const [key, userId, plan] = entry.split(':');
      if (key && userId && (plan === 'free' || plan === 'pro')) {
        this.keys.set(key, { key, userId, plan });
      }
    }

    // Add a default test key if none configured
    if (this.keys.size === 0) {
      this.keys.set('test-api-key', { key: 'test-api-key', userId: 'test-user', plan: 'free' });
    }
  }

  /**
   * Validate an API key
   * @param key The API key to validate
   * @returns ApiKey object if valid, undefined if not found
   */
  validate(key: string): ApiKey | undefined {
    return this.keys.get(key);
  }

  /**
   * Add a new API key
   * @param apiKey The API key to add
   */
  add(apiKey: ApiKey): void {
    this.keys.set(apiKey.key, apiKey);
  }

  /**
   * Remove an API key
   * @param key The key string to remove
   */
  remove(key: string): void {
    this.keys.delete(key);
  }
}

// Singleton instance
export const apiKeyStore = new ApiKeyStore();
