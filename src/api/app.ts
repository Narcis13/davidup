/**
 * Hono API application setup.
 * Configures middleware and routes for the GameMotion rendering API.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { errorHandler } from './middleware/error-handler.js';
import type { HealthResponse, PlanTier } from './types.js';

/**
 * Hono app context variables type.
 * These are set by auth middleware and available to all routes.
 */
type Variables = {
  userId: string;
  plan: PlanTier;
};

/**
 * Create and configure the Hono app instance.
 */
export const app = new Hono<{ Variables: Variables }>();

// Global middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: '*', // Permissive for MVP - restrict in production
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    exposeHeaders: ['X-Request-Id'],
    maxAge: 86400, // 24 hours
  })
);

// Global error handler
app.onError(errorHandler);

/**
 * Health check endpoint.
 * Used for load balancer health checks and basic API availability testing.
 */
app.get('/health', (c) => {
  const response: HealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
  };
  return c.json(response);
});
