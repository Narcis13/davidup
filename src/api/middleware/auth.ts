/**
 * Authentication middleware for API key validation.
 *
 * Validates Bearer token from Authorization header and sets
 * userId and plan on Hono context for downstream handlers.
 */
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { apiKeyStore } from '../services/api-key-store.js';

/**
 * Auth middleware that validates API keys.
 *
 * Expected header format: Authorization: Bearer <api-key>
 *
 * On success, sets context variables:
 * - userId: string - The user associated with the API key
 * - plan: 'free' | 'pro' - The user's plan tier
 *
 * On failure, throws HTTPException with 401 status.
 */
export const authMiddleware = createMiddleware<{
  Variables: { userId: string; plan: 'free' | 'pro' };
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    throw new HTTPException(401, { message: 'Missing Authorization header' });
  }

  // Expect "Bearer <token>"
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new HTTPException(401, { message: 'Invalid Authorization format. Use: Bearer <api-key>' });
  }

  const token = match[1];
  const apiKey = apiKeyStore.validate(token);

  if (!apiKey) {
    throw new HTTPException(401, { message: 'Invalid API key' });
  }

  // Set context variables for downstream middleware/routes
  c.set('userId', apiKey.userId);
  c.set('plan', apiKey.plan);

  await next();
});
