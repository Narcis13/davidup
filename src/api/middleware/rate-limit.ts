/**
 * Rate limiting middleware with tiered limits based on plan.
 *
 * Uses hono-rate-limiter for request limiting with plan-based configuration:
 * - Free tier: 10 requests per minute
 * - Pro tier: 60 requests per minute
 *
 * Must be used AFTER auth middleware (needs plan from context).
 */
import type { Context, MiddlewareHandler } from 'hono';
import { rateLimiter } from 'hono-rate-limiter';
import { createMiddleware } from 'hono/factory';

// Define our app environment type
type AppEnv = {
  Variables: { userId: string; plan: 'free' | 'pro' };
};

const RATE_LIMITS = {
  free: { windowMs: 60_000, limit: 10 },   // 10 per minute
  pro: { windowMs: 60_000, limit: 60 },    // 60 per minute
} as const;

/**
 * Create rate limiter for a specific plan tier.
 * Uses userId-based limiting (not IP-based).
 *
 * @param plan The plan tier ('free' or 'pro')
 * @returns Configured rate limiter middleware
 */
export function createRateLimiter(plan: 'free' | 'pro'): MiddlewareHandler<AppEnv> {
  const config = RATE_LIMITS[plan];

  return rateLimiter<AppEnv>({
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: 'draft-6',
    keyGenerator: (c: Context<AppEnv>) => {
      // Key by userId (set by auth middleware)
      const userId = c.get('userId');
      return userId ?? 'anonymous';
    },
  });
}

// Pre-create rate limiters for each tier to maintain state across requests
const freeLimiter = createRateLimiter('free');
const proLimiter = createRateLimiter('pro');

/**
 * Rate limit middleware that applies tier-appropriate limits.
 * Must be used AFTER auth middleware (needs plan from context).
 */
export const rateLimitMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const plan = c.get('plan') ?? 'free';
  const limiter = plan === 'pro' ? proLimiter : freeLimiter;
  return limiter(c, next);
});
