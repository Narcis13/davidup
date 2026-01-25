/**
 * API module entry point.
 * Exports the Hono app, types, middleware, and services for external use.
 */

// App and server
export { app } from './app.js';

// Types
export * from './types.js';

// Middleware
export * from './middleware/index.js';

// Services
export * from './services/index.js';

// Routes
export * from './routes/index.js';
