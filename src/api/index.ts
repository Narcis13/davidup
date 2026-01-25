/**
 * API module entry point.
 * Exports the Hono app, types, and middleware for external use.
 */

// App instance
export { app } from './app.js';

// All API types
export type {
  Job,
  JobStatus,
  JobResult,
  RenderRequest,
  ApiKey,
  PlanTier,
  RenderResponse,
  ErrorResponse,
  HealthResponse,
  VideoSpec,
} from './types.js';

// Middleware
export { errorHandler } from './middleware/error-handler.js';
