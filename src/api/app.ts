/**
 * Hono API application setup.
 * Configures middleware and routes for the GameMotion rendering API.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { errorHandler } from './middleware/error-handler.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { assetRoutes, downloadRoutes, renderRoutes, generateRoutes, templateRoutes } from './routes/index.js';
import { studioRoutes } from './routes/studio.js';
import { chatRoutes } from './routes/chat.js';
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
    exposeHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
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

// Protected routes - Render
app.use('/render/*', authMiddleware);
app.use('/render/*', rateLimitMiddleware);
app.route('/render', renderRoutes);

// Protected routes - Assets
app.use('/assets/*', authMiddleware);
app.use('/assets/*', rateLimitMiddleware);
app.route('/assets', assetRoutes);

// Protected routes - Generate (AI template generation)
app.use('/generate/*', authMiddleware);
app.use('/generate/*', rateLimitMiddleware);
app.route('/generate', generateRoutes);

// Protected routes - Templates
app.use('/templates/*', authMiddleware);
app.use('/templates/*', rateLimitMiddleware);
app.route('/templates', templateRoutes);

// Public routes - Download (no auth for shareable URLs)
app.route('/download', downloadRoutes);

// Studio routes - no auth for local dev tool
app.route('/studio', studioRoutes);
app.route('/studio', chatRoutes);

// 404 handler for undefined routes
app.notFound((c) => c.json({ error: 'Not found' }, 404));
